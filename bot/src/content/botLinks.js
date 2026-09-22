// لینک‌های ربات: خواندن، عوض کردن، و جای‌گزینی سرتاسری.
//
// خواهرِ buttonLabels.js است و همان ساز و کار را دارد - جدولِ خودش،
// کشِ یک‌دقیقه‌ای، و تطبیق از روی «مقدارِ پیش‌فرض».
//
// ─── چه چیزی اینجاست و چه چیزی عمداً نیست ────────────────────────
//
// فقط لینک‌هایی که کاربر می‌بیند و آکادمی ممکن است جابه‌جایشان کند:
// ثبت‌نامِ بروکر، صفحه‌ی سوالات، اینستاگرام، کانال، صفحه‌ی کتاب و دوره.
//
// آدرس‌های زیرساخت اینجا نیستند و نباید بیایند: وبهوک‌های n8n، فید
// ForexFactory، سرویسِ تعطیلات، و آدرسِ خودِ ورکر. آن‌ها قراردادِ بین دو
// سامانه‌اند نه محتوا؛ عوض شدنشان از داخلِ تلگرام یعنی یک بخشِ ربات
// بی‌صدا از کار بیفتد بدونِ اینکه کسی بفهمد چرا.
//
// آدرسِ آزمونِ تعیین سطح هم اینجا نیست، چون ویرایشگرِ خودش را دارد
// (/setquiz) و دو مرجع برای یک مقدار یعنی هر بار باید حدس زد کدام
// برنده است.

import { cached, invalidate } from "../cache.js";

const DDL = `CREATE TABLE IF NOT EXISTS bot_links (
   key TEXT PRIMARY KEY, url TEXT, updated_at TEXT)`;

let schemaReady = false;

async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.prepare(DDL).run();
  schemaReady = true;
}

export const LINK_MAX = 300;

// def همان رشته‌ای است که در کد نوشته شده و باید **حرف‌به‌حرف** با آن
// یکی باشد؛ تطبیق از روی همین انجام می‌شود. تستی هست که کلِ bot/src را
// می‌خواند و اگر یکی‌شان دیگر در کد نباشد قرمز می‌شود - چون در آن حالت
// ویرایش ذخیره می‌شود ولی روی هیچ‌چیز اثر نمی‌گذارد.
export const LINKS = [
  {
    key: "BROKER_SIGNUP",
    title: "🏦 ثبت‌نام در بروکر معتمد",
    def: "https://km.mywmportal.com/?pt=41263",
    note: "pt=41263 شناسه‌ی معرف است. اگر لینک تازه این شناسه را نداشته باشد، پورسانتِ ثبت‌نام‌ها از دست می‌رود.",
  },
  {
    key: "EXPERT_FAQ",
    title: "❓ سوالات پرتکرار اکسپرت",
    def: "https://sobhansamadi.com/%D9%85%D8%AF%DB%8C%D8%B1%DB%8C%D8%AA-%D8%AD%D8%B1%D9%81%D9%87-%D8%A7%DB%8C-%D9%85%D8%B9%D8%A7%D9%85%D9%84%D8%A7%D8%AA-%D8%AF%D8%B1-ssprox/",
  },
  {
    key: "TG_CHANNEL",
    title: "📢 کانال تلگرام",
    def: "https://t.me/sobhanforex",
    note: "این همان کانالی است که دروازه‌ی عضویت هم چکش می‌کند؛ با عوض کردنش هر دو با هم عوض می‌شوند.",
    // t.me/<username> - چون از همین، نامِ کانالِ دروازه درمی‌آید.
    telegram: true,
  },
  {
    key: "INSTAGRAM",
    title: "📸 اینستاگرام",
    def: "https://instagram.com/sobhansamaddi",
  },
  {
    key: "INSTAGRAM_LONG",
    title: "📸 اینستاگرام (دکمه‌ی بلند)",
    def: "https://www.instagram.com/sobhansamaddi/",
    note: "همان پیج است ولی در کد دو شکلِ مختلف نوشته شده؛ هر دو را عوض کنید.",
  },
  {
    key: "OWN_BOOK",
    title: "📕 صفحه‌ی خریدِ کتاب",
    def: "https://sobhansamadi.com/the-rich-mind-of-a-trader/",
  },
  {
    key: "EQ_COURSE",
    title: "🧠 صفحه‌ی دوره‌ی هوش هیجانی",
    def: "https://sobhansamadi.com/مجموعه-آموزشی-هوش-هیجانی/",
  },
];

const BY_KEY = Object.fromEntries(LINKS.map((l) => [l.key, l]));

const CACHE_KEY = "bot-links";
const TTL_MS = 60_000;

async function loadRows(env) {
  return cached(CACHE_KEY, TTL_MS, async () => {
    try {
      await ensureSchema(env);
      const res = await env.DB.prepare(`SELECT key, url FROM bot_links`).all();
      const out = {};
      for (const r of res.results || []) {
        if (BY_KEY[r.key] && r.url) out[r.key] = String(r.url);
      }
      return out;
    } catch (err) {
      // مثلِ نامِ دکمه‌ها: خطای دیتابیس نباید صفحه را از کار بیندازد.
      // بدترین حالت، همان لینک‌های پیش‌فرضِ کد است.
      console.error("خواندن لینک‌ها:", err && err.message);
      return {};
    }
  });
}

/** { کلید → آدرسِ نهایی } - همیشه کامل. */
export async function getLinks(env) {
  const rows = await loadRows(env);
  const out = {};
  for (const l of LINKS) out[l.key] = rows[l.key] || l.def;
  return out;
}

/**
 * { آدرسِ پیش‌فرض → آدرسِ تازه } - فقط برای آن‌هایی که عوض شده‌اند.
 *
 * همین نقشه هم روی دکمه‌ها به کار می‌رود هم داخلِ متنِ پیام‌ها: لینکِ
 * بروکر در کپشنِ یکی از ویدیوها هم نوشته شده، نه فقط روی دکمه.
 */
export async function linkRewrites(env) {
  const rows = await loadRows(env);
  const out = new Map();
  for (const l of LINKS) {
    const next = rows[l.key];
    if (!next || next === l.def) continue;
    // هر دو املا ثبت می‌شوند: خام، و درصدکدشده.
    //
    // چون بعضی جاها در کد encodeURI روی آدرس اجرا می‌شود - مثلاً
    // صفحه‌ی دوره‌ی هوش هیجانی که مسیرش فارسی است. آن‌وقت چیزی که
    // واقعاً روی دکمه می‌نشیند شکلِ درصدکدشده است، نه رشته‌ای که در
    // کد نوشته شده، و تطبیقِ تک‌املایی بی‌صدا رد می‌شد: مدیر آدرس را
    // عوض می‌کرد، ذخیره می‌شد، و دکمه همان‌جای قبلی می‌رفت.
    for (const spelling of spellings(l.def)) out.set(spelling, next);
  }
  return out;
}

function spellings(url) {
  const set = new Set([url]);
  try { set.add(encodeURI(url)); } catch { /* آدرسِ خراب - همان خام کافی است */ }
  try { set.add(decodeURI(url)); } catch { /* درصدکدِ ناقص */ }
  return set;
}

export async function linkState(env, key) {
  const rows = await loadRows(env);
  const l = BY_KEY[key];
  if (!l) return null;
  const url = rows[key] || l.def;
  return { ...l, url, custom: url !== l.def };
}

/**
 * نامِ کانالِ دروازه‌ی عضویت، از روی همان لینکِ کانال.
 *
 * چرا مشتق و نه یک تنظیمِ جدا: دروازه با getChatMember روی نامِ کانال
 * کار می‌کند و دکمه‌اش کاربر را به لینک می‌فرستد. اگر این دو جدا بودند،
 * مدیر می‌توانست لینک را عوض کند و بدونِ اینکه بفهمد دروازه را روی
 * کانالِ قبلی رها کند - یعنی کاربر به کانالِ تازه می‌رود و همچنان پشتِ
 * در می‌ماند.
 */
export async function gateChannel(env) {
  const links = await getLinks(env).catch(() => null);
  const url = (links && links.TG_CHANNEL) || BY_KEY.TG_CHANNEL.def;
  return usernameFromTelegramUrl(url) || "@sobhanforex";
}

/** t.me/xyz → @xyz. اگر لینک این شکلی نبود، null. */
export function usernameFromTelegramUrl(url) {
  const m = String(url || "").match(/^https?:\/\/(?:www\.)?t\.me\/([A-Za-z0-9_]{4,32})\/?$/);
  return m ? "@" + m[1] : null;
}

/**
 * اعتبارسنجی. پیامِ خطا برمی‌گرداند، یا null اگر درست بود.
 *
 * سخت‌گیری اینجا عمدی است: یک آدرسِ خراب روی دکمه را تلگرام قبول
 * نمی‌کند و **کلِ کیبورد** را رد می‌کند، نه فقط همان دکمه را. یعنی یک
 * اشتباهِ تایپی می‌تواند یک صفحه‌ی کامل را بی‌دکمه کند.
 */
export function validateLink(key, url) {
  const l = BY_KEY[key];
  if (!l) return "این لینک دیگر معتبر نیست.";

  const clean = String(url || "").trim();
  if (!clean) return "آدرس خالی بود.";
  if (clean.length > LINK_MAX) return "آدرس خیلی بلند است (حداکثر " + LINK_MAX + " کاراکتر).";
  if (/\s/.test(clean)) return "آدرس نباید فاصله داشته باشد.";
  if (!/^https?:\/\//i.test(clean)) return "آدرس باید با http:// یا https:// شروع شود.";

  try {
    // eslint-disable-next-line no-new
    new URL(clean);
  } catch {
    return "این یک آدرسِ معتبر نیست.";
  }

  if (l.telegram && !usernameFromTelegramUrl(clean)) {
    return "لینکِ کانال باید به شکلِ https://t.me/username باشد — چون نامِ کانالِ دروازه‌ی عضویت هم از همین درمی‌آید.";
  }
  return null;
}

export async function setLink(env, key, url) {
  if (!BY_KEY[key]) throw new Error("کلید ناشناخته: " + key);
  await ensureSchema(env);
  await env.DB.prepare(
    `INSERT INTO bot_links (key, url, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET url = excluded.url, updated_at = excluded.updated_at`
  )
    .bind(key, String(url).trim(), new Date().toISOString())
    .run();
  invalidate(CACHE_KEY);
}

export async function resetLink(env, key) {
  if (!BY_KEY[key]) return;
  await ensureSchema(env);
  await env.DB.prepare(`DELETE FROM bot_links WHERE key = ?`).bind(key).run();
  invalidate(CACHE_KEY);
}
