// پیدا کردن مدخل‌های مرتبط با سوال کاربر.
//
// دو روش، چون هیچ‌کدام به‌تنهایی کافی نیست:
//
//   معنایی (بردار) - «چطور حجم معامله رو حساب کنم؟» را به مدخلی وصل
//   می‌کند که کلمه‌ی «حساب کنم» در آن نیست ولی درباره‌ی همان است.
//   ضعفش اصطلاح دقیق است: در ۲۵۶ بُعد، «Half Close» و «Close All» و
//   «Break Even» تقریباً یک نقطه‌اند.
//
//   کلیدواژه‌ای (BM25) - «Half Close» را دقیقاً پیدا می‌کند. ضعفش این
//   است که اگر کاربر کلمه‌ی دیگری به کار ببرد، هیچ‌چیز پیدا نمی‌کند.
//
// پایگاه دانش این آکادمی پر از اصطلاح دقیق است (Risk Line، TP Auto،
// US30، TRC20، Spot Player) و ۹۵ مدخلش درباره‌ی یک موضوع‌اند و متن‌شان
// به هم شبیه. برای همین ترکیب این دو، نه یکی‌شان.

// ─── یکسان‌سازی متن فارسی ─────────────────────────────────────────
//
// «می‌کنید» و «ميكنيد» یک کلمه‌اند ولی بایت‌هایشان فرق دارد: ی/ي عربی،
// ک/ك عربی، نیم‌فاصله، اعراب. بدون یکسان‌سازی، تطبیق کلیدواژه روی
// نیمی از سوال‌های واقعی کاربران شکست می‌خورد - و هیچ‌جا خطا نمی‌دهد.
const AR_YA = /[يى]/g; // ي ى → ی
const AR_KAF = /[ك]/g; // ك → ک
const DIACRITICS = /[ً-ْٰـ]/g; // اعراب و کشیده
// نیم‌فاصله و نویسه‌های نامرئی. با کد نوشته می‌شوند نه با خود نویسه:
// چندتاشان (U+2028 و U+2029) برای جاوااسکریپت پایان خط‌اند و اگر عیناً در
// متن برنامه بیایند، همین فایل اصلاً کامپایل نمی‌شود.
//
// حذف می‌شوند، نه تبدیل به فاصله: «می‌کنید» باید همان «میکنید» شود، وگرنه
// یکی یک توکن است و دیگری دو تا و هرگز به هم نمی‌رسند.
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
// این دو ولی واقعاً جداکننده‌ی خط‌اند و باید فاصله شوند، نه حذف.
const LINE_SEPS = /[\u2028\u2029]/g;
const FA_DIGITS = /[۰-۹]/g;
const AR_DIGITS = /[٠-٩]/g;

export function normalize(text) {
  return String(text || "")
    .replace(AR_YA, "ی")
    .replace(AR_KAF, "ک")
    .replace(DIACRITICS, "")
    .replace(INVISIBLE, "")
    .replace(LINE_SEPS, " ")
    .replace(FA_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(AR_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase();
}

// کلمه‌های بسیار پرتکرار فارسی. این‌ها در هر جمله‌ای هستند و اگر امتیاز
// بگیرند، «چیست» و «برای» رتبه‌بندی را می‌بلعند.
//
// فهرست عمداً کوتاه است: BM25 خودش کلمه‌های پرتکرار را کم‌ارزش می‌کند
// (idf)، و این فقط برای واژه‌هایی است که در متن ما آن‌قدر زیادند که
// حتی idf هم مهارشان نمی‌کند.
const STOP = new Set(
  ("و در به از که این را با است برای می ها های تر ترین یک هم آن یا اگر تا بر" +
    " چه چی چیست چیه شود شده می‌شود کنید کنم کند دارد داره باشد بود نیست هست" +
    " شما ما من او آیا کدام چطور چگونه کجا چرا وقتی مورد")
    .split(/\s+/)
    .filter(Boolean)
);

export function tokenize(text) {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

// ─── BM25 ─────────────────────────────────────────────────────────
//
// همان فرمول استاندارد بازیابی متن. k1 و b مقدارهای مرسوم‌اند؛ چیزی
// اینجا اختراع نشده.
const K1 = 1.4;
const B = 0.72;

/**
 * ساخت نمایه‌ی معکوس. یک‌بار هنگام کش شدن پایگاه دانش انجام می‌شود، نه
 * روی هر سوال.
 */
export function buildIndex(rows) {
  const docs = rows.map((r) => {
    const tokens = tokenize((r.question || "") + " " + (r.answer || ""));
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    return { id: r.id, tf, len: tokens.length };
  });

  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);

  const avgLen = docs.reduce((s, d) => s + d.len, 0) / (docs.length || 1) || 1;
  const idf = new Map();
  for (const [t, n] of df) {
    // idf استاندارد BM25، با +۱ تا هرگز منفی نشود.
    idf.set(t, Math.log(1 + (docs.length - n + 0.5) / (n + 0.5)));
  }

  return { docs, idf, avgLen };
}

/** امتیاز کلیدواژه‌ای هر مدخل برای یک سوال. خروجی: Map از id به امتیاز. */
export function bm25Scores(index, queryTokens) {
  const out = new Map();
  if (!index || queryTokens.length === 0) return out;

  for (const d of index.docs) {
    let score = 0;
    for (const t of queryTokens) {
      const f = d.tf.get(t);
      if (!f) continue;
      const idf = index.idf.get(t) || 0;
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (d.len / index.avgLen))));
    }
    if (score > 0) out.set(d.id, score);
  }
  return out;
}

// ─── شباهت معنایی ─────────────────────────────────────────────────

/**
 * شباهت کسینوسی.
 *
 * طول دو بردار باید یکی باشد. اگر نبود صفر برمی‌گردد، نه یک عدد
 * نصفه: نسخه‌ی قبلی تا کوتاه‌ترین طول حلقه می‌زد، یعنی اگر روزی ابعاد
 * بردار عوض می‌شد، رتبه‌بندی بی‌صدا بی‌معنی می‌شد - نه خطایی، نه
 * نشانه‌ای، فقط جواب‌های بی‌ربط.
 */
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

// ─── ترکیب ────────────────────────────────────────────────────────

// چند مدخل به مدل داده می‌شود. پانزده‌تا از نسخه‌ی n8n آمده و دلیل
// خوبی دارد: کمتر، جواب درست را جا می‌اندازد؛ بیشتر، پرامپت را شلوغ
// می‌کند و مدل روی مدخل بی‌ربط قفل می‌شود.
export const TOP_K = 15;

// وزن دو روش. معنایی بیشتر است چون سوال‌های واقعی کاربران بیشتر
// توصیفی‌اند تا دقیق؛ ولی سهم کلیدواژه آن‌قدر هست که یک اصطلاح دقیق
// بتواند مدخل درست را از میان ۹۵ مدخلِ هم‌شکل بیرون بکشد.
const W_VECTOR = 0.65;
const W_KEYWORD = 0.35;

/**
 * رتبه‌بندی ترکیبی.
 *
 * هر دو امتیاز به بازه‌ی [۰،۱] نرمال می‌شوند و بعد جمع وزنی می‌شوند.
 * نرمال‌سازی لازم است چون BM25 سقف ثابت ندارد - عددش به idf و طول متن
 * بستگی دارد و بدون نرمال‌سازی می‌تواند کسینوس را کاملاً خفه کند.
 *
 * @param {{rows:Array, vectors:Map, index:Object}} kb
 * @param {number[]|null} queryVec بردار سوال؛ اگر نیامد فقط کلیدواژه.
 * @param {string} question متن خام سوال.
 */
export function rank(kb, queryVec, question) {
  const rows = kb.rows || [];
  if (rows.length === 0) return [];

  const kwScores = bm25Scores(kb.index, tokenize(question));
  const maxKw = Math.max(0, ...kwScores.values()) || 1;

  const scored = rows.map((r) => {
    const vec = kb.vectors.get(r.id);
    const v = queryVec && vec ? Math.max(0, cosine(queryVec, vec)) : 0;
    const k = (kwScores.get(r.id) || 0) / maxKw;
    return { row: r, score: W_VECTOR * v + W_KEYWORD * k, v, k };
  });

  scored.sort((a, b) => b.score - a.score);

  // آستانه عمداً پایین است و اگر هیچ‌کس رد نشد، بهترین‌ها باز هم
  // می‌روند: تصمیمِ «این سوال جواب ندارد» با مدل است نه با یک عدد.
  const MIN = 0.08;
  let selected = scored.filter((s) => s.score >= MIN).slice(0, TOP_K);
  if (selected.length === 0) selected = scored.slice(0, TOP_K);

  return selected.map((s) => s.row);
}
