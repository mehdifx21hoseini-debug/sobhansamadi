// گواهی: هرچه بینِ صف، تلگرام و ورک‌فلو می‌گذرد.
//
// ─── چرا رندر در ورکر نیست ───────────────────────────────────────
//
// رسمِ متنِ فارسی با فونتِ سفارشی یک موتورِ رندرِ چندمگابایتی و چند
// ده میلی‌ثانیه CPU می‌خواهد. پلنِ رایگانِ ورکر ۳ مگابایت حجمِ کد و ۱۰
// میلی‌ثانیه CPU دارد. پس رندر در GitHub Actions انجام می‌شود، همان‌جا
// که درِین پیام‌ها هم هست، و ورکر فقط صف را نگه می‌دارد و عکس را به
// تلگرام می‌رساند.
//
// ─── چرا قالب و فونت‌ها در ریپو نیستند ───────────────────────────
//
// ریپو عمومی است. قالبِ بی‌نامِ باکیفیت، امضا و فونت‌ها کنارِ هم یعنی
// هرکس می‌تواند «گواهیِ آکادمی» به نامِ هرکسی بسازد. فونتِ Yekan Bakh
// هم مجوزِ بازتوزیع ندارد (متعلق به Fontiran است).
//
// پس سه فایل را خودِ مدیر برای ربات می‌فرستد و تلگرام نگهشان می‌دارد؛
// ورکر فقط file_id را ذخیره می‌کند و هنگامِ رندر آن‌ها را از تلگرام
// می‌کشد و به ورک‌فلو می‌دهد. نه راز تازه‌ای لازم است نه چیزی در ریپو
// می‌ماند، و مدیر هر وقت خواست با فرستادنِ دوباره‌ی فایل عوضش می‌کند.

import { readConfig, writeConfig } from "../content/channel.js";
import { dispatchWorkflow } from "../ops/dispatch.js";
import { finishJob, getJob, sweep, countActive, failAllRendering, batchStats, failBatch } from "./store.js";

export const WORKFLOW = "cert-render.yml";
export const PENDING_FLAG = "cert_pending";

export const GENDER_LABEL = { f: "سرکار خانم", m: "جناب آقای" };

// ─── فایل‌های خصوصی ──────────────────────────────────────────────

export const SLOTS = {
  template: { key: "cert_asset_template", title: "قالب گواهی", hint: "template.png" },
  name_font: { key: "cert_asset_name_font", title: "فونتِ اسم", hint: "YekanBakh-ExtraBlack.ttf" },
  label_font: {
    key: "cert_asset_label_font",
    title: "فونتِ «جناب آقای / سرکار خانم»",
    hint: "YekanBakh-Light.ttf",
  },
};

// سقفِ دانلودِ ربات از تلگرام ۲۰ مگابایت است. قالب ~۴ مگابایت است.
export const ASSET_MAX_BYTES = 18 * 1024 * 1024;

/** نامِ فایل → کدام جایگاه. null یعنی این فایل مالِ گواهی نیست. */
export function slotForFilename(fileName) {
  const f = String(fileName || "").toLowerCase();
  if (/^template[\w .()-]*\.png$/.test(f)) return "template";
  if (/\.(ttf|otf)$/.test(f)) {
    if (/extra[-_ ]?black/.test(f)) return "name_font";
    if (/light/.test(f)) return "label_font";
  }
  return null;
}

export async function saveAsset(env, slot, doc, now = new Date()) {
  const rec = {
    file_id: doc.file_id,
    size: doc.file_size || 0,
    name: doc.file_name || "",
    at: now.toISOString(),
  };
  await writeConfig(env, SLOTS[slot].key, JSON.stringify(rec));
  return rec;
}

export async function readAsset(env, slot) {
  const raw = await readConfig(env, SLOTS[slot].key).catch(() => "");
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw);
    return rec && rec.file_id ? rec : null;
  } catch {
    return null;
  }
}

/** کدام فایل‌ها هنوز نیامده‌اند. خالی یعنی آماده‌ایم. */
export async function missingAssets(env) {
  const out = [];
  for (const slot of Object.keys(SLOTS)) {
    if (!(await readAsset(env, slot))) out.push(slot);
  }
  return out;
}

const TG = (env, method) => "https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method;

async function tgJson(env, method, payload, timeoutMs = 15000) {
  const res = await fetch(TG(env, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(payload),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: !!(res.ok && body && body.ok), status: res.status, body };
}

/**
 * یک فایلِ خصوصی را از تلگرام می‌کشد و همان‌طور که می‌آید برمی‌گرداند.
 * بدنه بافر نمی‌شود: ورکر فقط لوله است و CPU‌ای خرج نمی‌کند.
 */
export async function streamAsset(env, slot) {
  if (!SLOTS[slot]) return { status: 400, error: "slot" };
  const rec = await readAsset(env, slot);
  if (!rec) return { status: 404, error: "not_uploaded" };
  const meta = await tgJson(env, "getFile", { file_id: rec.file_id });
  const path = meta.ok && meta.body.result && meta.body.result.file_path;
  if (!path) return { status: 502, error: "getFile" };
  const res = await fetch("https://api.telegram.org/file/bot" + env.BOT_TOKEN + "/" + path, {
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok || !res.body) return { status: 502, error: "download" };
  const headers = { "content-type": "application/octet-stream", "cache-control": "no-store" };
  const len = res.headers.get("content-length");
  if (len) headers["content-length"] = len;
  return { status: 200, body: res.body, headers };
}

// ─── پیام به مدیر ────────────────────────────────────────────────
//
// هر دسته یک پیامِ پیشرفت دارد که با هر گواهی به‌روز می‌شود. شکستِ یک نام
// پیامِ جدا نمی‌سازد و پیامِ دسته را هم با متنِ تک‌نام جای‌گزین نمی‌کند؛
// فقط در همین یک پیام جمع می‌شود.

export const REASONS = {
  dispatch: "راه‌اندازیِ رندر در گیت‌هاب ممکن نشد",
  no_runner: "رندر در شش دقیقه شروع نشد",
  timeout: "رندر بیش از شش دقیقه طول کشید",
  template: "قالب یا فونت‌ها مشکل دارند (/certassets)",
  render: "خطا در رندر",
  name: "نامِ نامعتبر",
  send: "تلگرام عکس را نپذیرفت",
  other: "خطای ناشناخته",
};

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export const fa = (n) => String(n).replace(/[0-9]/g, (d) => FA_DIGITS[d]);

/** متنِ پیامِ پیشرفتِ یک دسته. خالص - برای تست. */
export function batchText(st) {
  const c = st.counts;
  const active = c.queued + c.rendering;
  const lines = [];

  if (active > 0) {
    lines.push("⏳ در حال ساختِ گواهی‌ها: " + fa(c.done) + " از " + fa(st.total) + " ارسال شد");
    if (c.failed > 0) lines.push("❌ " + fa(c.failed) + " مورد انجام نشد");
    lines.push("", "هرکدام که آماده شود همین‌جا می‌آید.");
  } else if (c.done === st.total) {
    lines.push(st.total === 1 ? "✅ گواهی ارسال شد." : "✅ هر " + fa(st.total) + " گواهی ارسال شد.");
  } else {
    lines.push("✅ " + fa(c.done) + " از " + fa(st.total) + " گواهی ارسال شد.");
  }

  if (active === 0) {
    if (st.failed.length > 0) {
      lines.push("", "❌ انجام نشد:");
      for (const f of st.failed.slice(0, 10)) {
        lines.push("• " + f.name + " — " + (REASONS[f.error] || REASONS.other));
      }
      if (st.failed.length > 10) lines.push("• و " + fa(st.failed.length - 10) + " مورد دیگر");
      lines.push("", "برای ساختنِ دوباره، همان خط‌ها را دوباره بفرستید (/cert).");
    }
    if (c.cancelled > 0) lines.push("", "✖️ " + fa(c.cancelled) + " مورد لغو شد.");
  }
  return lines.join("\n");
}

/** دکمه‌ی «لغوِ باقی‌مانده»، فقط تا وقتی چیزی در صف مانده. */
export function batchKeyboard(batchId, st) {
  if (st.counts.queued === 0) return { inline_keyboard: [] };
  return {
    inline_keyboard: [
      [{ text: "✖️ لغوِ باقی‌مانده", callback_data: "CERT|k|" + batchId, style: "danger" }],
    ],
  };
}

/**
 * پیامِ پیشرفتِ دسته را تازه می‌کند. بی‌صدا شکست می‌خورد: اطلاع‌رسانی نباید
 * چیزی را بشکند، و مدیر دست‌کم از رسیدنِ خودِ عکس‌ها می‌فهمد.
 */
export async function refreshBatch(env, batchId) {
  try {
    const st = await batchStats(env, batchId);
    if (!st || !st.chat_id) return;
    const text = batchText(st);
    const active = st.counts.queued + st.counts.rendering;
    if (st.message_id) {
      const r = await tgJson(env, "editMessageText", {
        chat_id: st.chat_id,
        message_id: st.message_id,
        text,
        reply_markup: batchKeyboard(batchId, st),
      });
      // «message is not modified» خطا نیست؛ هر خطای دیگر هم فقط وقتی پیامِ تازه
      // می‌خواهد که کار تمام شده باشد - وگرنه هر تازه‌سازی یک پیامِ جدید می‌شد.
      if (r.ok || active > 0) return;
    } else if (active > 0) {
      return;
    }
    await tgJson(env, "sendMessage", { chat_id: st.chat_id, text });
  } catch {
    // دیده نشد؛ مهم نیست.
  }
}

// ─── گذارها ──────────────────────────────────────────────────────

export async function failJob(env, id, code) {
  const safe = REASONS[code] ? code : "other";
  const job = await getJob(env, id);
  if (!job) return false;
  if (!(await finishJob(env, id, "failed", safe))) return false;
  if (job.batch_id) await refreshBatch(env, job.batch_id);
  return true;
}

/** پس از ثبتِ دسته: علامتِ «در انتظار» و روشن کردنِ ورک‌فلو. */
export async function startRender(env, batchId) {
  await writeConfig(env, PENDING_FLAG, "1");
  const r = await dispatchWorkflow(env, WORKFLOW);
  if (!r.ok) {
    await failBatch(env, batchId, "dispatch");
    await refreshBatch(env, batchId);
    return { ok: false, detail: r.skipped || String(r.status || "") };
  }
  return { ok: true };
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const MAX_PNG_BYTES = 30 * 1024 * 1024;

export function looksLikePng(bytes) {
  const u = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
  return u.length === 8 && PNG_MAGIC.every((b, i) => u[i] === b);
}

const FIT_NOTE = {
  shrunk: "\n(نام بلند بود؛ اندازه‌ی فونت کمی کوچک شد.)",
  overflow: "\n⚠️ نام خیلی بلند است و حتی با کوچک‌ترین اندازه جا نمی‌شود؛ عکس را ببینید.",
};

/**
 * عکسِ رندرشده را به مدیر می‌رساند.
 *
 * @returns {Promise<{status: number, error?: string}>}
 *   409 یعنی این درخواست دیگر منتظرِ عکس نیست (قبلاً فرستاده شده، لغو یا
 *   شکست‌خورده اعلام شده) - پس تکرارِ آپلودِ ورک‌فلو هرگز عکسِ دوم نمی‌فرستد.
 */
export async function completeJob(env, id, bytes, fit = "ok") {
  const job = await getJob(env, id);
  if (!job) return { status: 404, error: "no_job" };
  if (job.status !== "rendering") return { status: 409, error: "not_rendering" };
  if (!bytes || bytes.byteLength === 0) return { status: 400, error: "empty" };
  if (bytes.byteLength > MAX_PNG_BYTES) return { status: 413, error: "too_big" };
  if (!looksLikePng(bytes)) return { status: 400, error: "not_png" };

  const label = GENDER_LABEL[job.gender] || "";
  const where = job.batch_total > 1 ? " " + fa(job.batch_pos) + " از " + fa(job.batch_total) : "";
  const caption = "🎓 گواهی" + where + " — " + label + " " + job.name + (FIT_NOTE[fit] || "");

  // فایل (document)، نه عکس: تلگرام عکس را فشرده می‌کند و کیفیتِ ۳۵۸۴ پیکسلی
  // از بین می‌رفت.
  const form = new FormData();
  form.append("chat_id", job.chat_id);
  form.append("caption", caption);
  form.append("document", new Blob([bytes], { type: "image/png" }), "certificate.png");

  let sent = false;
  try {
    const res = await fetch(TG(env, "sendDocument"), {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(90000),
    });
    sent = res.ok;
  } catch {
    sent = false;
  }

  if (!sent) {
    await failJob(env, id, "send");
    return { status: 502, error: "telegram" };
  }
  await finishJob(env, id, "done");
  if (job.batch_id) await refreshBatch(env, job.batch_id);
  return { status: 200 };
}

// ─── گیرکردن ─────────────────────────────────────────────────────

/** هر دسته‌ی تحت‌تأثیر فقط یک بار تازه می‌شود، نه یک بار برای هر ردیف. */
async function refreshAffected(env, rows) {
  const ids = [...new Set(rows.map((r) => r.batch_id).filter(Boolean))];
  for (const id of ids) await refreshBatch(env, id);
}

export async function sweepAndNotify(env, now = Date.now()) {
  const { stale, purged } = await sweep(env, now);
  await refreshAffected(env, stale);
  return { failed: stale.length, purged };
}

/**
 * برای کرانِ پنج‌دقیقه‌ای: فقط وقتی کاری در جریان است چیزی می‌خواند.
 * در روزِ عادی یک خواندنِ یک‌ردیفی از bot_config است و بس.
 */
export async function sweepIfPending(env, now = Date.now()) {
  const flag = await readConfig(env, PENDING_FLAG).catch(() => "");
  if (!flag) return { skipped: true };
  const r = await sweepAndNotify(env, now);
  if ((await countActive(env)) === 0) await writeConfig(env, PENDING_FLAG, "");
  return r;
}

/** پایانِ اجرای ورک‌فلو: هرچه نیمه‌کاره مانده شکست‌خورده است و مدیر باید بداند. */
export async function failLeftovers(env) {
  const rows = await failAllRendering(env);
  await refreshAffected(env, rows);
  return rows.length;
}
