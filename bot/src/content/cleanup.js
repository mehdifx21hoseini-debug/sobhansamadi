// پاک‌سازی یک‌باره‌ی متن‌هایی که در پایگاه داده مانده‌اند.
//
// متن هر بخش دو نسخه دارد: پیش‌فرضی که در کد است، و نسخه‌ای که مدیر از
// /edit نوشته و در text_content نشسته. نسخه‌ی دوم بر اولی می‌چربد.
//
// یعنی عوض کردن یک متن پیش‌فرض، برای بخشی که مدیر یک بار ویرایشش کرده
// هیچ اثری ندارد - و از بیرون فقط این دیده می‌شود که «دیپلوی شد ولی
// عوض نشد». آیدی اینستاگرام در متن لایو ترید دقیقاً همین حالت است: به
// جایش دکمه گذاشته شد، ولی اگر نسخه‌ی ویرایش‌شده‌ای وجود داشته باشد،
// آیدی هنوز در آن هست.
//
// این یک بار اجرا می‌شود و پرچمش را در bot_config می‌گذارد. پرچم لازم
// است چون بعد از آن، مدیر باید بتواند هر چه می‌خواهد بنویسد - از جمله
// همان آیدی - بدون اینکه ربات بی‌صدا حرفش را پاک کند.

import { readConfig, writeConfig } from "./channel.js";
import { getTextContent, setSectionBody, updateContentTitle } from "./store.js";

const FLAG = "cleanup_ig_handle";
const CODE = "LIVE_TRADE_INTRO_TEXT";
const HANDLE = /@sobhansamaddi/i;

export async function stripInstagramHandleOnce(env) {
  const done = await readConfig(env, FLAG).catch(() => "");
  if (done) return { skipped: true };

  const row = await getTextContent(env, CODE).catch(() => null);
  const body = row ? String(row.body || "") : "";

  let changed = false;
  if (body && HANDLE.test(body)) {
    // فقط خطی که آیدی در آن است برداشته می‌شود، نه کل پاراگراف: بقیه‌ی
    // متن را مدیر نوشته و دست زدن به آن، کاری است که کسی نخواسته.
    const cleaned = body
      .split("\n")
      .filter((line) => !HANDLE.test(line))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    await setSectionBody(env, CODE, cleaned);
    changed = true;
  }

  // پرچم در هر دو حالت گذاشته می‌شود - چه چیزی برای پاک کردن بود چه
  // نبود. وگرنه هر ده دقیقه یک خواندن بی‌فایده از پایگاه داده می‌ماند.
  await writeConfig(env, FLAG, new Date().toISOString());
  return { changed };
}

// ─── کپشن قسمت ۴ دوره‌ی مقدماتی ─────────────────────────────────────
//
// کپشن یک فایل، عنوانِ همان مدخل در content_library است و از کپشن پستِ
// کانال می‌آید. پس عوض کردنش در کد هیچ اثری ندارد؛ باید همان سطر در D1
// نوشته شود.
//
// این هم یک‌باره است و پرچم دارد: بعد از آن، آکادمی باید بتواند کپشن را
// از کانال یا از دکمه‌ی «✏️ عنوان» عوض کند بدون اینکه ورکر هر ده دقیقه
// حرفش را پس بگیرد.

const P04_FLAG = "caption_intro_p04_v1";
const P04_CODE = "INTRO_P04_LINK";

// متنی که آکادمی نوشته، عیناً. هر خط با ایموجی شروع می‌شود چون تلگرام
// جهت هر خط را از اولین حرف قوی‌اش می‌گیرد؛ خطِ لینک عمداً با https
// شروع می‌شود و چپ‌چین می‌افتد، که برای یک آدرس درست است.
const P04_CAPTION = [
  "🏦 بروکر معتمد | آموزش ثبت‌نام",
  "",
  "🎥 آموزش کامل ثبت‌نام در بروکر و اتصال حساب به MetaTrader 4",
  "",
  "🔗 لینک ثبت‌نام + معرف من:",
  "https://km.mywmportal.com/?pt=41263",
].join("\n");

export async function setIntroP04CaptionOnce(env) {
  const done = await readConfig(env, P04_FLAG).catch(() => "");
  if (done) return { skipped: true };

  const changed = await updateContentTitle(env, P04_CODE, P04_CAPTION);

  // پرچم فقط وقتی گذاشته می‌شود که واقعاً نوشته شده باشد.
  //
  // اگر ویدیو هنوز در کتابخانه نباشد، هیچ سطری عوض نمی‌شود و گذاشتن
  // پرچم یعنی وقتی بعداً پست شد، کپشن کانال می‌ماند و این تغییر بی‌صدا
  // گم می‌شود. یک UPDATE بی‌نتیجه هر ده دقیقه ارزان‌تر از آن است.
  if (changed > 0) await writeConfig(env, P04_FLAG, new Date().toISOString());
  return { changed };
}
