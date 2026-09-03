// متن و عکس هر بخش: خواندن، و فرستادن.
//
// هر بخشی که دکمه‌اش زده می‌شود یک متن دارد و می‌تواند یک عکس هم داشته
// باشد. هر دو از جدول text_content می‌آیند و اگر آنجا چیزی نباشد، از
// متن پیش‌فرض همان بخش. مدیر از داخل تلگرام هر دو را عوض می‌کند.
//
// چرا فهرست اینجاست و نه پخش در ماژول‌ها: ویرایشگر باید بداند چه
// چیزهایی قابل ویرایش‌اند. اگر هر بخش متن خودش را نگه می‌داشت، هر بخش
// تازه‌ای باید دو جا ثبت می‌شد و یکی‌شان فراموش می‌شد.

import { getTextContent, getContent } from "./store.js";
import * as D from "./defaults.js";

// مقداری که در ستون عکس می‌نشیند وقتی مدیر عکس را برمی‌دارد. یک file_id
// واقعی هرگز این شکلی نیست، پس با عکس اشتباه گرفته نمی‌شود.
export const PHOTO_OFF = "off";

// کلید بخش → کد ردیف در text_content، برچسبی که مدیر می‌بیند، و متن
// پیش‌فرض. کدها همان‌هایی هستند که هشتگ کانال هم می‌پذیرد، پس یک متن
// را می‌شود هم از کانال فرستاد هم از ویرایشگر عوض کرد.
export const SECTIONS = {
  WELCOME: { code: "WELCOME_TEXT", label: "👋 پیام خوش‌آمد (/start)", def: D.WELCOME_TEXT },
  LIBRARY: { code: "LIBRARY_INTRO_TEXT", label: "🧠 کتاب‌های روانشناسی", def: D.LIBRARY_INTRO_TEXT },
  EXPERT: { code: "EXPERT_INTRO_TEXT", label: "🤖 اکسپرت مدیریت سرمایه", def: D.EXPERT_INTRO_TEXT },
  FREE_MENU: { code: "FREE_MENU_TEXT", label: "🎓 دوره‌های رایگان", def: D.FREE_MENU_TEXT },
  INTRO_COURSE: { code: "INTRO_COURSE_TEXT", label: "📚 دوره مقدماتی فارکس", def: D.INTRO_COURSE_TEXT },
  EQ_INTRO: { code: "EQ_INTRO_TEXT", label: "🧠 دوره هوش هیجانی", def: D.EQ_INTRO_TEXT },
  ABOUT: { code: "ABOUT_TEXT", label: "🏛 درباره آکادمی", def: D.ABOUT_TEXT },
  CONTACT: { code: "CONTACT_TEXT", label: "📞 تماس با ما", def: D.CONTACT_TEXT },
  // media: فایلی که آکادمی با هشتگ #TRUSTED_BROKER در کانال گذاشته -
  // ویدیوی معرفی بروکر. جدا از عکسِ ویرایشگر است: آن یکی از داخل تلگرام
  // ست می‌شود و این یکی از کانال می‌آید.
  // media از اینجا برداشته شد.
  //
  // ویدیوی TRUSTED_BROKER خودکار زیر متن می‌رفت؛ حالا پشت دکمه‌ی
  // «آموزش ثبت‌نام» است و کنارش «آموزش واریز و برداشت» هم آمده. خودِ
  // فایل سر جایش در کتابخانه مانده و از همان شناسه خوانده می‌شود - فقط
  // دیگر بی‌درخواست فرستاده نمی‌شود.
  BROKER: { code: "TRUSTED_BROKER_TEXT", label: "🏦 بروکر معتمد", def: D.TRUSTED_BROKER_TEXT },
  ABOUT_US_MENU: { code: "ABOUT_US_MENU_TEXT", label: "ℹ️ منوی «درباره ما»", def: D.ABOUT_US_MENU_TEXT },
  SUPPORT: { code: "SUPPORT_INTRO_TEXT", label: "💬 پشتیبانی", def: D.SUPPORT_INTRO_TEXT },
  PSY_VOICES: { code: "PSY_VOICES_INTRO_TEXT", label: "🎧 ویس‌های روانشناسی", def: D.PSY_VOICES_INTRO_TEXT },
  LIVE_TRADE: { code: "LIVE_TRADE_INTRO_TEXT", label: "📈 ویدیوهای لایو ترید", def: D.LIVE_TRADE_INTRO_TEXT },
  ECON_MENU: { code: "ECON_MENU_TEXT", label: "📅 تقویم اقتصادی", def: D.ECON_MENU_TEXT },
  HELP: { code: "HELP_TEXT", label: "❓ راهنما (/help)", def: D.HELP_TEXT },

  // مسیر مشاوره: سه پرسش پشت سر هم. هر کدام جدا ویرایش می‌شود چون
  // آکادمی ممکن است فقط یکی‌شان را بخواهد عوض کند.
  //
  // «پرسش زمان تماس» اینجا بود و برداشته شد چون دیگر پرسیده نمی‌شود؛
  // متنی که در /edit دیده شود ولی هرگز به کاربر نرود، مدیر را به این
  // باور می‌رساند که چیزی را عوض کرده که عوض نشده.
  CONSULT_START: { code: "CONSULT_START_TEXT", label: "🟢 شروع مشاوره — انتخاب دوره", def: D.CONSULT_START_TEXT },
  // کارتِ معرفیِ هر دوره، بین انتخاب و شروعِ فرم. جدا از هم، چون آکادمی
  // معمولاً سرفصلِ یکی را عوض می‌کند نه هر سه را.
  COURSE_TECH_CARD: { code: "COURSE_TECH_CARD_TEXT", label: "🟢 کارت معرفی — مجموعه پیشرفته", def: D.COURSE_TECH_CARD_TEXT },
  COURSE_PSY_CARD: { code: "COURSE_PSY_CARD_TEXT", label: "🟢 کارت معرفی — دوره روانشناسی", def: D.COURSE_PSY_CARD_TEXT },
  COURSE_BOTH_CARD: { code: "COURSE_BOTH_CARD_TEXT", label: "🟢 کارت معرفی — هر دو دوره", def: D.COURSE_BOTH_CARD_TEXT },
  // «متن شروع فرم» و «پرسش ۷: هدف از دوره» از اینجا برداشته شدند: هیچ‌کدام
  // دیگر فرستاده نمی‌شوند، و متنی که مدیر در /edit ببیند ولی هرگز به
  // کاربر نرسد، او را به این باور می‌رساند که چیزی را عوض کرده که عوض
  // نشده.
  //
  // پرسش ۱ (نام) و ۲ (شماره) در کد ثابت‌اند: اولی سه جا پرسیده می‌شود و
  // باید یکی بماند، دومی به کیبوردِ درخواستِ شماره وابسته است.
  CONSULT_LEVEL: { code: "CONSULT_LEVEL_TEXT", label: "🟢 تعیین سطح — پرسش ۳: دانش", def: D.CONSULT_LEVEL_TEXT },
  CONSULT_EXPERIENCE: { code: "CONSULT_EXPERIENCE_TEXT", label: "🟢 تعیین سطح — پرسش ۴: مدت فعالیت", def: D.CONSULT_EXPERIENCE_TEXT },
  CONSULT_REAL: { code: "CONSULT_REAL_TEXT", label: "🟢 تعیین سطح — پرسش ۵: حساب ریل", def: D.CONSULT_REAL_TEXT },
  CONSULT_TRADE: { code: "CONSULT_TRADE_TEXT", label: "🟢 تعیین سطح — پرسش ۶: وضعیت ترید", def: D.CONSULT_TRADE_TEXT },
  // دو تکه‌ی کپشنِ پیامِ پایان - پشتِ سرِ هم، روی همان گیف:
  //   LEAD_DONE    - خطِ اول، خبرِ ثبت
  //   LEAD_SUPPORT - دعوت به پشتیبانی، درست بالای دکمه
  //
  // خودِ گیف از کانال می‌آید، با هشتگِ #LEAD_DONE_ANIM.
  LEAD_DONE: { code: "LEAD_DONE_TEXT", label: "🎉 پیام پایان — خط اول", def: D.LEAD_DONE_TEXT },
  LEAD_SUPPORT: { code: "LEAD_SUPPORT_TEXT", label: "💬 پیام پایان — دعوت به پشتیبانی", def: D.LEAD_SUPPORT_TEXT },

  // دروازه‌ی عضویت: اولین چیزی که یک کاربر تازه می‌بیند.
  JOIN_FIRST: { code: "JOIN_FIRST_TEXT", label: "🔒 درخواست عضویت در کانال", def: D.JOIN_FIRST_TEXT },
  JOIN_RETRY: { code: "JOIN_RETRY_TEXT", label: "🔒 عضویت تایید نشد", def: D.JOIN_RETRY_TEXT },

  // هر کتاب توضیح و عکس خودش را دارد. عکس روی جلد است و توضیح، همان
  // چیزی که کاربر پیش از دانلود می‌خواند.
  // defPhoto: جلد پیش‌فرض، یک آدرس اینترنتی به‌جای file_id تلگرام.
  //
  // تلگرام هر دو را در یک جا می‌پذیرد، پس این یعنی یک بخش می‌تواند از
  // همان روز اول عکس داشته باشد بدون اینکه کسی /edit را بزند. اگر مدیر
  // بعداً عکسی ثبت کند، آن عکس بر این می‌چربد - این فقط جای خالی را پر
  // می‌کند، جلوی ویرایش را نمی‌گیرد.
  BOOK_00: {
    code: "BOOK_00_INTRO_TEXT",
    label: "📕 کتاب من — ذهن ثروتمند",
    def: D.BOOK_00_TEXT,
    defPhoto: "https://sobhansamadi.com/wp-content/uploads/2024/12/S-001.webp",
  },
  BOOK_01: { code: "BOOK_01_INTRO_TEXT", label: "📕 کتاب ۱ — موفقیت در معامله‌گری", def: D.BOOK_01_TEXT },
  BOOK_02: { code: "BOOK_02_INTRO_TEXT", label: "📕 کتاب ۲ — بازی روانی معامله‌گری", def: D.BOOK_02_TEXT },
  BOOK_03: { code: "BOOK_03_INTRO_TEXT", label: "📕 کتاب ۳ — انضباط شخصی", def: D.BOOK_03_TEXT },
  BOOK_04: { code: "BOOK_04_INTRO_TEXT", label: "📕 کتاب ۴ — پایان اهمال‌کاری", def: D.BOOK_04_TEXT },
  EQ_DONE: { code: "EQ_DONE_TEXT", label: "🎉 پایان دوره هوش هیجانی", def: D.EQ_DONE_TEXT },
  INTRO_DONE: { code: "INTRO_DONE_TEXT", label: "🎉 پایان دوره مقدماتی", def: D.INTRO_DONE_TEXT },
  CONTENT_ACK: { code: "CONTENT_ACK_TEXT", label: "✅ پیام «درخواست ثبت شد»", def: D.CONTENT_ACK_TEXT },
  PENDING_PSY: { code: "PENDING_PSY_TEXT", label: "⏳ ویس روانشناسی — هنوز خالی", def: D.PENDING_PSY_TEXT },
  PENDING_LIVE: { code: "PENDING_LIVE_TEXT", label: "⏳ لایو ترید — هنوز خالی", def: D.PENDING_LIVE_TEXT },
};

export function sectionByCode(code) {
  const key = Object.keys(SECTIONS).find((k) => SECTIONS[k].code === code);
  return key ? { key, ...SECTIONS[key] } : null;
}

/**
 * متن و عکس فعلی یک بخش.
 *
 * خطای پایگاه داده هرگز نباید یک بخش را از کار بیندازد: اگر خواندن
 * شکست بخورد، متن پیش‌فرض می‌رود - همان چیزی که پیش از این ویژگی
 * همیشه می‌رفت.
 */
export async function resolveSection(env, key) {
  const section = SECTIONS[key];
  if (!section) return { text: "", photo: "", custom: false };

  const row = await getTextContent(env, section.code).catch(() => null);
  const body = row && String(row.body || "").trim();
  const storedPhoto = row ? String(row.photo_file_id || "") : "";

  return {
    text: body || section.def,
    // عکسِ ثبت‌شده‌ی مدیر، وگرنه جلد پیش‌فرضِ کد.
    //
    // PHOTO_OFF یعنی مدیر عمداً عکس را برداشته - که با «هرگز عکسی ثبت
    // نشده» یکی نیست. بدون این تفاوت، دکمه‌ی «حذف عکس» روی بخشی که جلد
    // پیش‌فرض دارد هیچ کاری نمی‌کرد: مقدار خالی ذخیره می‌شد و بلافاصله
    // همان جلد دوباره برمی‌گشت.
    photo: storedPhoto === PHOTO_OFF ? "" : storedPhoto || section.defPhoto || "",
    // آیا آنچه نشان داده می‌شود جلد پیش‌فرض است یا عکس خود مدیر - برای
    // اینکه صفحه‌ی ویرایش بتواند این دو را از هم جدا بگوید.
    defaultPhoto: !storedPhoto && !!section.defPhoto,
    // برای ویرایشگر: آیا این متن دست‌کاری شده یا هنوز پیش‌فرض است.
    custom: !!body,
  };
}

// سقف کپشن تلگرام. متنِ بلندتر از این را نمی‌شود زیر عکس گذاشت.
const CAPTION_LIMIT = 1024;

/**
 * بخش را می‌فرستد: عکس (اگر باشد) + متن + دکمه‌ها.
 *
 * سه حالت دارد و هر سه لازم‌اند:
 *   ۱ - بدون عکس: یک پیام متنی.
 *   ۲ - با عکس و متن کوتاه: یک پیام، متن به‌عنوان کپشن. زیباترین حالت.
 *   ۳ - با عکس و متن بلند: عکس جدا، بعد متن. چون تلگرام کپشن بلندتر
 *       از ۱۰۲۴ کاراکتر را رد می‌کند و در آن صورت هیچ‌چیز نمی‌رفت.
 *
 * دکمه‌ها همیشه به پیام آخر می‌چسبند، هر حالتی که باشد.
 */
// فایلی که از کانال آمده، با همان کپشنی که آکادمی زیرش نوشته بود.
//
// کپشن، متنِ بخش نیست: متن بخش بالاتر و جدا می‌رود. این یکی چیزی است
// که آکادمی مخصوصِ خودِ فایل نوشته - مثلاً لینک ثبت‌نامی که در کپشن
// ویدیوی بروکر گذاشته شده - و انداختنش یعنی از دست رفتن حرفی که فقط
// آنجا زده شده.
const MEDIA_SENDERS = {
  video: (ctx, id, o) => ctx.replyWithVideo(id, o),
  photo: (ctx, id, o) => ctx.replyWithPhoto(id, o),
  document: (ctx, id, o) => ctx.replyWithDocument(id, o),
  audio: (ctx, id, o) => ctx.replyWithAudio(id, o),
  voice: (ctx, id, o) => ctx.replyWithVoice(id, o),
  animation: (ctx, id, o) => ctx.replyWithAnimation(id, o),
  // استیکر کپشن نمی‌گیرد؛ هر چه بفرستیم تلگرام رد می‌کند. فرستنده‌اش
  // فقط دکمه‌ها را می‌پذیرد و متن جای دیگری می‌رود.
  sticker: (ctx, id, o) => ctx.replyWithSticker(id, { reply_markup: o && o.reply_markup }),
};

// نوعِ فایلی که کپشن نمی‌پذیرد. فراخوان باید متن را جدا بفرستد.
export function isCaptionless(fileType) {
  return fileType === "sticker";
}

export async function sendChannelFile(ctx, contentId) {
  return sendChannelMedia(ctx, contentId);
}

/**
 * همان فایلِ کانال، ولی با کپشن و دکمه‌های خودمان.
 *
 * sendChannelFile کپشنِ خودِ پست را می‌فرستد؛ اینجا فایل فقط یک قابِ
 * تصویری است و متن و دکمه از جای دیگری می‌آیند. false برمی‌گرداند اگر
 * فایلی ثبت نشده باشد، تا فراخوان بتواند به متنِ ساده برگردد.
 */
export async function sendChannelMediaWithCaption(ctx, contentId, caption, replyMarkup) {
  const row = await getContent(ctx.env, contentId).catch(() => null);
  if (!row || !row.file_id) return "";
  const send = MEDIA_SENDERS[row.file_type];
  if (!send) return "";
  // استیکر بدونِ متن و بدونِ دکمه می‌رود؛ آن‌ها در پیامِ بعدی می‌آیند.
  // بقیه‌ی فایل‌ها هر دو را روی خودشان می‌گیرند.
  await send(
    ctx,
    row.file_id,
    isCaptionless(row.file_type)
      ? {}
      : { caption: String(caption || "").slice(0, CAPTION_LIMIT), reply_markup: replyMarkup }
  );
  return row.file_type;
}

async function sendChannelMedia(ctx, contentId) {
  const row = await getContent(ctx.env, contentId).catch(() => null);
  if (!row || !row.file_id) return false;
  const send = MEDIA_SENDERS[row.file_type];
  if (!send) return false;
  // کپشن بلندتر از سقف، کل ارسال را رد می‌کند؛ بریده می‌شود نه اینکه
  // فایل اصلاً نرسد.
  const caption = String(row.title || "").trim();
  await send(ctx, row.file_id, caption ? { caption: caption.slice(0, CAPTION_LIMIT) } : {});
  return true;
}

export async function sendSection(ctx, key, replyMarkup, extra = {}) {
  const section = SECTIONS[key] || {};
  const { text, photo } = await resolveSection(ctx.env, key);
  const opts = { ...extra };
  if (replyMarkup) opts.reply_markup = replyMarkup;

  // فایل کانال بعد از متن می‌رود، نه قبلش: متن زمینه را می‌سازد و
  // ویدیو حرفش را تایید می‌کند. برعکسش، کاربر ویدیویی می‌بیند که هنوز
  // نمی‌داند چیست. کپشنِ خودِ فایل هم همراهش می‌رود.
  //
  // شکستش نباید جلوی متن را بگیرد: بخشی که به‌خاطر یک ویدیو هیچ جوابی
  // نمی‌دهد، از بخشی که ویدیو ندارد بدتر است.
  const afterText = async (sent) => {
    if (section.media) {
      await sendChannelMedia(ctx, section.media).catch((err) =>
        console.error("ارسال فایل کانالِ بخش شکست خورد:", key, err && err.message)
      );
    }
    return sent;
  };

  if (!photo) {
    return afterText(await ctx.reply(text, opts));
  }

  if (text.length <= CAPTION_LIMIT) {
    // اگر فرستادن عکس شکست بخورد (file_id باطل شده، عکس پاک شده)، متن
    // باید برود. بخشی که فقط به‌خاطر یک عکس هیچ جوابی نمی‌دهد، از
    // بخشی که عکس ندارد بدتر است.
    try {
      return await afterText(await ctx.replyWithPhoto(photo, { caption: text, ...opts }));
    } catch (err) {
      console.error("ارسال عکس بخش شکست خورد:", key, err && err.message);
      return afterText(await ctx.reply(text, opts));
    }
  }

  await ctx.replyWithPhoto(photo).catch((err) =>
    console.error("ارسال عکس بخش شکست خورد:", key, err && err.message)
  );
  return afterText(await ctx.reply(text, opts));
}

/**
 * همان بخش، ولی روی پیامی که از قبل هست (مسیر دکمه‌ی بازگشت).
 *
 * اگر پیام قبلی عکس داشته باشد، editMessageText روی آن خطا می‌دهد و
 * باید کپشن ویرایش شود. تشخیصش از خود پیام است، نه از اینکه بخش الان
 * عکس دارد یا نه - چون شاید عکس بین این دو لحظه عوض شده باشد.
 */
export async function editSection(ctx, key, replyMarkup) {
  const { text } = await resolveSection(ctx.env, key);
  return editWithText(ctx, text, replyMarkup);
}

export async function editWithText(ctx, text, replyMarkup) {
  const msg = ctx.callbackQuery && ctx.callbackQuery.message;
  const hasMedia = !!(msg && (msg.photo || msg.video || msg.animation));

  if (hasMedia) {
    return ctx.editMessageCaption({
      caption: text.slice(0, CAPTION_LIMIT),
      reply_markup: replyMarkup,
    });
  }
  return ctx.editMessageText(text, { reply_markup: replyMarkup });
}
