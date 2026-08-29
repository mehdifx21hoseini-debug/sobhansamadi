// آینه‌ی خواندنیِ CRM در D1.
//
// صفحه‌های CRM از n8n می‌خوانند، و هر بار که n8n می‌خوابد کل پنل خالی
// می‌شود: نه لیدی، نه پیگیری‌ای، نه درخواستی. تیم فروش دقیقاً در همان
// ساعتی که باید کار کند، هیچ نمی‌بیند.
//
// همان کاری که برای تقویم اقتصادی جواب داد: یک Cron هر ده دقیقه داده را
// می‌کشد و در D1 می‌ریزد. صفحه اول از n8n می‌خواند - چون تازه‌ترین است -
// و فقط اگر نشد سراغ آینه می‌آید. یعنی در حالت سالم هیچ‌چیز عوض نمی‌شود
// و در حالت خراب، به‌جای صفحه‌ی خالی، داده‌ی کمی کهنه می‌بینی.
//
// چرا هر جدول یک ردیفِ JSON است و نه ستون‌های واقعی: این آینه فقط خوانده
// می‌شود و همان آرایه‌ای را پس می‌دهد که صفحه از n8n انتظار دارد. ساختن
// پانزده جدول با ستون‌های موازی یعنی پانزده جای دیگر که باید با تغییر
// ستون‌های n8n هم‌گام بمانند - و هر کدام یک جای تازه برای واگرایی بی‌صدا.
const DDL = `CREATE TABLE IF NOT EXISTS crm_mirror (
   name TEXT PRIMARY KEY, payload TEXT NOT NULL, rows INTEGER NOT NULL,
   synced_at TEXT NOT NULL)`;

export async function ensureMirrorSchema(env) {
  await env.DB.prepare(DDL).run();
}

// نام‌هایی که n8n می‌فرستد. هر چیز دیگری در پاسخ نادیده گرفته می‌شود، تا
// اضافه شدن یک کلید تازه در آن سمت اینجا چیزی نشکند.
export const MIRRORED = [
  "leads",
  "calls",
  "orders",
  "products",
  "admins",
  "mentoring_requests",
  "support_tickets",
];

/**
 * یک‌بار کشیدن داده از n8n و نوشتنش در آینه.
 *
 * جدولی که در پاسخ نیامده دست‌نخورده می‌ماند، پاک نمی‌شود: یک پاسخ ناقص
 * نباید آینه‌ی سالم را خالی کند. بدترین حالت، کهنه ماندن یک جدول است.
 */
export async function syncCrmMirror(env) {
  if (!env.CRM_EXPORT_URL || !env.ECON_EXPORT_KEY) {
    return { skipped: true, reason: "آدرس یا کلید خروجی تنظیم نشده" };
  }

  const res = await fetch(env.CRM_EXPORT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(25000),
    body: JSON.stringify({ key: env.ECON_EXPORT_KEY }),
  });
  if (!res.ok) throw new Error("خروجی CRM پاسخ نداد: " + res.status);

  const data = await res.json();
  if (!data || data.success !== true) {
    throw new Error("پاسخ نامعتبر: " + (data && data.error ? data.error : "نامشخص"));
  }

  await ensureMirrorSchema(env);
  const now = new Date().toISOString();
  const written = {};
  const statements = [];

  for (const name of MIRRORED) {
    const list = data[name];
    if (!Array.isArray(list)) continue;
    written[name] = list.length;
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO crm_mirror (name, payload, rows, synced_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(name) DO UPDATE SET
               payload = excluded.payload, rows = excluded.rows, synced_at = excluded.synced_at`
        )
        .bind(name, JSON.stringify(list), list.length, now)
    );
  }

  // یکی‌یکی، نه در یک batch: هر ردیف می‌تواند ده‌ها کیلوبایت باشد و یک
  // batch از سقف حجم درخواست D1 رد می‌شود - همان تله‌ای که سر بردارها
  // خوردیم.
  for (const st of statements) await st.run();

  return { synced_at: now, written };
}

/**
 * یک جدول از آینه.
 * @returns {Promise<{rows:Array, synced_at:string}|null>} null یعنی هرگز
 *   همگام نشده - که با «خالی است» یکی نیست.
 */
export async function readMirror(env, name) {
  if (!MIRRORED.includes(name)) return null;
  try {
    await ensureMirrorSchema(env);
    const row = await env.DB
      .prepare(`SELECT payload, synced_at FROM crm_mirror WHERE name = ?`)
      .bind(name)
      .first();
    if (!row) return null;
    return { rows: JSON.parse(row.payload), synced_at: row.synced_at };
  } catch (err) {
    console.error("خواندن آینه‌ی CRM شکست خورد:", name, err && err.message);
    return null;
  }
}

export async function mirrorStatus(env) {
  try {
    await ensureMirrorSchema(env);
    const { results } = await env.DB
      .prepare(`SELECT name, rows, synced_at FROM crm_mirror ORDER BY name`)
      .all();
    return results || [];
  } catch {
    return [];
  }
}
