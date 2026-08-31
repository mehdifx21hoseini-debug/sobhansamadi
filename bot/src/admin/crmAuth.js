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
// همان قاعده‌ی auth.js: هر چیزی جز یک آریِ صریح یعنی نه.
function isActive(v) {
  return v === 1 || v === true || v === "1" || v === "true";
}

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

  // اول D1: از سوییچ به بعد، نشست‌ها را خودِ ورکر صادر می‌کند و n8n
  // اصلاً آن‌ها را نمی‌شناسد. بدون این، صفحه‌ی هوش مصنوعی و دفترچه‌ی
  // شماره‌ها برای هر کسی که تازه وارد شده ۴۰۱ می‌دادند - در حالی که
  // همان توکن در بقیه‌ی پنل کار می‌کرد.
  try {
    const row = await env.DB
      .prepare(
        `SELECT s.expires_at, a.active FROM crm_session s
           JOIN crm_admin a ON a.username = s.username WHERE s.token = ?`
      )
      .bind(clean)
      .first();
    if (row && new Date(row.expires_at).getTime() > Date.now() && isActive(row.active)) {
      cache.set(key, { ok: true, at: Date.now() });
      return true;
    }
  } catch (err) {
    // خواندن از D1 نشد؛ هنوز راهِ n8n مانده.
    console.error("بررسی نشست از D1 ممکن نشد:", err && err.message);
  }

  // و بعد n8n، فقط برای توکن‌های قدیمی که پیش از سوییچ صادر شده‌اند.
  // عمر نشست دوازده ساعت است، پس این شاخه خودش ظرف یک روز بی‌مصرف
  // می‌شود و با خاموش شدن n8n می‌تواند برداشته شود.
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
