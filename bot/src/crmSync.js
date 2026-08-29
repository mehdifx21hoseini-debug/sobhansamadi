// صندوق خروجی: هر چیزی که باید به CRM برسد.
//
// چرا اصلاً لازم است: داده در D1 نوشته می‌شود، ولی CRM از جدول‌های n8n
// می‌خواند. تا وقتی این دو وصل نشوند، هر ثبت‌نامی در CRM دیده نمی‌شود و
// مشاور هیچ‌وقت با آن مشتری تماس نمی‌گیرد.
//
// چرا صندوق و نه یک فراخوانی ساده: n8n مرتب قطع می‌شود. اگر در لحظه‌ی
// ثبت می‌فرستادیم، هر قطعی یعنی یک مشتریِ از‌دست‌رفته. به‌جای آن نوشتن و
// فرستادن از هم جدا شده‌اند:
//
//   ۱. داده در D1 نوشته می‌شود - رکورد دائمی، هرگز گم نمی‌شود
//   ۲. یک ردیف هم در صندوق می‌نشیند
//   ۳. بلافاصله یک‌بار تلاش می‌شود (فرستنده معطل نمی‌ماند)
//   ۴. اگر نشد، زمان‌بندِ هر ده دقیقه دوباره تلاش می‌کند تا موفق شود
//
// یعنی قطعی n8n فقط باعث تاخیر می‌شود، نه از دست رفتن داده.
//
// نام جدول هنوز lead_outbox است. عوض نشد چون ردیف‌های زنده داخلش هست و
// تغییر نامِ یک جدولِ در حال کار، برای زیباتر شدن یک اسم، ریسکی است که
// چیزی برنمی‌گرداند. ستون kind می‌گوید هر ردیف کجا باید برود.

import { OWNER_ID } from "./owner.js";

const DDL = [
  `CREATE TABLE IF NOT EXISTS lead_outbox (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     payload TEXT NOT NULL,
     created_at TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     last_error TEXT)`,
];

// دو ستونی که بعداً اضافه شدند. مقدار پیش‌فرضِ kind عمداً 'lead' است تا
// ردیف‌هایی که از قبل در صندوق مانده‌اند همان‌طور که بودند فرستاده شوند.
const MIGRATIONS = [
  // «برای این ردیف هشدار داده شد» - تا هر ده دقیقه همان هشدار تکرار نشود.
  `ALTER TABLE lead_outbox ADD COLUMN alerted_at TEXT`,
  `ALTER TABLE lead_outbox ADD COLUMN kind TEXT NOT NULL DEFAULT 'lead'`,
];

export async function ensureOutbox(env) {
  await env.DB.batch(DDL.map((sql) => env.DB.prepare(sql)));
  for (const sql of MIGRATIONS) {
    try {
      await env.DB.prepare(sql).run();
    } catch (err) {
      // ستون از قبل هست - حالت عادی بعد از اولین اجرا.
      if (!/duplicate column/i.test(String(err && err.message))) throw err;
    }
  }
}

/**
 * گذاشتن یک چیز در صف، برای رسیدن به CRM.
 *
 * اگر این نوشتن شکست بخورد نباید جلوی پاسخ دادن به فرستنده را بگیرد -
 * خودِ داده جای دیگری ذخیره شده و می‌شود بعداً دستی بازیابی‌اش کرد.
 *
 * @param {"lead"|"mentoring"} kind کدام مقصد.
 */
export async function queueOutbound(env, kind, payload) {
  await ensureOutbox(env);
  await env.DB.prepare(
    `INSERT INTO lead_outbox (kind, payload, created_at) VALUES (?, ?, ?)`
  )
    .bind(kind, JSON.stringify(payload), new Date().toISOString())
    .run();
}

export function queueLead(env, lead) {
  return queueOutbound(env, "lead", lead);
}

// هر نوع، یک مقصد.
//
// جدا نگه داشتن این‌ها از حلقه‌ی ارسال یعنی اضافه کردن مقصد بعدی (پرداخت،
// تیکت پشتیبانی) فقط یک ورودی در این جدول است، نه یک شاخه‌ی تازه در
// منطق تلاش‌مجدد و هشدار - همان منطقی که تازه درستش کرده‌ایم.
const TARGETS = {
  lead: {
    url: (env) => env.CRM_LEAD_INTAKE_URL,
    ready: (env) => !!(env.CRM_LEAD_INTAKE_URL && env.CRM_LEAD_INTAKE_KEY),
    // این وبهوک کلید را داخل بدنه می‌خواهد، نه در هدر.
    request: (env, payload) => ({
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: env.CRM_LEAD_INTAKE_KEY, ...payload }),
    }),
    describe: (p) => (p.full_name || "بدون نام") + " — " + (p.phone || "بدون شماره"),
  },
  mentoring: {
    url: (env) => env.CRM_MENTORING_INTAKE_URL,
    ready: (env) => !!(env.CRM_MENTORING_INTAKE_URL && env.MENTORING_INTAKE_KEY),
    // و این یکی در هدر. تفاوتشان تاریخی است، نه طراحی.
    request: (env, payload) => ({
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.MENTORING_INTAKE_KEY,
      },
      body: JSON.stringify(payload),
    }),
    describe: (p) => (p.full_name || "بدون نام") + " — " + (p.phone || "بدون شماره") + " (منتورینگ)",
  },
};

async function postOutbound(env, kind, payload) {
  const target = TARGETS[kind];
  if (!target) throw new Error("نوع ناشناخته در صندوق: " + kind);

  // بدون مهلت، یک n8nِ معلق (نه قطع، فقط بی‌جواب) کل پاسخ‌دهی را گروگان
  // می‌گیرد. با مهلت، ردیف در صف می‌ماند و دفعه‌ی بعد فرستاده می‌شود.
  const res = await fetch(target.url(env), {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    ...target.request(env, payload),
  });

  if (!res.ok) throw new Error("پاسخ ناموفق از n8n: " + res.status);

  const data = await res.json();
  if (!data || data.success !== true) {
    throw new Error("پاسخ نامعتبر از n8n: " + (data && data.error ? data.error : "نامشخص"));
  }
  return data;
}

// صندوق را خالی می‌کند. هر ردیف مستقل است: شکست یکی بقیه را متوقف نمی‌کند،
// فقط شمارنده‌ی تلاشش بالا می‌رود تا در لاگ پیدا باشد.
export async function drainLeadOutbox(env, limit = 20) {
  const ready = Object.keys(TARGETS).filter((k) => TARGETS[k].ready(env));
  // هیچ مقصدی تنظیم نشده: کاری از دست‌مان برنمی‌آید و ردیف‌ها سر جایشان
  // می‌مانند تا تنظیم شود.
  if (ready.length === 0) return { sent: 0, failed: 0, skipped: true };

  await ensureOutbox(env);
  // فقط انواعی که مقصدشان تنظیم شده برداشته می‌شوند. وگرنه یک نوعِ
  // تنظیم‌نشده هر بار شمارنده‌اش بالا می‌رفت و بی‌خود هشدار می‌داد.
  const { results } = await env.DB.prepare(
    `SELECT id, kind, payload, attempts FROM lead_outbox
       WHERE kind IN (${ready.map(() => "?").join(", ")}) ORDER BY id LIMIT ?`
  )
    .bind(...ready, limit)
    .all();

  let sent = 0;
  let failed = 0;

  for (const row of results || []) {
    let payload;
    try {
      payload = JSON.parse(row.payload);
    } catch (err) {
      // محتوای خراب هرگز موفق نمی‌شود؛ نگه داشتنش فقط صندوق را برای همیشه
      // مسدود می‌کند.
      await env.DB.prepare(`DELETE FROM lead_outbox WHERE id = ?`).bind(row.id).run();
      continue;
    }

    try {
      await postOutbound(env, row.kind || "lead", payload);
      await env.DB.prepare(`DELETE FROM lead_outbox WHERE id = ?`).bind(row.id).run();
      sent++;
    } catch (err) {
      failed++;
      await env.DB.prepare(
        `UPDATE lead_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?`
      )
        .bind(String(err && err.message).slice(0, 300), row.id)
        .run();
    }
  }

  const alerted = await alertOnStuckLeads(env);
  return { sent, failed, pending: (results || []).length - sent, alerted };
}

// بعد از چند تلاش ناموفق، دیگر «تاخیر» نیست.
//
// صندوق تا ابد تلاش می‌کند، که درست است - ولی اگر لیدی برای همیشه شکست
// بخورد، تنها نشانه‌اش یک عددِ attempts است که هیچ‌کس نگاهش نمی‌کند.
// یعنی یک مشتری واقعی که هیچ‌وقت با او تماس گرفته نمی‌شود و هیچ‌کس
// نمی‌فهمد. دقیقاً همان چیزی که سر فرم منتورینگ سه هفته طول کشید.
const ALERT_AFTER_ATTEMPTS = 3;

async function alertOnStuckLeads(env) {
  if (!env.BOT_TOKEN) return 0;

  const { results } = await env.DB
    .prepare(
      `SELECT id, kind, payload, attempts, last_error, created_at FROM lead_outbox
         WHERE attempts >= ? AND alerted_at IS NULL ORDER BY id LIMIT 10`
    )
    .bind(ALERT_AFTER_ATTEMPTS)
    .all();

  const stuck = results || [];
  if (stuck.length === 0) return 0;

  const lines = [
    "⚠️ چند لید به CRM نرسیده‌اند",
    "",
    "این‌ها در ربات ثبت شده‌اند و از بین نرفته‌اند، ولی " +
      ALERT_AFTER_ATTEMPTS +
      " بار تلاش برای فرستادنشان به CRM شکست خورده. یعنی در فهرست لیدهای مشاورها دیده نمی‌شوند.",
    "",
  ];

  for (const row of stuck) {
    let who = "ردیف " + row.id;
    try {
      const target = TARGETS[row.kind || "lead"];
      who = target ? target.describe(JSON.parse(row.payload)) : who;
    } catch {
      // محتوای خراب: شناسه‌اش را می‌گوییم، که برای پیدا کردنش کافی است.
    }
    lines.push("• " + who);
    if (row.last_error) lines.push("   " + String(row.last_error).slice(0, 120));
  }

  lines.push("");
  lines.push("معمولاً یعنی n8n قطع است. وقتی برگردد، خودشان فرستاده می‌شوند.");

  try {
    const res = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ chat_id: OWNER_ID, text: lines.join("\n") }),
    });
    if (!res.ok) throw new Error("تلگرام پاسخ نداد: " + res.status);
  } catch (err) {
    // هشدار نرفت. عمداً alerted_at ست نمی‌شود تا اجرای بعدی دوباره
    // تلاش کند - وگرنه هشداری که یک‌بار نرسید، هرگز نمی‌رسید.
    console.error("هشدار لیدهای گیرکرده فرستاده نشد:", err && err.message);
    return 0;
  }

  const now = new Date().toISOString();
  await env.DB.batch(
    stuck.map((row) =>
      env.DB.prepare(`UPDATE lead_outbox SET alerted_at = ? WHERE id = ?`).bind(now, row.id)
    )
  );
  return stuck.length;
}

// تلاش فوری، بعد از اینکه پاسخ کاربر رفته. اگر شکست بخورد چیزی خراب
// نمی‌شود - ردیف در صندوق می‌ماند و زمان‌بند برش می‌دارد.
export async function flushLeadOutboxSoon(env) {
  return drainLeadOutbox(env, 5).catch((err) => {
    console.error("ارسال فوری لید شکست خورد:", err && err.message);
    return null;
  });
}
