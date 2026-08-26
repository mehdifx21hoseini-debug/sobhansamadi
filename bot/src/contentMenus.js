import { InlineKeyboard } from "grammy";
import { logContentRequest } from "./db.js";

// --- کتابخانه‌ی روانشناسی ---

const LIBRARY_INTRO_TEXT = [
  "📚 کتابخانه تخصصی روانشناسی معامله‌گری",
  "",
  "در سال‌های فعالیت حرفه‌ای‌ام، همواره یکی از بزرگ‌ترین چالش‌ها، دسترسی به منابع معتبر و به‌روز روانشناسی معامله‌گری به زبان فارسی بوده است.",
  "",
  "به همین دلیل، با سرمایه‌گذاری شخصی، مجموعه‌ای از کتاب‌های مطرح و به‌روز دنیا در حوزه روانشناسی معامله‌گری را انتخاب، ترجمه و با دریافت مجوز، در اختیار جامعه معامله‌گران فارسی‌زبان قرار داده‌ایم.",
  "",
  "هر کتاب علاوه بر نسخه PDF، به‌صورت پادکست صوتی نیز تهیه شده تا بتوانی در هر زمان و هر مکان از آن استفاده کنی.",
  "",
  "📖 از فهرست زیر، کتاب موردنظر خودت را انتخاب کن.",
].join("\n");

const BOOK_TITLES = {
  "01": "📕 کتاب ۱: موفقیت در معامله‌گری",
  "02": "📕 کتاب ۲: تسلط بر بازی روانی معامله‌گری",
  "03": "📕 کتاب ۳: انضباط شخصی برای ذهن‌های مضطرب",
  "04": "📕 کتاب ۴: پایان اهمال‌کاری",
};

function libraryKeyboard() {
  const kb = new InlineKeyboard().text("📕 ذهنیت ثروتمند یک معامله‌گر", "BOOK_SELECT|00").row();
  for (const [id, label] of Object.entries(BOOK_TITLES)) {
    kb.text(label, "BOOK_SELECT|" + id).row();
  }
  return kb.text("🏠 منوی اصلی", "MENU_MAIN");
}

function bookPartsKeyboard(bookId) {
  const kb = new InlineKeyboard();
  kb.text("📄 نسخه PDF", `CONTENT|BOOK_${bookId}_PDF`).row();
  kb.text("🎧 نسخه صوتی", `CONTENT|BOOK_${bookId}_AUDIO`).row();
  return kb.text("🔙 بازگشت به کتابخانه", "BOOK_LIST_BACK").row().text("🏠 منوی اصلی", "MENU_MAIN");
}

export async function sendLibrary(ctx) {
  await ctx.reply(LIBRARY_INTRO_TEXT, { reply_markup: libraryKeyboard() });
}

export async function handleBookSelect(ctx, bookId) {
  if (bookId === "00") {
    await ctx.editMessageText(
      "📕 ذهنیت ثروتمند یک معامله‌گر\n\nاین کتاب از طریق سایت آکادمی قابل خریداریه.",
      {
        reply_markup: new InlineKeyboard()
          .url("🛒 سفارش از سایت", "https://sobhansamadi.com/the-rich-mind-of-a-trader/")
          .row()
          .text("🔙 بازگشت به کتابخانه", "BOOK_LIST_BACK")
          .row()
          .text("🏠 منوی اصلی", "MENU_MAIN"),
      }
    );
    return;
  }
  const title = BOOK_TITLES[bookId] || bookId;
  await ctx.editMessageText(`${title}\nنسخه موردنظر را انتخاب کنید:`, { reply_markup: bookPartsKeyboard(bookId) });
}

export async function handleLibraryBack(ctx) {
  await ctx.editMessageText(LIBRARY_INTRO_TEXT, { reply_markup: libraryKeyboard() });
}

// --- اکسپرت مدیریت سرمایه ---

const EXPERT_INTRO_TEXT =
  "🤖 اکسپرت هوشمند SsProX\n\nپلتفرم معاملاتی خود را انتخاب کنید تا فایل و ویدیوی آموزشی مخصوص همون نسخه براتون ارسال بشه:";

function expertKeyboard() {
  return new InlineKeyboard()
    .text("🟦 MetaTrader 4", "EXPERT_MT4")
    .row()
    .text("🟩 MetaTrader 5", "EXPERT_MT5")
    .row()
    .text("🏠 منوی اصلی", "MENU_MAIN");
}

export async function sendExpert(ctx) {
  await ctx.reply(EXPERT_INTRO_TEXT, { reply_markup: expertKeyboard() });
}

export async function handleExpertPlatform(ctx, platform) {
  await logContentRequest(ctx.env, ctx.from.id, ctx.from.username, `EXPERT_${platform}_FILE`);
  await ctx.editMessageText(
    `✅ درخواست شما برای اکسپرت هوشمند SsProX نسخه ${platform === "MT4" ? "MetaTrader 4" : "MetaTrader 5"} ثبت شد.\n\nتیم آکادمی به‌زودی فایل و ویدیوی آموزشی رو براتون می‌فرسته. 🙏\n\nاگر پلتفرم دیگری هم نیاز دارید، از دکمه‌های زیر انتخاب کنید:`,
    { reply_markup: expertKeyboard() }
  );
}

// --- دوره‌های رایگان (زیرمنو) ---

function freeCoursesKeyboard() {
  return new InlineKeyboard()
    .text("📚 آموزش رایگان دوره مقدماتی", "MENU_FREE_INTRO")
    .row()
    .text("🧠 آموزش رایگان هوش هیجانی", "MENU_FREE_EQ")
    .row()
    .text("🏠 منوی اصلی", "MENU_MAIN");
}

export async function sendFreeCoursesMenu(ctx) {
  await ctx.reply("📚 دوره‌های رایگان\nیکی از گزینه‌ها را انتخاب کنید:", { reply_markup: freeCoursesKeyboard() });
}

const INTRO_COURSE_TEXT = [
  "📚 دوره رایگان مقدماتی فارکس",
  "",
  "خوش اومدی 👋",
  "",
  "مدت این دوره حدود ۸ ساعته. اگه تازه‌واردی، از جلسهٔ اول شروع کن.",
  "",
  "برای شروع، روی جلسهٔ اول کلیک کن 👇",
].join("\n");

const INTRO_SESSIONS = [
  ["مقدمه و مسیر پیش رو", "INTRO_P01"],
  ["فارکس چیست", "INTRO_P02"],
  ["علت حرکت قیمت", "INTRO_P03"],
  ["ثبت نام در بروکر", "INTRO_P04_LINK"],
  ["آموزش متاتریدر ۴", "INTRO_P05"],
  ["آموزش متاتریدر ۵", "INTRO_P06"],
  ["نحوه سود و زیان", "INTRO_P07"],
  ["کندل استیک (پارت ۱)", "INTRO_P08"],
  ["سفارش گذاری", "INTRO_P09"],
  ["مفاهیم اصلی (ترمینال)", "INTRO_P10"],
  ["پرایس اکشن چیست", "INTRO_P11"],
  ["کندل استیک (پارت ۲)", "INTRO_P12"],
  ["روند معاملاتی", "INTRO_P13"],
  ["بررسی ترند و پین بار", "INTRO_P14"],
  ["واریز و برداشت", "INTRO_P15"],
  ["مسیر پیش رو", "INTRO_P16"],
];

function introSessionsKeyboard() {
  const kb = new InlineKeyboard();
  INTRO_SESSIONS.forEach(([label, id]) => kb.text(label, `CONTENT|${id}`).row());
  return kb.text("🏠 منوی اصلی", "MENU_MAIN");
}

export async function sendFreeIntro(ctx) {
  await ctx.reply(INTRO_COURSE_TEXT, { reply_markup: introSessionsKeyboard() });
}

const EQ_INTRO_TEXT = [
  "بسیاری از معامله‌گران، استراتژی مناسبی دارند؛ اما هنگام اجرای آن شکست می‌خورند.",
  "",
  "دلیل این اتفاق، نداشتن دانش نیست؛ ناتوانی در مدیریت احساسات و تصمیم‌گیری در لحظه است — یعنی هوش هیجانی (EQ).",
  "",
  "پیشنهاد می‌کنم ویدیوها را به ترتیب مشاهده کنی.",
].join("\n");

function eqSessionsKeyboard() {
  return new InlineKeyboard()
    .text("قسمت ۱", "CONTENT|EMOTIONAL_P01")
    .row()
    .text("قسمت ۲", "CONTENT|EMOTIONAL_P02")
    .row()
    .text("قسمت ۳", "CONTENT|EMOTIONAL_P03")
    .row()
    .text("قسمت ۴", "CONTENT|EMOTIONAL_P04")
    .row()
    .text("🏠 منوی اصلی", "MENU_MAIN");
}

export async function sendFreeEq(ctx) {
  await ctx.reply(EQ_INTRO_TEXT, { reply_markup: eqSessionsKeyboard() });
}

// --- تحویل محتوا (فعلاً بدون فایل واقعی) ---

const EQ_P4_FOLLOWUP_TEXT = [
  "🎉 آفرین! تمرین‌های هوش هیجانی رو با موفقیت گذروندی.",
  "",
  "حالا وقتشه بسنجی هوش هیجانی‌ت در چه سطحیه. با شرکت در تست تخصصی هوش هیجانی آکادمی، نقاط قوت و ضعفت رو دقیق‌تر بشناس.",
  "",
  "برای شروع، روی «تست هوش هیجانی» کلیک کن.",
].join("\n");

const INTRO_P16_FOLLOWUP_TEXT = [
  "🎉 تبریک! دوره مقدماتی رایگان فارکس رو با موفقیت به پایان رساندی.",
  "",
  "از اینجا به بعد، برای تبدیل شدن به یک معامله‌گر واقعی، قدم بعدی تو مجموعه آموزشی پیشرفته است.",
  "",
  "در این مجموعه، بیش از ۵۳ ساعت آموزش تخصصی که حاصل هشت سال تجربه من است رو بهت آموزش می‌دهم؛ به‌علاوه منتورینگی که قرار دادم تا قدم‌به‌قدم حرفه‌ای پیش بیای.",
  "",
  "من یک معامله‌گر می‌سازم.",
  "",
  "📍 اما ورود به این مجموعه برای همه یکسان نیست؛ اول باید تعیین سطح بشی تا مشخص بشه در چه نقطه‌ای قرار داری و مسیر مناسب خودت رو شروع کنی.",
  "",
  "اگر آماده‌ای قدم بعدی رو برداری، روی دکمه زیر کلیک کن، اطلاعاتت رو پر کن تا باهات ارتباط گرفته بشه. 👇🏻",
  "",
  "بهت افتخار می‌کنم.",
  "الان که این پیام رو می‌خونی، نشون‌دهنده‌ی تلاشته.",
  "امید روزی که از من تاییدیه‌ی حساب ریل دریافت کنی.",
].join("\n");

export async function handleContentRequest(ctx, contentId) {
  await logContentRequest(ctx.env, ctx.from.id, ctx.from.username, contentId);
  await ctx.answerCallbackQuery({ text: "✅ درخواست شما ثبت شد", show_alert: false }).catch(() => {});
  await ctx.reply("✅ درخواست شما ثبت شد؛ تیم آکادمی به‌زودی فایل/ویدیوی این بخش رو براتون می‌فرسته. 🙏");

  if (contentId === "EMOTIONAL_P04") {
    await ctx.reply(EQ_P4_FOLLOWUP_TEXT, {
      reply_markup: new InlineKeyboard().url(
        "🎓 تست هوش هیجانی",
        encodeURI("https://sobhansamadi.com/مجموعه-آموزشی-هوش-هیجانی/")
      ),
    });
    return;
  }

  if (contentId === "INTRO_P16") {
    await ctx.reply(INTRO_P16_FOLLOWUP_TEXT, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("🎓 مجموعه آموزشی پیشرفته", "INTRO_REGISTER_ADVANCED"),
    });
  }
}
