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

  // عکس/ویدیوی معرفی. متن خوش‌آمد بلندتر از سقف کپشن تلگرام است، پس
  // رسانه جدا می‌رود و متن پشت سرش - نه به‌عنوان کپشن.
  //
  // شکستش هرگز نباید جلوی پیام خوش‌آمد را بگیرد: یک عکس نیامده بهتر از
  // کاربری است که هیچ منویی نمی‌بیند.
  //
  // دو منبع، به همین ترتیب: عکسی که مدیر از داخل ویرایشگر گذاشته، وگرنه
  // فایلی که با هشتگ #WELCOME_PHOTO در کانال پست شده. مسیر دوم می‌تواند
  // ویدیو هم باشد، که ویرایشگر پشتیبانی نمی‌کند.
  const section = await resolveSection(ctx.env, "WELCOME").catch(() => null);

  try {
    if (section && section.photo) {
      await ctx.replyWithPhoto(section.photo);
    } else {
      const media = await getContent(ctx.env, "WELCOME_PHOTO");
      if (media && media.file_id) {
        if (media.file_type === "video") await ctx.replyWithVideo(media.file_id);
        else if (media.file_type === "photo") await ctx.replyWithPhoto(media.file_id);
      }
    }
  } catch (err) {
    console.error("ارسال رسانه‌ی خوش‌آمد شکست خورد:", err && err.message);
  }

  // کیبورد اصلی همیشه باید برسد، حتی اگر خواندن متن شکسته باشد.
  await ctx.reply((section && section.text) || WELCOME_TEXT, {
    reply_markup: mainMenuKeyboard(),
  });
}

// بدون parse_mode: متن راهنما از ویرایشگر می‌آید و اگر با HTML فرستاده
// شود، یک «<» در چیزی که مدیر می‌نویسد کل پیام را رد می‌کند - خطایی که
// فقط کاربر می‌بیند و مدیر هرگز.
export async function handleHelp(ctx) {
  await sendSection(ctx, "HELP", mainMenuKeyboard());
}
