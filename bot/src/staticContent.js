import { sendSection } from "./content/sectionText.js";
import { deliverContent } from "./content/deliver.js";
import { logContentRequest } from "./db.js";

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

// ثبت‌نام بالا و سبز، دو آموزش زیرش و کنار هم و آبی.
//
// رنگ اینجا سلسله‌مراتب را می‌گوید: سبز یعنی کارِ اصلی این صفحه، و دو
// آبیِ هم‌ردیف یعنی دو آموزشِ هم‌ارزش که فرقشان در موضوع است نه در
// اهمیت.
export async function sendTrustedBroker(ctx) {
  await sendSection(ctx, "BROKER", {
    inline_keyboard: [
      [{ text: "🏦 لینک ثبت نام در بروکر معتمد", url: BROKER_URL, style: "success" }],
      [
        { text: "🎬 آموزش ثبت‌نام", callback_data: "BROKER_VID|SIGNUP", style: "primary" },
        { text: "🎬 آموزش واریز و برداشت", callback_data: "BROKER_VID|DEPOSIT", style: "primary" },
      ],
    ],
  });
}

// دو ویدیوی بروکر.
//
// «ثبت‌نام» همان ویدیویی است که تا امروز خودکار زیر متن بروکر می‌رفت؛
// «واریز و برداشت» جلسه‌ی ۱۵ دوره‌ی مقدماتی است. هیچ‌کدام کپی نشده‌اند:
// همان یک فایل در کتابخانه از دو جا خوانده می‌شود، وگرنه با هر
// جای‌گزینی باید یادت بماند دو جا را عوض کنی.
const BROKER_VIDEOS = {
  SIGNUP: { contentId: "TRUSTED_BROKER", title: "🎬 آموزش ثبت‌نام در بروکر معتمد" },
  DEPOSIT: { contentId: "INTRO_P15", title: "🎬 آموزش واریز و برداشت" },
};

export async function sendBrokerVideo(ctx, key) {
  const video = BROKER_VIDEOS[key];
  await ctx.answerCallbackQuery().catch(() => {});
  if (!video) return;

  // زیر ویدیو فقط بازگشت.
  //
  // دکمه‌ی ثبت‌نام اینجا هم بود و برداشته شد: صفحه‌ی بروکر یک قدم
  // بالاتر است و همان دکمه آنجا هست. تکرارش زیر هر ویدیو یعنی کاربر
  // دو جا یک کار را می‌بیند و دیگر معلوم نیست کدام «همان» است.
  const keyboard = {
    inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: "SEC_BROKER" }]],
  };

  let delivered = 0;
  try {
    await ctx.replyWithChatAction("upload_video").catch(() => {});
    delivered = await deliverContent(ctx, video.contentId, { extra: { reply_markup: keyboard } });
  } catch (err) {
    console.error("ارسال ویدیوی بروکر شکست خورد:", key, err && err.message);
  }

  // فایل نبود: کاربر نباید سکوت ببیند و دکمه‌ی ثبت‌نام هم نباید از دست
  // برود - همان دکمه‌ای که کل این صفحه برایش ساخته شده.
  if (delivered === 0) {
    await logContentRequest(ctx.env, ctx.from.id, ctx.from.username, video.contentId).catch(() => {});
    await ctx.reply(video.title + "\n\nاین ویدیو هنوز آماده نیست؛ به‌محض آماده شدن همین‌جا می‌فرستیم. 🙏", {
      reply_markup: keyboard,
    });
  }
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
