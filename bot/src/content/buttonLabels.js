// نامِ دکمه‌های منوی اصلی: خواندن، عوض کردن، و مسیریابیِ امن.
//
// ─── چرا این ماژول از یک setSectionBody ساده پیچیده‌تر است ─────────
//
// منوی اصلی یک reply keyboard است، نه inline. تلگرام آن را سمتِ خودِ
// کاربر کش می‌کند و تا وقتی دوباره /start نزند، همان کیبوردِ قدیمی را
// می‌بیند. وقتی کاربر دکمه را می‌زند، چیزی که به ربات می‌رسد callback
// نیست - خودِ متنِ دکمه است، و resolveMenuAction از روی همان متن
// می‌فهمد کدام بخش را باز کند.
//
// نتیجه‌اش این است: لحظه‌ای که مدیر نامِ یک دکمه را عوض می‌کند، برای
// هزاران کاربری که کیبوردِ قبلی را دارند آن دکمه **بی‌صدا از کار
// می‌افتد**. می‌زنند و هیچ اتفاقی نمی‌افتد، چون متنی که فرستاده‌اند
// دیگر در هیچ فهرستی نیست.
//
// همین تله قبلاً هم خورده شده: LEGACY_LABELS در menu.js دستی نگه داشته
// می‌شود و سه نسل نامِ قدیمی در آن جمع شده. با ویرایشگر، این دیگر
// دستی ممکن نیست - هر تغییر باید نامِ قبلی را خودش نگه دارد.
//
// پس هر ردیف علاوه بر نامِ فعلی، فهرستِ همه‌ی نام‌هایی را که تا امروز
// داشته هم نگه می‌دارد، و مسیریابی هر دو را می‌پذیرد.

import { cached, invalidate } from "../cache.js";
import { MENU_LABELS } from "../menu.js";

const DDL = `CREATE TABLE IF NOT EXISTS button_labels (
   key TEXT PRIMARY KEY, label TEXT, past TEXT, updated_at TEXT)`;

let schemaReady = false;

async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.prepare(DDL).run();
  schemaReady = true;
}

// دکمه‌های منوی اصلی - آن‌هایی که مسیریابی‌شان از روی متن است و
// عوض کردنِ نامشان احتیاط می‌خواهد.
//
// دکمه‌های زیرمجموعه (inline) پایینِ همین فایل‌اند، در INLINE_GROUPS،
// و ساز و کارِ ساده‌تری دارند.
export const EDITABLE_BUTTONS = [
  { key: "ECON_CALENDAR", hint: "تقویم اقتصادی و سشن‌های بازار" },
  { key: "FREE_COURSES", hint: "دوره‌های رایگان" },
  { key: "LIBRARY", hint: "کتاب‌های روانشناسی" },
  { key: "PSY_VOICES", hint: "ویس‌های روانشناسی" },
  { key: "EXPERT", hint: "اکسپرت مدیریت سرمایه" },
  { key: "LIVE_TRADE", hint: "ویدیوهای لایو ترید" },
  { key: "CONSULT", hint: "ثبت‌نام مجموعه پیشرفته" },
  { key: "TRUSTED_BROKER", hint: "بروکر معتمد" },
  { key: "SUPPORT", hint: "پشتیبانی" },
  { key: "ABOUT_US", hint: "درباره ما" },
];

const EDITABLE_KEYS = EDITABLE_BUTTONS.map((b) => b.key);

export const LABEL_MAX = 48;

const CACHE_KEY = "button-labels";
// یک دقیقه. مسیریابیِ متن روی داغ‌ترین مسیرِ ربات است - هر پیامِ متنیِ
// هر کاربر از آن رد می‌شود - و روزی که سقفِ خواندنِ D1 پر شد، ریشه‌اش
// دقیقاً همین‌جور خواندنِ تکراری بود. یک دقیقه یعنی مدیر نتیجه‌ی
// ویرایشش را تقریباً بی‌درنگ می‌بیند، و کش هم بعد از هر ذخیره صریحاً
// باطل می‌شود.
const TTL_MS = 60_000;

/**
 * ردیف‌های ذخیره‌شده: { KEY: { label, past: [] } }
 *
 * خطای دیتابیس اینجا کشنده نیست و عمداً بلعیده می‌شود: اگر این خواندن
 * بشکند، منو باید با نام‌های پیش‌فرض بالا بیاید، نه اینکه اصلاً نیاید.
 */
async function loadRows(env) {
  return cached(CACHE_KEY, TTL_MS, async () => {
    try {
      await ensureSchema(env);
      const res = await env.DB.prepare(
        `SELECT key, label, past FROM button_labels`
      ).all();
      const out = {};
      for (const r of res.results || []) {
        if (!EDITABLE_KEYS.includes(r.key) && !INLINE_DEFAULTS[r.key]) continue;
        let past = [];
        try {
          const parsed = JSON.parse(r.past || "[]");
          if (Array.isArray(parsed)) past = parsed.filter((x) => typeof x === "string");
        } catch {
          // ردیفِ خراب نباید کلِ منو را ببرد.
        }
        out[r.key] = { label: String(r.label || ""), past };
      }
      return out;
    } catch (err) {
      console.error("خواندن نام دکمه‌ها:", err && err.message);
      return {};
    }
  });
}

/**
 * نامِ نهاییِ هر دکمه: ویرایش‌شده اگر بود، وگرنه پیش‌فرض.
 *
 * همیشه همه‌ی کلیدها را دارد، پس صداکننده لازم نیست به fallback فکر
 * کند.
 */
export async function getLabels(env) {
  const rows = await loadRows(env);
  const out = {};
  for (const key of Object.keys(MENU_LABELS)) {
    const row = rows[key];
    out[key] = row && row.label ? row.label : MENU_LABELS[key];
  }
  return out;
}

/**
 * هر متنی که باید به یک کنش مسیریابی شود → کلیدِ آن کنش.
 *
 * ترتیب اهمیت دارد فقط در یک حالت: اگر نامِ تازه‌ی یک دکمه با نامِ
 * قدیمیِ دکمه‌ی دیگری یکی باشد. نامِ فعلی برنده است، چون همان چیزی است
 * که کاربر همین حالا روی صفحه می‌بیند.
 */
export async function labelRoutes(env) {
  const rows = await loadRows(env);
  const map = new Map();

  // ۱. پیش‌فرض‌ها. حتی وقتی دکمه‌ای تغییرِ نام داده، نامِ پیش‌فرضش باید
  //    کار کند: کیبوردهای کش‌شده هنوز همان را می‌فرستند.
  for (const [key, label] of Object.entries(MENU_LABELS)) map.set(label, key);

  // فقط کلیدهای منوی اصلی. ردیف‌های دکمه‌های زیرمجموعه هم در همین
  // جدول‌اند و بدونِ این فیلتر وارد نقشه‌ی مسیریابی می‌شدند - یعنی
  // اگر مدیر نامِ یک دکمه‌ی inline را عوض می‌کرد و کاربری همان متن را
  // می‌نوشت، resolveMenuAction یک «کنشِ» بی‌معنی برمی‌گرداند. و چون
  // مقدارش truthy است، کاربری که وسطِ یک فرم بود از فرمش می‌افتاد.
  const menuRow = (key) => EDITABLE_KEYS.includes(key);

  // ۲. نام‌های قبلیِ ثبت‌شده - به همان دلیل.
  for (const [key, row] of Object.entries(rows)) {
    if (!menuRow(key)) continue;
    for (const old of row.past) if (old) map.set(old, key);
  }

  // ۳. و نامِ فعلی، که بر هر دوی بالا می‌چربد.
  for (const [key, row] of Object.entries(rows)) {
    if (menuRow(key) && row.label) map.set(row.label, key);
  }

  return map;
}

/** آیا این متن نامِ دکمه‌ی دیگری است؟ برای جلوگیری از دو دکمه‌ی هم‌نام. */
export async function conflictingKey(env, key, label) {
  const routes = await labelRoutes(env);
  const owner = routes.get(label);
  return owner && owner !== key ? owner : null;
}

/**
 * نامِ تازه را می‌نشاند و نامِ قبلی را به فهرستِ نام‌های قدیمی می‌برد.
 *
 * نگه داشتنِ نامِ قبلی اختیاری نیست: بدون آن، هر کسی که کیبوردش
 * به‌روز نشده دکمه‌ای می‌زند که دیگر شناخته نمی‌شود.
 */
export async function setLabel(env, key, label) {
  if (!EDITABLE_KEYS.includes(key) && !INLINE_DEFAULTS[key]) {
    throw new Error("کلید ناشناخته: " + key);
  }
  await ensureSchema(env);

  const rows = await loadRows(env);
  const current = (rows[key] && rows[key].label) || MENU_LABELS[key] || INLINE_DEFAULTS[key];
  const past = new Set((rows[key] && rows[key].past) || []);
  // پیش‌فرض هم یک «نامِ قبلی» است - همان اولین باری که عوض می‌شود.
  if (current && current !== label) past.add(current);
  past.delete(label);

  await env.DB.prepare(
    `INSERT INTO button_labels (key, label, past, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET label = excluded.label,
         past = excluded.past, updated_at = excluded.updated_at`
  )
    .bind(key, label, JSON.stringify([...past]), new Date().toISOString())
    .run();

  invalidate(CACHE_KEY);
}

/**
 * برگرداندن به نامِ پیش‌فرض.
 *
 * ردیف پاک نمی‌شود، فقط label خالی می‌شود: فهرستِ نام‌های قبلی باید
 * بماند، وگرنه کاربری که کیبوردش رویِ نامِ وسطی گیر کرده به بن‌بست
 * می‌خورد.
 */
export async function resetLabel(env, key) {
  if (!EDITABLE_KEYS.includes(key) && !INLINE_DEFAULTS[key]) return;
  await ensureSchema(env);

  const rows = await loadRows(env);
  const current = (rows[key] && rows[key].label) || "";
  const past = new Set((rows[key] && rows[key].past) || []);
  if (current) past.add(current);
  past.delete(MENU_LABELS[key] || INLINE_DEFAULTS[key]);

  await env.DB.prepare(
    `INSERT INTO button_labels (key, label, past, updated_at) VALUES (?, '', ?, ?)
       ON CONFLICT(key) DO UPDATE SET label = '',
         past = excluded.past, updated_at = excluded.updated_at`
  )
    .bind(key, JSON.stringify([...past]), new Date().toISOString())
    .run();

  invalidate(CACHE_KEY);
}

/** برای صفحه‌ی ویرایش: نامِ فعلی، پیش‌فرض، و اینکه عوض شده یا نه. */
export async function labelState(env, key) {
  const rows = await loadRows(env);
  const def = MENU_LABELS[key] || "";
  const row = rows[key];
  const label = row && row.label ? row.label : def;
  return { label, def, custom: label !== def, past: (row && row.past) || [] };
}

// ─── دکمه‌های زیرمجموعه (inline) ──────────────────────────────────
//
// این‌ها با callback_data مسیریابی می‌شوند نه با متن، پس عوض کردنِ
// نامشان هیچ‌چیز را نمی‌شکند - برخلافِ دکمه‌های منوی اصلی. به همین
// دلیل نه فهرستِ نام‌های قبلی لازم دارند نه احتیاطِ تعارض.
//
// شناسه‌ی تطبیق، خودِ «متنِ پیش‌فرض» است نه callback_data. دو دلیل:
//
//   ۱. یک callback چند برچسبِ متفاوت دارد. ECON_TODAY در سه صفحه سه
//      نام دارد: «📅 امروز»، «📅 اخبار امروز»، و «🔄 بروزرسانی».
//      کلید گرفتنِ callback یعنی هر سه با هم عوض می‌شوند.
//   ۲. و برعکس: «🔄 بروزرسانی» زیرِ چهار callbackِ مختلف است. مدیری
//      که می‌خواهد این کلمه را عوض کند، انتظار دارد همه‌جا عوض شود،
//      نه چهار بار.
//
// نتیجه: مدیر «یک نوشته» را عوض می‌کند و همه‌جا عوض می‌شود - همان
// مدلی که در ذهنش هست.
export const INLINE_GROUPS = [
  {
    id: "EXPERT",
    title: "🤖 اکسپرت",
    items: [
      ["INL_EXP_VIDEOS", "🎬 رونمایی و آموزش نصب"],
      ["INL_EXP_MT4", "📥 فایل متاتریدر ۴"],
      ["INL_EXP_MT5", "📥 فایل متاتریدر ۵"],
      ["INL_EXP_FAQ", "❓ سوالات پرتکرار"],
    ],
  },
  {
    id: "ECON",
    title: "📅 تقویم اقتصادی",
    items: [
      ["INL_ECON_TODAY_LONG", "📅 اخبار امروز"],
      ["INL_ECON_TODAY", "📅 امروز"],
      ["INL_ECON_WEEK", "📆 این هفته"],
      ["INL_ECON_NEXT", "⏭ رویداد بعدی"],
      ["INL_ECON_HOL", "🏦 تعطیلات"],
      ["INL_ECON_HOL_LONG", "🏦 تعطیلات پیشِ رو"],
      ["INL_ECON_AI", "🤖 تحلیل هوش مصنوعی"],
      ["INL_ECON_AI_SHORT", "🤖 توضیح AI"],
      ["INL_ECON_AI_ONE", "🤖 توضیح این خبر"],
      ["INL_ECON_ALERTS", "🔔 تنظیمات هشدار"],
      ["INL_ECON_CCY", "🌍 فیلتر ارزها"],
      ["INL_ECON_REFRESH", "🔄 بروزرسانی"],
    ],
  },
  {
    id: "COURSES",
    title: "🎓 دوره‌ها",
    items: [
      ["INL_FREE_INTRO", "📚 دوره مقدماتی"],
      ["INL_FREE_EQ", "🧠 دوره هوش هیجانی"],
      ["INL_ADVANCED", "🎓 مجموعه آموزشی پیشرفته"],
      ["INL_OWN_BOOK", "📕 کتاب من: ذهن ثروتمند یک معامله‌گر"],
    ],
  },
  {
    id: "BROKER",
    title: "🏦 بروکر",
    items: [
      ["INL_BRK_SIGNUP", "🏦 لینک ثبت نام در بروکر معتمد"],
      ["INL_BRK_HOWTO", "🎬 آموزش ثبت‌نام"],
      ["INL_BRK_DEPOSIT", "🎬 آموزش واریز و برداشت"],
    ],
  },
  {
    id: "ABOUT",
    title: "ℹ️ درباره ما و ارتباط",
    items: [
      ["INL_ABOUT", "🏛 درباره آکادمی"],
      ["INL_CONTACT", "📞 تماس با ما"],
      ["INL_CHANNEL", "📢 کانال تلگرام"],
      ["INL_INSTA", "📸 اینستاگرام"],
    ],
  },
  {
    id: "NAV",
    title: "↩️ ناوبری",
    items: [
      ["INL_NAV_HOME", "🏠 منوی اصلی"],
      ["INL_NAV_BACK", "🔙 بازگشت"],
      ["INL_NAV_BACK2", "⬅️ بازگشت"],
      ["INL_NAV_ECON", "⬅️ منوی تقویم"],
      ["INL_NAV_LIB", "🔙 بازگشت به کتابخانه"],
    ],
  },
];

// کلید → متنِ پیش‌فرض، و برعکس.
export const INLINE_DEFAULTS = {};
for (const g of INLINE_GROUPS) {
  for (const [key, def] of g.items) INLINE_DEFAULTS[key] = def;
}

const INLINE_KEYS = Object.keys(INLINE_DEFAULTS);

/** { متنِ پیش‌فرض → متنِ تازه } - فقط برای آن‌هایی که واقعاً عوض شده‌اند. */
export async function inlineRewrites(env) {
  const rows = await loadRows(env);
  const out = new Map();
  for (const key of INLINE_KEYS) {
    const row = rows[key];
    if (row && row.label && row.label !== INLINE_DEFAULTS[key]) {
      out.set(INLINE_DEFAULTS[key], row.label);
    }
  }
  return out;
}

/** وضعیتِ یک دکمه‌ی زیرمجموعه، برای صفحه‌ی ویرایش. */
export async function inlineState(env, key) {
  const rows = await loadRows(env);
  const def = INLINE_DEFAULTS[key] || "";
  const row = rows[key];
  const label = row && row.label ? row.label : def;
  return { label, def, custom: label !== def };
}
