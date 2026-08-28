import { mainMenuKeyboard } from "../menu.js";
import { recordUserSource } from "../db.js";
import { WELCOME_TEXT } from "../content/defaults.js";
import { getContent } from "../content/store.js";
import { resolveSection, sendSection } from "../content/sectionText.js";

export async function handleStart(ctx) {
  // لینک عمیق: t.me/BOT?start=instagram
  //
  // این تنها راه فهمیدن این است که کاربر از کدام کمپین آمده. برای انتشار
  // عمومی حیاتی است، چون بدون آن نمی‌شود گفت تبلیغ اینستاگرام جواب داده
  // یا پست کانال. شکستش هرگز نباید جلوی پیام خوش‌آمد را بگیرد.
  const payload = (ctx.match || "").toString().trim();
  if (payload) {
    await recordUserSource(ctx.env, ctx.from.id, payload).catch((err) =>
      console.error("ثبت منبع جذب شکست خورد:", err && err.message)
    );
  }

  // رسانه‌ی معرفی از دو منبع می‌آید، به همین ترتیب: عکسی که مدیر از
  // ویرایشگر گذاشته، وگرنه فایلی که با هشتگ #WELCOME_PHOTO در کانال پست
  // شده. مسیر دوم می‌تواند ویدیو هم باشد؛ ویرایشگر فقط عکس می‌گیرد.
  const section = await resolveSection(ctx.env, "WELCOME").catch(() => null);
  const text = (section && section.text) || WELCOME_TEXT;
  const media = await resolveWelcomeMedia(ctx, section);

  // عکس و متن یک پیام‌اند، نه دو تا: پیام اول ربات، اولین برداشت کاربر
  // است و دو حباب جدا آن را تکه‌تکه می‌کند.
  //
  // فقط وقتی متن از سقف کپشن تلگرام رد شود چاره‌ای جز جدا کردن نیست -
  // کپشن بلندتر، کل ارسال را رد می‌کند و آن‌وقت نه عکس می‌رسد نه متن.
  const opts = { caption: text, reply_markup: mainMenuKeyboard() };

  if (media && text.length <= CAPTION_LIMIT) {
    try {
      if (media.type === "video") await ctx.replyWithVideo(media.fileId, opts);
      else await ctx.replyWithPhoto(media.fileId, opts);
      return;
    } catch (err) {
      // file_id باطل، عکس پاک‌شده، هر چیزی: می‌افتد به مسیر متنی پایین.
      console.error("ارسال رسانه‌ی خوش‌آمد شکست خورد:", err && err.message);
    }
  } else if (media) {
    const send =
      media.type === "video"
        ? ctx.replyWithVideo(media.fileId)
        : ctx.replyWithPhoto(media.fileId);
    await send.catch((err) =>
      console.error("ارسال رسانه‌ی خوش‌آمد شکست خورد:", err && err.message)
    );
  }

  // کیبورد اصلی همیشه باید برسد، حتی اگر رسانه نرسیده باشد: کاربری که
  // هیچ منویی نمی‌بیند، رباتِ خراب می‌بیند.
  await ctx.reply(text, { reply_markup: mainMenuKeyboard() });
}

// سقف کپشن تلگرام.
const CAPTION_LIMIT = 1024;

async function resolveWelcomeMedia(ctx, section) {
  if (section && section.photo) return { type: "photo", fileId: section.photo };
  try {
    const row = await getContent(ctx.env, "WELCOME_PHOTO");
    if (row && row.file_id && (row.file_type === "photo" || row.file_type === "video")) {
      return { type: row.file_type, fileId: row.file_id };
    }
  } catch (err) {
    console.error("خواندن رسانه‌ی خوش‌آمد شکست خورد:", err && err.message);
  }
  return null;
}

// بدون parse_mode: متن راهنما از ویرایشگر می‌آید و اگر با HTML فرستاده
// شود، یک «<» در چیزی که مدیر می‌نویسد کل پیام را رد می‌کند - خطایی که
// فقط کاربر می‌بیند و مدیر هرگز.
export async function handleHelp(ctx) {
  await sendSection(ctx, "HELP", mainMenuKeyboard());
}
