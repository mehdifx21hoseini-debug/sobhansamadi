import { sendSection } from "./content/sectionText.js";

// متن هر سه بخش از content/sectionText.js می‌آید: یا آنچه مدیر از داخل
// تلگرام نوشته، یا متن پیش‌فرض. اینجا فقط دکمه‌ها می‌مانند - چون دکمه‌ها
// رفتار دارند نه متن، و رفتار قابل ویرایش از داخل تلگرام نیست.

// لینک رفرال واقعی آکادمی. pt=41263 شناسه‌ی معرف است و اگر بیفتد،
// پورسانت هر ثبت‌نامی که از این مسیر بیاید از دست می‌رود - پس هرگز
// «تمیزکاری» نشود.
const BROKER_URL = "https://km.mywmportal.com/?pt=41263";

export async function sendAbout(ctx) {
  await sendSection(ctx, "ABOUT");
}

export async function sendTrustedBroker(ctx) {
  await sendSection(ctx, "BROKER", {
    inline_keyboard: [
      [{ text: "🏦 ثبت‌نام در بروکر معتمد", url: BROKER_URL, style: "primary" }],
    ],
  });
}

// از زیرمنوی «درباره ما» صدا زده می‌شود، کنار sendAbout.
export async function sendContact(ctx) {
  // شیء خام و نه InlineKeyboard، چون سازنده‌ی grammy فیلد style را بی‌صدا
  // دور می‌ریزد و دکمه‌ها بی‌رنگ می‌شوند.
  await sendSection(ctx, "CONTACT", {
    inline_keyboard: [
      [
        { text: "📢 کانال تلگرام", url: "https://t.me/sobhanforex", style: "primary" },
        { text: "📸 اینستاگرام", url: "https://instagram.com/sobhansamaddi", style: "primary" },
      ],
    ],
  });
}
