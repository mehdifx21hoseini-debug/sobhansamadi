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

// کلیدهایی که قابلِ ویرایش‌اند: همان دکمه‌های منوی اصلی.
//
// دکمه‌های inline عمداً اینجا نیستند. آن‌ها هر بار از نو ساخته می‌شوند و
// با callback_data مسیریابی می‌شوند نه با متن، پس عوض کردنشان هیچ‌وقت
// چیزی را نمی‌شکند - و فهرستِ بلندتر، پیدا کردنِ همین ده‌تا را سخت‌تر
// می‌کرد.
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
        if (!EDITABLE_KEYS.includes(r.key)) continue;
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

  // ۲. نام‌های قبلیِ ثبت‌شده - به همان دلیل.
  for (const [key, row] of Object.entries(rows)) {
    for (const old of row.past) if (old) map.set(old, key);
  }

  // ۳. و نامِ فعلی، که بر هر دوی بالا می‌چربد.
  for (const [key, row] of Object.entries(rows)) {
    if (row.label) map.set(row.label, key);
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
  if (!EDITABLE_KEYS.includes(key)) throw new Error("کلید ناشناخته: " + key);
  await ensureSchema(env);

  const rows = await loadRows(env);
  const current = (rows[key] && rows[key].label) || MENU_LABELS[key];
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
  if (!EDITABLE_KEYS.includes(key)) return;
  await ensureSchema(env);

  const rows = await loadRows(env);
  const current = (rows[key] && rows[key].label) || "";
  const past = new Set((rows[key] && rows[key].past) || []);
  if (current) past.add(current);
  past.delete(MENU_LABELS[key]);

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
