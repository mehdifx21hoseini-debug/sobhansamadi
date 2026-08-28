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

import {
  upsertContent,
  upsertTextContent,
  deactivateContent,
  deactivateContentBySuffix,
  deactivateTextContent,
} from "./store.js";
import { readContentChannel, writeContentChannel } from "./channel.js";
import { OWNER_ID } from "../owner.js";

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

// دو خانواده‌ی محتوا کد شماره‌دار ندارند و هرگز هم نباید داشته باشند:
// تعدادشان از پیش معلوم نیست و مدام اضافه می‌شود. هر پست تازه یک مدخل
// تازه است، نه جای‌گزین قبلی. برای همین شناسه‌شان با زمان ساخته می‌شود.
//
// هر دو شکل نیم‌فاصله و زیرخط پذیرفته می‌شود، چون کیبورد فارسی روی
// گوشی‌های مختلف یکی از این دو را می‌دهد و آکادمی نباید مجبور باشد
// حواسش به تفاوتی باشد که چشم نمی‌بیندش.
const PSY_VOICE_HASHTAGS = ["#ویس‌روانشناسی", "#ویس_روانشناسی"];
const LIVE_TRADE_HASHTAGS = ["#لایو‌ترید", "#لایو_ترید", "#لایوترید"];

// پیشوند شناسه‌ها. جای دیگری (menuActions) با همین پیشوند فهرست می‌گیرد،
// پس اینجا صادر می‌شوند تا دو رشته‌ی جدا از هم دور نیفتند.
export const PSY_VOICE_PREFIX = "PSY_VOICE_";
export const LIVE_TRADE_PREFIX = "LIVE_TRADE_VIDEO_";

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

// هشتگ‌ها از عنوان پاک می‌شوند - هم هشتگ فرمان (#ویس_روانشناسی) و هم
// برچسب‌های آزاد (#طلا) - ولی خط‌های کپشن دست‌نخورده می‌مانند.
//
// چرا خط‌ها مهم‌اند: خط اول روی دکمه می‌نشیند و بقیه زیر خود فایل
// می‌آید. اگر همه‌ی کپشن به یک خط تبدیل شود، آکادمی راهی ندارد بگوید
// «این تکه عنوان است و آن تکه توضیح».
export function stripTags(text) {
  return String(text || "")
    .replace(/#[^\s#]+/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// هشتگ حذف. روی همان پست گذاشته می‌شود (کپشن ویرایش می‌شود) و همان
// مدخل را از دسترس کاربر بیرون می‌برد.
const DELETE_HASHTAGS = ["#حذف", "#DELETE"];

function hasDeleteTag(caption) {
  const upper = String(caption).toUpperCase();
  return DELETE_HASHTAGS.some((h) => {
    const idx = upper.indexOf(h.toUpperCase());
    if (idx === -1) return false;
    // «#حذف» نباید داخل «#حذف_شده» یا #DELETED هم بگیرد.
    return !/[A-Z0-9_؀-ۿ]/.test(upper.charAt(idx + h.length));
  });
}

// تصمیم می‌گیرد این پست کانال چه چیزی است. هیچ عارضه‌ای ندارد تا بشود
// جداگانه تستش کرد.
//
// حذف یک حالت جدا نیست، یک پرچم روی همان تشخیص است: کپشن ویرایش‌شده‌ی
// یک پست هنوز همان پست است، پس اول معلوم می‌شود «کدام مدخل» و بعد
// اینکه «ثبت یا حذف».
export function classifyPost(post) {
  const res = classifyCore(post);
  if (!hasDeleteTag(post.caption || post.text || "")) return res;

  if (res.kind === "file" || res.kind === "text") {
    return { kind: "delete", contentId: res.contentId, scope: res.kind };
  }

  // هشتگ محتوا از کپشن پاک شده و فقط #حذف مانده. هنوز می‌شود از روی
  // شماره‌ی پیام، مدخلِ ساخته‌شده از همین پست را پیدا کرد - وگرنه
  // آکادمی باید هشتگ اصلی را یادش بماند تا بتواند حذف کند.
  if (post.message_id) {
    return { kind: "delete", contentId: "", messageId: post.message_id, scope: "file" };
  }

  return { kind: "none" };
}

function classifyCore(post) {
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

  const free = !code && !textCode && hasMedia;
  const isPsyVoice = free && PSY_VOICE_HASHTAGS.some((h) => caption.indexOf(h) !== -1);
  const isLiveTrade =
    free && !isPsyVoice && LIVE_TRADE_HASHTAGS.some((h) => caption.indexOf(h) !== -1);

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

  if (isPsyVoice || isLiveTrade) {
    const tags = isPsyVoice ? PSY_VOICE_HASHTAGS : LIVE_TRADE_HASHTAGS;
    let title = caption;
    for (const h of tags) title = title.split(h).join("");
    // بقیه‌ی هشتگ‌های کپشن (مثل #طلا) هم از عنوان پاک می‌شوند تا عنوانی
    // که به کاربر نشان داده می‌شود، جمله باشد نه دنباله‌ای از برچسب.
    title = stripTags(title);
    return {
      kind: "file",
      // این دو خانواده کد ثابت ندارند؛ هر پست یک مدخل تازه است.
      //
      // شناسه از message_id ساخته می‌شود نه از زمان: اگر آکادمی کپشن یک
      // پست را اصلاح کند، همان سطر به‌روز می‌شود و نسخه‌ی دومی ساخته
      // نمی‌شود. صفرهای ابتدایی برای این است که مرتب‌سازی متنی هم به
      // ترتیب انتشار بماند.
      contentId:
        (isPsyVoice ? PSY_VOICE_PREFIX : LIVE_TRADE_PREFIX) +
        String(post.message_id || Date.now()).padStart(9, "0"),
      title: title || (isPsyVoice ? "ویس روانشناسی بدون عنوان" : "لایو ترید بدون عنوان"),
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

// کانال مجاز، به‌ترتیب اولویت: چیزی که در D1 ثبت شده، وگرنه متغیر
// محیطی. متغیر فقط یک پیشنهاد اولیه است و اگر شکلش هم عجیب باشد،
// normalizeChannelId درستش می‌کند.
export async function resolveAllowedChannel(env) {
  const stored = await readContentChannel(env).catch(() => null);
  if (stored) return { id: normalizeChannelId(stored), source: "ثبت‌شده" };
  const fromEnv = normalizeChannelId(env.CONTENT_CHANNEL_ID);
  if (fromEnv) return { id: fromEnv, source: "متغیر محیطی" };
  return { id: "", source: "" };
}

export async function handleChannelPost(ctx) {
  const post = ctx.channelPost || ctx.update.channel_post || ctx.update.edited_channel_post;
  if (!post || !post.chat) return;

  const c = classifyPost(post);
  if (c.kind === "none") return;

  const here = normalizeChannelId(post.chat.id);
  const allowed = await resolveAllowedChannel(ctx.env);

  // هنوز هیچ کانالی ثبت نشده: همین کانال ثبت می‌شود.
  //
  // پنجره‌ی خطر این است که یک نفر زودتر از آکادمی رباتش را در کانال خودش
  // ادمین کند و اول پست بگذارد. برای همین مدیر همان لحظه پیام می‌گیرد و
  // با /resetchannel می‌تواند بازش کند - اشتباه دیده می‌شود و برگشت‌پذیر
  // است، که از یک تنظیم دستی که سه بار غلط وارد شد بهتر است.
  if (!allowed.id) {
    await writeContentChannel(ctx.env, here);
    console.log("کانال محتوا ثبت شد:", here);
    await notifyOwner(
      ctx,
      [
        "✅ کانال محتوا ثبت شد.",
        "",
        "کانال: «" + (post.chat.title || "?") + "»",
        "آیدی: <code>" + here + "</code>",
        "",
        "از این به بعد فقط فایل‌های همین کانال پذیرفته می‌شوند.",
        "اگر این کانال درست نیست، /resetchannel را بزنید.",
      ].join("\n")
    );
  } else if (allowed.id !== here) {
    console.log("پست کانال نادیده گرفته شد:", here, "≠", allowed.id);
    await ctx.api
      .sendMessage(
        post.chat.id,
        [
          "⚠️ این فایل ثبت نشد.",
          "",
          "کانال محتوای این ربات، کانال دیگری است.",
          "",
          "آیدی این کانال: " + here,
        ].join("\n")
      )
      .catch(() => {});
    return;
  }

  if (c.kind === "delete") {
    let removed = 0;
    if (c.contentId) {
      removed =
        c.scope === "text"
          ? await deactivateTextContent(ctx.env, c.contentId)
          : await deactivateContent(ctx.env, c.contentId);
    } else if (c.messageId) {
      removed = await deactivateContentBySuffix(
        ctx.env,
        String(c.messageId).padStart(9, "0")
      );
    }

    console.log("حذف محتوا:", c.contentId || c.messageId, removed);
    await ctx.api
      .sendMessage(
        post.chat.id,
        removed > 0
          ? "🗑 حذف شد: " + (c.contentId || "این مورد") + "\nدیگر در ربات نمایش داده نمی‌شود."
          : "⚠️ چیزی برای حذف پیدا نشد.\nشاید از قبل حذف شده یا هرگز ثبت نشده بود.",
        { reply_to_message_id: post.message_id }
      )
      .catch(() => {});
    return;
  }

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

  // تایید در خود کانال: بدون آن، تنها راه فهمیدن اینکه فایل ثبت شده،
  // رفتن به ربات و امتحان کردن دکمه است.
  await ctx.api
    .sendMessage(post.chat.id, "✅ ثبت شد: " + c.contentId, {
      reply_to_message_id: post.message_id,
    })
    .catch(() => {});
}

async function notifyOwner(ctx, text) {
  await ctx.api
    .sendMessage(OWNER_ID, text, { parse_mode: "HTML" })
    .catch((err) => console.error("اطلاع به مدیر نرسید:", err && err.message));
}
