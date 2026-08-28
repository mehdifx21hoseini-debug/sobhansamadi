// «آیا این همان کسی است که به CRM وارد شده؟»
//
// صفحه‌ی هوش مصنوعی نباید رمز جدا بخواهد. مدیر یک‌بار وارد CRM شده و
// یک توکن دارد؛ همان توکن باید کافی باشد.
//
// ورکر خودش نمی‌تواند این توکن را بررسی کند - توکن را n8n صادر کرده و
// فقط خودش می‌داند معتبر است یا نه. پس ورکر همان توکن را به یک مسیر
// احراز-هویت-شده‌ی n8n می‌فرستد و به پاسخش نگاه می‌کند: ۲۰۰ یعنی معتبر،
// ۴۰۱ یعنی نه.
//
// این یک وابستگی به n8n اضافه می‌کند، ولی وابستگی تازه‌ای نیست: بقیه‌ی
// صفحه‌های CRM (لیدها، پشتیبانی، داشبورد) همین حالا بدون n8n خالی‌اند.
// اگر n8n بخوابد، کل CRM خوابیده - نه فقط این صفحه. در عوض خودِ ربات و
// پاسخ‌دهی به کاربر هیچ ربطی به این مسیر ندارند و سرِ پا می‌مانند.

const DEFAULT_VERIFY_URL = "https://96825.7host.cloud/webhook/crm/ai-overview";

// نتیجه‌ی بررسی چند دقیقه در همین isolate می‌ماند.
//
// بدون کش، هر کلیک در صفحه یک درخواست اضافه به n8n می‌شد - یعنی همان
// سروری که مدام زیر بار می‌خوابد، چند برابر بار می‌گرفت.
const TTL_MS = 300_000;
const cache = new Map();

// کلیدِ کش، خودِ توکن نیست.
//
// اگر خود توکن کلید می‌شد، در هر لاگ خطا یا دامپ حافظه‌ای که روزی گرفته
// شود عیناً پیدا بود. این یک هشِ ساده است، نه رمزنگاری - فقط برای اینکه
// توکن خام جایی ننشیند.
function fingerprint(token) {
  let h = 5381;
  for (let i = 0; i < token.length; i++) h = ((h << 5) + h + token.charCodeAt(i)) >>> 0;
  return h.toString(36) + ":" + token.length;
}

/**
 * @param {string} token توکنی که مرورگر در هدر Authorization فرستاده.
 * @returns {Promise<boolean>}
 */
export async function isValidCrmSession(env, token) {
  const clean = String(token || "").trim();
  if (!clean) return false;

  const key = fingerprint(clean);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ok;

  try {
    const res = await fetch(env.CRM_AUTH_VERIFY_URL || DEFAULT_VERIFY_URL, {
      method: "GET",
      headers: { Authorization: "Bearer " + clean },
      signal: AbortSignal.timeout(8000),
    });

    // فقط ۲۰۰ یعنی بله. هر چیز دیگری - ۴۰۱، ۵۰۰، خطای شبکه - یعنی نه.
    //
    // عمداً fail-closed: اگر n8n جواب ندهد نمی‌شود گفت «حتماً معتبر
    // است». راه فرار همان کلید مدیر است که در ادامه‌ی مسیر پذیرفته
    // می‌شود، پس دسترسی به‌کلی بسته نمی‌شود.
    const ok = res.status === 200;

    // فقط پاسخ مثبت کش می‌شود.
    //
    // کش کردن «نه» یعنی کسی که همین الان دوباره وارد شده، باید پشت یک
    // پاسخ کهنه منتظر بماند - و از دید او صفحه بی‌دلیل خراب است. سودش
    // هم کم است: یک درخواست ردشده که تکرار شود، تکرارش هم رد می‌شود.
    if (ok) cache.set(key, { ok: true, at: Date.now() });
    else cache.delete(key);
    return ok;
  } catch (err) {
    console.error("بررسی نشست CRM ممکن نشد:", err && err.message);
    return false;
  }
}
