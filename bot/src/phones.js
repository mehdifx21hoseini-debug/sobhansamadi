// دفترچه‌ی شماره‌ها.
//
// تا امروز شماره‌ی کاربر فقط در دو جا می‌نشست: ستون phone در user_state
// - که یک حالت گذراست و با هر فرآیند تازه بازنویسی می‌شود - و جدول
// leads، که فقط کسانی را دارد که تا آخر یک فرم ثبت‌نام رفته‌اند.
//
// یعنی هیچ‌جا فهرستی از «همه‌ی شماره‌هایی که داریم» نبود. این جدول
// همان است: یک ردیف برای هر کاربر، هر بار که شماره‌اش را می‌دهد
// به‌روز می‌شود، و منبعش (کدام بخش شماره را گرفت) کنارش می‌ماند تا در
// خروجی CRM معلوم باشد هر شماره از کجا آمده.
//
// چرا جدا از leads: لید یعنی کسی که درخواست مشاوره یا ثبت‌نام داده و
// باید پیگیری شود. اینجا کسی است که فقط برای دیدن یک دوره‌ی رایگان
// شماره داده - هر دو ارزش دارند، ولی یکی نیستند و ریختنشان در یک جدول
// یعنی صف پیگیری تیم فروش پر می‌شود از کسانی که چیزی نخواسته‌اند.

const DDL = [
  `CREATE TABLE IF NOT EXISTS phone_book (
     telegram_user_id TEXT PRIMARY KEY,
     phone TEXT NOT NULL,
     name TEXT,
     username TEXT,
     sources TEXT NOT NULL DEFAULT '[]',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_phone_book_phone ON phone_book(phone)`,
  `CREATE INDEX IF NOT EXISTS idx_phone_book_created ON phone_book(created_at)`,
];

export async function ensurePhoneSchema(env) {
  for (const sql of DDL) await env.DB.prepare(sql).run();
}

/**
 * شماره را به شکل ۱۱ رقمی با صفر ابتدایی درمی‌آورد.
 *
 * تلگرام شماره را با کد کشور و گاهی با + می‌دهد؛ بدون یکسان‌سازی، یک
 * کاربر می‌تواند دو بار با دو شکل مختلف در خروجی بیاید و شماره‌ها با
 * چیزی که در CRM هست جور درنیایند.
 */
export function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("98")) return "0" + digits.slice(2);
  if (digits.length === 10 && digits.startsWith("9")) return "0" + digits;
  return digits;
}

/** آیا شماره‌ی این کاربر را داریم؟ */
export async function hasPhone(env, telegramUserId) {
  try {
    await ensurePhoneSchema(env);
    const row = await env.DB
      .prepare(`SELECT 1 AS ok FROM phone_book WHERE telegram_user_id = ?`)
      .bind(String(telegramUserId))
      .first();
    return !!row;
  } catch (err) {
    // خطای پایگاه داده نباید در را قفل کند: کاربری که شماره‌اش را قبلاً
    // داده نباید به‌خاطر یک خطای گذرا دوباره پشت دروازه بماند. اینجا
    // false یعنی «دوباره بپرس» که آزاردهنده است ولی امن.
    console.error("خواندن دفترچه‌ی شماره‌ها شکست خورد:", err && err.message);
    return false;
  }
}

/**
 * ثبت یا به‌روزرسانی یک شماره.
 *
 * منبع‌ها روی هم جمع می‌شوند و تکراری نمی‌گیرند: کسی که هم دوره‌ی
 * مقدماتی را باز کرده و هم اکسپرت گرفته، یک ردیف دارد با هر دو منبع -
 * که در خروجی چیزی می‌گوید که دو ردیف جدا نمی‌گفتند.
 */
export async function savePhone(env, { telegramUserId, phone, name, username, source }) {
  const clean = normalizePhone(phone);
  if (!clean) return null;

  await ensurePhoneSchema(env);
  const id = String(telegramUserId);
  const now = new Date().toISOString();

  const existing = await env.DB
    .prepare(`SELECT sources FROM phone_book WHERE telegram_user_id = ?`)
    .bind(id)
    .first();

  let sources = [];
  if (existing) {
    try {
      const parsed = JSON.parse(existing.sources || "[]");
      if (Array.isArray(parsed)) sources = parsed;
    } catch {
      // ستون خراب بهتر است بازنویسی شود تا اینکه کل ثبت را بشکند.
    }
  }
  if (source && !sources.includes(source)) sources.push(source);

  await env.DB
    .prepare(
      `INSERT INTO phone_book (telegram_user_id, phone, name, username, sources, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         phone = excluded.phone,
         -- نام و نام کاربری فقط وقتی به‌روز می‌شوند که مقدار تازه‌ای
         -- باشد: کاربری که نام کاربری‌اش را برداشته، نباید نامی که
         -- قبلاً داشتیم را هم پاک کند.
         name = COALESCE(NULLIF(excluded.name, ''), phone_book.name),
         username = COALESCE(NULLIF(excluded.username, ''), phone_book.username),
         sources = excluded.sources,
         updated_at = excluded.updated_at`
    )
    .bind(id, clean, name || "", username || "", JSON.stringify(sources), now, now)
    .run();

  return { phone: clean, sources };
}

/** تازه‌ترین بالا. برای صفحه‌ی CRM و خروجی. */
/**
 * دفترچه‌ی شماره‌ها، به‌علاوه‌ی دوره‌ای که هر نفر درباره‌اش فرم پر کرده.
 *
 * دوره در phone_book نیست و نباید هم باشد - این جدول فقط «چه کسی شماره
 * داده» را می‌داند. دوره در crm_leads است، پس با یک زیرپرس‌وجو روی
 * شناسه‌ی تلگرام کنارِ هم می‌آیند.
 *
 * یک نفر می‌تواند چند لید داشته باشد (یک بار مشاوره، یک بار ثبت‌نام)، پس
 * دوره‌ها یکتا و در یک رشته جمع می‌شوند نه اینکه ردیف تکرار شود.
 * GROUP_CONCAT در sqlite با DISTINCT جداکننده‌ی دلخواه نمی‌گیرد و «,»
 * می‌گذارد؛ نامِ دوره‌ها کاما ندارند پس امن است.
 *
 * LEFT JOIN عمداً نیست: با JOIN، کسی که هنوز لیدی برایش ساخته نشده از
 * فهرست می‌افتاد - و همان‌ها تازه‌ترین شماره‌ها هستند.
 */
export async function listPhones(env, { limit = 2000 } = {}) {
  await ensurePhoneSchema(env);
  const { results } = await env.DB
    .prepare(
      `SELECT p.telegram_user_id, p.phone, p.name, p.username, p.sources,
              p.created_at, p.updated_at,
              (SELECT GROUP_CONCAT(DISTINCT l.course)
                 FROM crm_leads l
                WHERE l.telegram_user_id = p.telegram_user_id
                  AND l.course IS NOT NULL AND TRIM(l.course) <> '') AS courses,
              (SELECT GROUP_CONCAT(DISTINCT l.request_type)
                 FROM crm_leads l
                WHERE l.telegram_user_id = p.telegram_user_id
                  AND l.request_type IS NOT NULL AND TRIM(l.request_type) <> '') AS request_types
         FROM phone_book p
        ORDER BY p.created_at DESC LIMIT ?`
    )
    .bind(Math.min(Number(limit) || 2000, 5000))
    .all();

  return (results || []).map((r) => ({
    telegram_user_id: r.telegram_user_id,
    phone: r.phone,
    name: r.name,
    username: r.username,
    created_at: r.created_at,
    updated_at: r.updated_at,
    sources: safeList(r.sources),
    courses: splitList(r.courses),
    request_types: splitList(r.request_types),
  }));
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function phoneStats(env) {
  try {
    await ensurePhoneSchema(env);
    const row = await env.DB
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last7
           FROM phone_book`
      )
      .bind(new Date(Date.now() - 7 * 86400000).toISOString())
      .first();
    return { total: (row && row.total) || 0, last7: (row && row.last7) || 0 };
  } catch {
    return { total: 0, last7: 0 };
  }
}

function safeList(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
