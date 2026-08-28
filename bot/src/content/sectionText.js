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
  BROKER: {
    code: "TRUSTED_BROKER_TEXT",
    label: "🏦 بروکر معتمد",
    def: D.TRUSTED_BROKER_TEXT,
    media: "TRUSTED_BROKER",
  },
  ABOUT_US_MENU: { code: "ABOUT_US_MENU_TEXT", label: "ℹ️ منوی «درباره ما»", def: D.ABOUT_US_MENU_TEXT },
  SUPPORT: { code: "SUPPORT_INTRO_TEXT", label: "💬 پشتیبانی", def: D.SUPPORT_INTRO_TEXT },
  PSY_VOICES: { code: "PSY_VOICES_INTRO_TEXT", label: "🎧 ویس‌های روانشناسی", def: D.PSY_VOICES_INTRO_TEXT },
  LIVE_TRADE: { code: "LIVE_TRADE_INTRO_TEXT", label: "📈 ویدیوهای لایو ترید", def: D.LIVE_TRADE_INTRO_TEXT },
  ECON_MENU: { code: "ECON_MENU_TEXT", label: "📅 تقویم اقتصادی", def: D.ECON_MENU_TEXT },
  HELP: { code: "HELP_TEXT", label: "❓ راهنما (/help)", def: D.HELP_TEXT },

  // مسیر مشاوره: چهار پرسش پشت سر هم. هر کدام جدا ویرایش می‌شود چون
  // آکادمی ممکن است فقط یکی‌شان را بخواهد عوض کند.
  CONSULT_START: { code: "CONSULT_START_TEXT", label: "🟢 شروع مشاوره — انتخاب دوره", def: D.CONSULT_START_TEXT },
  CONSULT_LEVEL: { code: "CONSULT_LEVEL_TEXT", label: "🟢 مشاوره — پرسش سطح", def: D.CONSULT_LEVEL_TEXT },
  CONSULT_TOPIC: { code: "CONSULT_TOPIC_TEXT", label: "🟢 مشاوره — پرسش موضوع", def: D.CONSULT_TOPIC_TEXT },
  CONSULT_TIME: { code: "CONSULT_TIME_TEXT", label: "🟢 مشاوره — پرسش زمان تماس", def: D.CONSULT_TIME_TEXT },
  LEAD_DONE: { code: "LEAD_DONE_TEXT", label: "🎉 پیام پایان ثبت‌نام/مشاوره", def: D.LEAD_DONE_TEXT },

  // دروازه‌ی عضویت: اولین چیزی که یک کاربر تازه می‌بیند.
  JOIN_FIRST: { code: "JOIN_FIRST_TEXT", label: "🔒 درخواست عضویت در کانال", def: D.JOIN_FIRST_TEXT },
  JOIN_RETRY: { code: "JOIN_RETRY_TEXT", label: "🔒 عضویت تایید نشد", def: D.JOIN_RETRY_TEXT },

  BOOK_00: { code: "BOOK_00_INTRO_TEXT", label: "📕 کتاب «ذهنیت ثروتمند»", def: D.BOOK_00_TEXT },
  EQ_DONE: { code: "EQ_DONE_TEXT", label: "🎉 پایان دوره هوش هیجانی", def: D.EQ_DONE_TEXT },
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
  return {
    text: body || section.def,
    photo: (row && row.photo_file_id) || "",
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
};

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
