// ورودی‌های لید: همان کاری که WF-Bot-Lead-Intake و WF-21 در n8n می‌کردند.
//
// سه تکه‌ی مشترک دارند و برای همین یک‌جا نشسته‌اند: پیدا کردنِ لیدِ قبلی
// از روی شماره، انتخاب مشاورِ بعدی به‌صورت چرخشی، و اطلاع‌رسانی به
// مدیرها. رفتار عمداً مو‌به‌مو همان n8n است - جای «بهترش کردن»، وسط یک
// انتقالِ یک‌روزه نیست.

const nowIso = () => new Date().toISOString();

/** شماره به یک شکل واحد. تشخیص تکراری روی همین انجام می‌شود. */
export function normalizePhone(raw) {
  let d = String(raw || "").replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
  d = d.replace(/\D/g, "");
  if (d.startsWith("98") && d.length === 12) return "0" + d.slice(2);
  if (d.length === 10 && d[0] === "9") return "0" + d;
  return d;
}

/**
 * لیدِ قبلیِ همین شماره.
 *
 * قاعده‌ی «یک نفر، یک لید» از n8n می‌آید و مهم است: بدون آن، مشتریِ
 * برگشته یک ردیف دوم می‌سازد و دو مشاور به یک نفر زنگ می‌زنند.
 */
export async function findLeadByPhone(env, phone) {
  const p = normalizePhone(phone);
  if (!p) return null;
  return env.DB
    .prepare("SELECT * FROM crm_leads WHERE phone = ? ORDER BY created_at LIMIT 1")
    .bind(p)
    .first();
}

// ─── تخصیص چرخشی ─────────────────────────────────────────────────────

const RR_KEY = "lead_assignment";

/**
 * مشاورِ بعدی در چرخش.
 *
 * فهرست مرتب می‌شود تا ترتیب به ترتیبِ ردیف‌های دیتابیس بند نباشد -
 * همان کاری که نود n8n با sort() می‌کرد. اگر هیچ مشاوری نباشد، رشته‌ی
 * خالی برمی‌گردد و لید بی‌صاحب می‌ماند، که بهتر از تخصیص به یک نامِ
 * اشتباه است.
 */
export async function nextConsultant(env) {
  const { results } = await env.DB
    .prepare("SELECT username FROM crm_admin WHERE role = 'consultant' ORDER BY username")
    .all();
  const names = (results || []).map((r) => r.username).filter(Boolean);
  if (names.length === 0) return "";

  const state = await env.DB
    .prepare("SELECT last_assigned_username FROM crm_rr_state WHERE state_key = ?")
    .bind(RR_KEY)
    .first();
  const last = (state && state.last_assigned_username) || "";
  const next = names[(names.indexOf(last) + 1) % names.length];

  await env.DB
    .prepare(
      `INSERT INTO crm_rr_state (state_key, last_assigned_username) VALUES (?, ?)
       ON CONFLICT(state_key) DO UPDATE SET last_assigned_username = excluded.last_assigned_username`
    )
    .bind(RR_KEY, next)
    .run();

  return next;
}

// ─── اطلاع‌رسانی به مدیرها ───────────────────────────────────────────

/**
 * پیام به همه‌ی مدیرهای فعال.
 *
 * شکستِ یک پیام بقیه را متوقف نمی‌کند: در n8n هم نود تلگرام
 * continueRegularOutput داشت. یک مدیر که ربات را بلاک کرده، نباید جلوی
 * خبردار شدنِ بقیه را بگیرد.
 *
 * @returns {Promise<{sent:number, failed:number}>}
 */
export async function notifyAdmins(env, text) {
  if (!env.BOT_TOKEN) return { sent: 0, failed: 0 };
  const { results } = await env.DB
    .prepare("SELECT telegram_id FROM crm_admin_users WHERE active = 1")
    .all();

  let sent = 0;
  let failed = 0;
  for (const row of results || []) {
    if (!row.telegram_id) continue;
    try {
      const res = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ chat_id: String(row.telegram_id), text }),
      });
      if (res.ok) sent++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { sent, failed };
}

// ─── لیدِ ربات ───────────────────────────────────────────────────────

export function leadIdFor(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
  return "LEAD-" + p.replace(/-/g, "") + "-" + Math.floor(1000 + Math.random() * 9000);
}

function botNote(lead, when) {
  const extras = [];
  if (lead.level) extras.push("سطح: " + lead.level);
  if (lead.topic) extras.push("موضوع: " + lead.topic);
  if (lead.experience) extras.push("مدت فعالیت: " + lead.experience);
  if (lead.has_real_account) extras.push("حساب ریل: " + lead.has_real_account);
  if (lead.trade_status) extras.push("وضعیت ترید: " + lead.trade_status);
  if (lead.preferred_time) extras.push("زمان دلخواه: " + lead.preferred_time);
  if (lead.confirmed === "true") extras.push("فرم تایید شده");
  return (
    "[" + when.toISOString().slice(0, 16).replace("T", " ") + "] از ربات تلگرام" +
    (extras.length ? " — " + extras.join(" | ") : "")
  );
}

/**
 * پاسخ‌های ربات را از متنِ یادداشت‌ها بیرون می‌کشد.
 *
 * دو نسل قالب وجود دارد و هیچ‌کدام حذف نشده: آنچه n8n می‌نوشت
 * («سطح: … | موضوع: … | زمان مناسب تماس: …») و آنچه ربات حالا می‌نویسد
 * («[تاریخ] از ربات تلگرام — سطح: … | موضوع: …»). هر دو یک شکل دارند،
 * پس یک الگو هر دو را می‌گیرد.
 *
 * آخرین مقدار برنده است: لیدی که دو بار فرم را پر کرده، پاسخ تازه‌اش
 * همان چیزی است که باید دیده شود.
 *
 * این تنها جای پارس کردن است. پنل ستون‌ها را می‌خواند، نه متن را - تا
 * دو تعبیرِ متفاوت از یک داده نداشته باشیم.
 */
export function parseBotAnswers(notes) {
  const text = String(notes || "");
  const grab = (label) => {
    const re = new RegExp(label + "\\s*:\\s*([^|\\n]+)", "g");
    let m;
    let last = "";
    while ((m = re.exec(text)) !== null) last = m[1].trim();
    return last;
  };
  return {
    level: grab("سطح"),
    topic: grab("موضوع"),
    experience: grab("مدت فعالیت"),
    has_real_account: grab("حساب ریل"),
    trade_status: grab("وضعیت ترید"),
  };
}

/**
 * لیدی که ربات گرفته، در crm_leads.
 *
 * اگر شماره‌اش از قبل هست، همان پرونده به‌روز می‌شود و یادداشت تازه به
 * انتهایش می‌چسبد - نه یک ردیف دوم. این دقیقاً قاعده‌ی n8n است.
 *
 * @returns {Promise<{lead_id:string, merged:boolean}>}
 */
export async function upsertBotLead(env, lead) {
  const now = new Date();
  const phone = normalizePhone(lead.phone);
  const existing = phone ? await findLeadByPhone(env, phone) : null;
  const note = botNote(lead, now);

  if (existing) {
    const notes = existing.notes ? existing.notes + "\n" + note : note;
    await env.DB
      .prepare(
        `UPDATE crm_leads SET notes = ?, updated_at = ?,
           telegram_user_id = COALESCE(NULLIF(?, ''), telegram_user_id),
           telegram_username = COALESCE(NULLIF(?, ''), telegram_username),
           full_name = COALESCE(NULLIF(?, ''), full_name),
           course = COALESCE(NULLIF(?, ''), course),
           level = COALESCE(NULLIF(?, ''), level),
           topic = COALESCE(NULLIF(?, ''), topic),
           experience = COALESCE(NULLIF(?, ''), experience),
           has_real_account = COALESCE(NULLIF(?, ''), has_real_account),
           trade_status = COALESCE(NULLIF(?, ''), trade_status)
         WHERE lead_id = ?`
      )
      .bind(
        notes, now.toISOString(),
        lead.telegram_user_id == null ? "" : String(lead.telegram_user_id),
        lead.username || "", lead.name || "", lead.course || "",
        lead.level || "", lead.topic || "",
        lead.experience || "", lead.has_real_account || "", lead.trade_status || "",
        existing.lead_id
      )
      .run();
    await logActivity(env, existing.lead_id, "ثبت لید", "از ربات تلگرام (پرونده‌ی موجود)", "bot");
    return { lead_id: existing.lead_id, merged: true };
  }

  const leadId = leadIdFor(now);
  await env.DB
    .prepare(
      `INSERT INTO crm_leads
         (lead_id, telegram_user_id, telegram_username, full_name, phone, course,
          request_type, notes, status, contact_attempts, created_at, updated_at, source,
          level, topic, experience, has_real_account, trade_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'جدید', 0, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      leadId,
      lead.telegram_user_id == null ? null : String(lead.telegram_user_id),
      lead.username || null, lead.name || null, phone || null, lead.course || null,
      lead.request_type || "مشاوره", note,
      now.toISOString(), now.toISOString(), lead.source || "telegram_bot",
      lead.level || null, lead.topic || null,
      lead.experience || null, lead.has_real_account || null, lead.trade_status || null
    )
    .run();
  await logActivity(env, leadId, "ثبت لید", "از ربات تلگرام", "bot");
  return { lead_id: leadId, merged: false };
}

async function logActivity(env, leadId, action, detail, actor) {
  try {
    await env.DB
      .prepare(
        "INSERT INTO crm_activity_log (lead_id, action, detail, actor, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(String(leadId), action, detail || "", actor || "", nowIso())
      .run();
  } catch (err) {
    console.error("ثبت تایم‌لاین شکست خورد:", err && err.message);
  }
}

// ─── فرم منتورینگ سایت ───────────────────────────────────────────────

const MENTORING_LABELS = {
  market_experience: "مدت فعالیت در بازارهای مالی",
  has_real_account: "حساب ریل",
  real_account_duration: "مدت معامله در حساب ریل",
  capital_traded: "میزان سرمایه",
  styles_learned: "سبک‌های آموخته",
  teacher_name: "استاد",
  trading_goal: "هدف از معامله‌گری",
  has_strategy: "استراتژی",
  strategy_performance: "بازدهی استراتژی",
  strategy_image_url: "تصویر استراتژی",
};

/** متنِ اطلاع‌رسانی - همان قالبِ WF-21، تا تیم چیزِ آشنا ببیند. */
export function mentoringNotifyText(ctx, answers) {
  const lines = [
    "🎓 درخواست جدید منتورینگ اختصاصی (سایت)!",
    "",
    "🆔 لید: " + ctx.lead_id,
    "👤 نام: " + (ctx.full_name || "—"),
    "📱 شماره: " + (ctx.phone || "—"),
  ];
  if (ctx.telegram_id) lines.push("💬 تلگرام: " + ctx.telegram_id);
  if (ctx.message) lines.push("🎯 هدف از مشاوره: " + ctx.message);

  const keys = Object.keys(answers || {});
  if (keys.length > 0) {
    lines.push("", "——— پاسخ‌های فرم ———");
    for (const k of keys) lines.push("• " + (MENTORING_LABELS[k] || k) + ": " + answers[k]);
  }
  if (ctx.merged) {
    lines.push("", "ℹ️ این فرد لید قبلی داشت، یادداشت به پرونده‌اش اضافه شد.");
  }
  return lines.join("\n");
}

/**
 * لیدِ فرم منتورینگ: پیدا کردن یا ساختن، با تخصیص چرخشی برای لیدِ تازه.
 *
 * @returns {Promise<{lead_id:string, merged:boolean, assigned_to:string}>}
 */
export async function mentoringLead(env, data) {
  const now = new Date();
  const iso = now.toISOString();
  const noteLine =
    "📩 درخواست منتورینگ اختصاصی (وبسایت) - " + iso.slice(0, 16).replace("T", " ") +
    (data.message ? ": " + data.message : "");

  const existing = await findLeadByPhone(env, data.phone);
  if (existing) {
    const notes = existing.notes ? existing.notes + "\n" + noteLine : noteLine;
    await env.DB
      .prepare("UPDATE crm_leads SET notes = ?, updated_at = ? WHERE lead_id = ?")
      .bind(notes, iso, existing.lead_id)
      .run();
    await logActivity(env, existing.lead_id, "درخواست منتورینگ", "فرم سایت", "website");
    return { lead_id: existing.lead_id, merged: true, assigned_to: existing.assigned_to || "" };
  }

  const leadId = leadIdFor(now);
  const assignee = await nextConsultant(env);
  await env.DB
    .prepare(
      `INSERT INTO crm_leads
         (lead_id, full_name, phone, request_type, notes, status, source,
          contact_attempts, assigned_to, created_at, updated_at)
       VALUES (?, ?, ?, 'منتورینگ اختصاصی', ?, 'پاسخ‌داده‌نشده', 'website_mentoring_form', 0, ?, ?, ?)`
    )
    .bind(leadId, data.full_name || null, normalizePhone(data.phone) || null, noteLine, assignee || null, iso, iso)
    .run();
  await logActivity(env, leadId, "درخواست منتورینگ", "فرم سایت" + (assignee ? " — تخصیص به " + assignee : ""), "website");
  return { lead_id: leadId, merged: false, assigned_to: assignee };
}
