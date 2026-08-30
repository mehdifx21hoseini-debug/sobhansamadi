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
import { getTextContent, setSectionBody } from "./store.js";

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
