// رساندن لیدهای ربات به CRM.
//
// چرا اصلاً لازم است: ورکر لید را در D1 می‌نویسد، ولی CRM لیدها را از
// جدول‌های n8n می‌خواند. تا وقتی این دو وصل نشوند، هر ثبت‌نامی که از ربات
// می‌آید در CRM دیده نمی‌شود و مشاور هیچ‌وقت با آن مشتری تماس نمی‌گیرد.
//
// چرا صندوق خروجی (outbox) و نه یک فراخوانی ساده: n8n مرتب قطع می‌شود.
// اگر لید را فقط در لحظه‌ی ثبت می‌فرستادیم، هر قطعی یعنی یک مشتریِ
// از‌دست‌رفته. به‌جای آن نوشتن در D1 و فرستادن به n8n از هم جدا شده‌اند:
//
//   ۱. لید در D1 نوشته می‌شود - این رکورد دائمی است و هرگز گم نمی‌شود
//   ۲. یک ردیف هم در lead_outbox می‌نشیند
//   ۳. بلافاصله یک‌بار تلاش می‌شود بفرستیم (کاربر معطل نمی‌ماند)
//   ۴. اگر نشد، زمان‌بندِ هر ده دقیقه دوباره تلاش می‌کند تا موفق شود
//
// یعنی قطعی n8n فقط باعث تاخیر می‌شود، نه از دست رفتن داده.

const DDL = [
  `CREATE TABLE IF NOT EXISTS lead_outbox (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     payload TEXT NOT NULL,
     created_at TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     last_error TEXT)`,
];

export async function ensureOutbox(env) {
  await env.DB.batch(DDL.map((sql) => env.DB.prepare(sql)));
}

// هر لید موقع ساخته شدن اینجا هم ثبت می‌شود. اگر این نوشتن شکست بخورد
// نباید جلوی پاسخ دادن به کاربر را بگیرد - لید در جدول leads هست و
// می‌شود بعداً دستی هم بازیابی‌اش کرد.
export async function queueLead(env, lead) {
  await ensureOutbox(env);
  await env.DB.prepare(
    `INSERT INTO lead_outbox (payload, created_at) VALUES (?, ?)`
  )
    .bind(JSON.stringify(lead), new Date().toISOString())
    .run();
}

async function postLead(env, lead) {
  // بدون مهلت، یک n8nِ معلق (نه قطع، فقط بی‌جواب) کل پاسخ‌دهی به کاربر را
  // گروگان می‌گیرد. با مهلت، لید در صف می‌ماند و دفعه‌ی بعد فرستاده می‌شود.
  const res = await fetch(env.CRM_LEAD_INTAKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ key: env.CRM_LEAD_INTAKE_KEY, ...lead }),
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
  if (!env.CRM_LEAD_INTAKE_URL || !env.CRM_LEAD_INTAKE_KEY) return { sent: 0, failed: 0, skipped: true };

  await ensureOutbox(env);
  const { results } = await env.DB.prepare(
    `SELECT id, payload, attempts FROM lead_outbox ORDER BY id LIMIT ?`
  )
    .bind(limit)
    .all();

  let sent = 0;
  let failed = 0;

  for (const row of results || []) {
    let lead;
    try {
      lead = JSON.parse(row.payload);
    } catch (err) {
      // محتوای خراب هرگز موفق نمی‌شود؛ نگه داشتنش فقط صندوق را برای همیشه
      // مسدود می‌کند.
      await env.DB.prepare(`DELETE FROM lead_outbox WHERE id = ?`).bind(row.id).run();
      continue;
    }

    try {
      await postLead(env, lead);
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

  return { sent, failed, pending: (results || []).length - sent };
}

// تلاش فوری، بعد از اینکه پاسخ کاربر رفته. اگر شکست بخورد چیزی خراب
// نمی‌شود - ردیف در صندوق می‌ماند و زمان‌بند برش می‌دارد.
export async function flushLeadOutboxSoon(env) {
  return drainLeadOutbox(env, 5).catch((err) => {
    console.error("ارسال فوری لید شکست خورد:", err && err.message);
    return null;
  });
}
