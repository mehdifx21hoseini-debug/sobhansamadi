// دریافت محتوا از کانال.
//
// آکادمی فایل را در کانال خصوصی پست می‌کند و در کپشن یک هشتگ می‌گذارد
// (#BOOK_01_PDF). ربات که ادمین کانال است، آن را می‌بیند، file_id را
// برمی‌دارد و در D1 می‌نشاند. از آن به بعد همان فایل مستقیم برای کاربر
// فرستاده می‌شود.
//
// کدها و قواعد تطبیق عیناً از نود Build Response در WF-01 آمده‌اند - اگر
// یکی از این‌ها عوض شود، پست‌هایی که آکادمی سال‌هاست به همان شکل می‌فرستد
// دیگر شناخته نمی‌شوند.

import { upsertContent, upsertTextContent } from "./store.js";

const FIXED_CONTENT_CODES = [
  "INTRO_P01","INTRO_P02","INTRO_P03","INTRO_P04_LINK","INTRO_P05","INTRO_P06","INTRO_P07",
  "INTRO_P08","INTRO_P09","INTRO_P10","INTRO_P11","INTRO_P12","INTRO_P13","INTRO_P14",
  "INTRO_P15",
  "EMOTIONAL_P01","EMOTIONAL_P02","EMOTIONAL_P03","EMOTIONAL_P04",
  "BOOK_01_PDF","BOOK_01_AUDIO",
  "BOOK_02_PDF","BOOK_02_AUDIO_P01","BOOK_02_AUDIO_P02","BOOK_02_AUDIO_P03","BOOK_02_AUDIO_P04","BOOK_02_AUDIO_P05",
  "BOOK_03_PDF","BOOK_03_AUDIO_CH01","BOOK_03_AUDIO_CH02","BOOK_03_AUDIO_CH03","BOOK_03_AUDIO_CH04","BOOK_03_AUDIO_CH05","BOOK_03_AUDIO_CH06","BOOK_03_AUDIO_CH07","BOOK_03_AUDIO_CH08","BOOK_03_AUDIO_CH09","BOOK_03_AUDIO_CH10",
  "BOOK_04_PDF","BOOK_04_AUDIO_INTRO","BOOK_04_AUDIO_CH01","BOOK_04_AUDIO_CH02","BOOK_04_AUDIO_CH03","BOOK_04_AUDIO_CH04","BOOK_04_AUDIO_CH05","BOOK_04_AUDIO_CH06","BOOK_04_AUDIO_CH07",
  "EXPERT_MT4_FILE","EXPERT_MT4_VIDEO","EXPERT_MT5_FILE","EXPERT_MT5_VIDEO",
  "TRUSTED_BROKER",
  "WELCOME_PHOTO",
];

const TEXT_CONTENT_CODES = [
  "WELCOME_TEXT","COURSES_MENU_TEXT","FREE_MENU_TEXT","ABOUT_TEXT","EXPERT_INTRO_TEXT",
  "LIBRARY_INTRO_TEXT","TRUSTED_BROKER_TEXT","EQ_INTRO_TEXT","INTRO_COURSE_TEXT",
  "BOOK_00_INTRO_TEXT","BOOK_01_INTRO_TEXT","BOOK_02_INTRO_TEXT","BOOK_03_INTRO_TEXT","BOOK_04_INTRO_TEXT",
];

const PSY_VOICE_HASHTAGS = ["#ویس‌روانشناسی", "#ویس_روانشناسی"];

// چرا تطبیق ساده‌ی «شامل بودن» کافی نیست: #BOOK_01_PDF داخل
// #BOOK_01_PDF_OLD هم هست. کاراکتر بعدی باید پایان کلمه باشد، وگرنه کد
// طولانی‌تر به‌اشتباه کد کوتاه‌تر شناخته می‌شود.
function hasHashtag(caption, code) {
  const upper = caption.toUpperCase();
  const needle = "#" + code;
  let from = 0;
  for (;;) {
    const idx = upper.indexOf(needle, from);
    if (idx === -1) return false;
    if (!/[A-Z0-9_]/.test(upper.charAt(idx + needle.length))) return true;
    from = idx + 1;
  }
}

// فایل را از هر شکلی که تلگرام فرستاده بیرون می‌کشد. ترتیب مهم است:
// یک ویس هم audio دارد هم voice، و voice باید برنده شود.
export function extractFile(post) {
  if (!post) return { fileId: "", fileType: "" };
  if (post.voice) return { fileId: post.voice.file_id, fileType: "voice" };
  if (post.audio) return { fileId: post.audio.file_id, fileType: "audio" };
  if (post.video) return { fileId: post.video.file_id, fileType: "video" };
  if (post.document) return { fileId: post.document.file_id, fileType: "document" };
  if (post.photo && post.photo.length > 0) {
    // آخرین عضو آرایه بزرگ‌ترین نسخه است.
    return { fileId: post.photo[post.photo.length - 1].file_id, fileType: "photo" };
  }
  return { fileId: "", fileType: "" };
}

// تصمیم می‌گیرد این پست کانال چه چیزی است. هیچ عارضه‌ای ندارد تا بشود
// جداگانه تستش کرد.
export function classifyPost(post) {
  const caption = post.caption || post.text || "";
  const { fileId, fileType } = extractFile(post);
  const hasMedia = !!fileId;

  let code = "";
  for (const c of FIXED_CONTENT_CODES) {
    if (hasHashtag(caption, c)) { code = c; break; }
  }

  let textCode = "";
  if (!code) {
    for (const c of TEXT_CONTENT_CODES) {
      if (hasHashtag(caption, c)) { textCode = c; break; }
    }
  }

  const isPsyVoice =
    !code && !textCode && hasMedia && PSY_VOICE_HASHTAGS.some((h) => caption.indexOf(h) !== -1);

  if (textCode) {
    return {
      kind: "text",
      contentId: textCode,
      body: caption.split("#" + textCode).join("").trim(),
      photoFileId: fileType === "photo" ? fileId : "",
    };
  }

  if (code && hasMedia) {
    let title = caption;
    for (const h of ["#" + code]) title = title.split(h).join("");
    return { kind: "file", contentId: code, title: title.trim(), fileId, fileType };
  }

  if (isPsyVoice) {
    let title = caption;
    for (const h of PSY_VOICE_HASHTAGS) title = title.split(h).join("");
    return {
      kind: "file",
      // ویس‌ها کد ثابت ندارند؛ هر پست یک مدخل تازه است.
      contentId: "PSY_VOICE_" + Date.now(),
      title: title.trim() || "ویس روانشناسی بدون عنوان",
      fileId,
      fileType,
    };
  }

  return { kind: "none" };
}

// آیدی کانال خصوصی در تلگرام به شکل -1002445678901 است، ولی لینک پست
// (t.me/c/2445678901/12) فقط بخش میانی را نشان می‌دهد. هر دو شکل - و
// حتی نسخه‌ی بدون منفی - به یک عدد یکسان تبدیل می‌شوند تا کسی به‌خاطر
// جا انداختن پیشوند ساعت‌ها دنبال باگی نگردد که وجود ندارد.
export function normalizeChannelId(v) {
  const digits = String(v || "").trim().replace(/^-/, "").replace(/^100/, "");
  return digits ? "-100" + digits : "";
}

// آیا این پست از کانال مجاز آمده؟
//
// نسخه‌ی n8n هر پست کانالی را می‌پذیرفت. برای رباتی که عمومی می‌شود این
// یک راه نفوذ است: هر کسی می‌تواند همین ربات را در کانال خودش ادمین کند و
// با پست کردن #BOOK_01_PDF فایل کتاب را برای همه‌ی کاربران عوض کند.
// پس فقط کانال پیکربندی‌شده پذیرفته می‌شود، و اگر پیکربندی نشده باشد
// دریافت خاموش است - نه باز برای همه.
export function isAllowedChannel(env, chat) {
  if (!chat) return false;
  const byId = normalizeChannelId(env.CONTENT_CHANNEL_ID);
  const byName = String(env.CONTENT_CHANNEL_USERNAME || "").trim().replace(/^@/, "").toLowerCase();
  if (!byId && !byName) return false;
  if (byId && normalizeChannelId(chat.id) === byId) return true;
  if (byName && String(chat.username || "").toLowerCase() === byName) return true;
  return false;
}

export async function handleChannelPost(ctx) {
  const post = ctx.channelPost || ctx.update.channel_post || ctx.update.edited_channel_post;
  if (!post) return;

  const c = classifyPost(post);

  if (!isAllowedChannel(ctx.env, post.chat)) {
    console.log(
      "پست کانال نادیده گرفته شد (کانال مجاز نیست):",
      post.chat && post.chat.id,
      post.chat && post.chat.username
    );

    // فقط وقتی پست هشتگ معتبر دارد جواب می‌دهیم، نه روی هر پست کانال.
    //
    // چرا اصلاً جواب می‌دهیم: از بیرون، «آیدی را اشتباه گذاشته‌ام» و
    // «متغیر موقع دیپلوی پاک شده» و «ربات پست را اصلاً نمی‌بیند» هر سه
    // یک شکل دارند - هیچ اتفاقی نمی‌افتد. و لاگ ورکر هم برای همه در
    // دسترس نیست. این پیام هر سه را از هم جدا می‌کند و خودِ عددی را که
    // لازم است می‌دهد.
    if (c.kind !== "none") {
      const configured = !!(ctx.env.CONTENT_CHANNEL_ID || ctx.env.CONTENT_CHANNEL_USERNAME);
      const text = [
        "⚠️ این فایل ثبت نشد.",
        "",
        configured
          ? "کانالِ تنظیم‌شده با این کانال یکی نیست."
          : "هیچ کانالی برای دریافت محتوا تنظیم نشده است.",
        "",
        "آیدی این کانال:",
        String(post.chat.id),
        "",
        "این عدد را در CONTENT_CHANNEL_ID بگذارید (به‌صورت Secret، نه Variable — متغیرهای متنی با هر دیپلوی پاک می‌شوند).",
      ].join("\n");
      await ctx.api.sendMessage(post.chat.id, text).catch((err) =>
        console.error("ارسال راهنمای پیکربندی به کانال شکست خورد:", err && err.message)
      );
    }
    return;
  }

  if (c.kind === "none") return;

  if (c.kind === "text") {
    await upsertTextContent(ctx.env, {
      contentId: c.contentId,
      body: c.body,
      photoFileId: c.photoFileId,
    });
    console.log("متن ثبت شد:", c.contentId);
    return;
  }

  await upsertContent(ctx.env, {
    contentId: c.contentId,
    title: c.title,
    fileId: c.fileId,
    fileType: c.fileType,
  });
  console.log("محتوا ثبت شد:", c.contentId, c.fileType);
}
