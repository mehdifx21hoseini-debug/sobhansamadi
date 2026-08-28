import { InlineKeyboard } from "grammy";
import { logContentRequest } from "./db.js";
import { deliverContent } from "./content/deliver.js";
import { isOwner } from "./owner.js";
import { sendSection, editSection, resolveSection } from "./content/sectionText.js";

// --- کتابخانه‌ی روانشناسی ---

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

// چیدمان دکمه‌های صوتی هر کتاب، عیناً از نودهای Send Book 01..04 در
// WF-02. هر کتاب ساختار خودش را دارد و نمی‌شود یکسان ساختشان:
//
//   ۱ → یک فایل صوتی کامل
//   ۲ → پنج پارت
//   ۳ → ده فصل
//   ۴ → مقدمه + هفت فصل
//
// یک دکمه‌ی «نسخه صوتی» که همه را یک‌جا بفرستد، برای کتاب سه یعنی ده
// فایل پشت‌سرهم - کاربر نه می‌تواند فصل دلخواهش را پیدا کند، نه اگر
// وسطش رها کند می‌داند کجا بود.
const BOOK_AUDIO_PARTS = {
  "01": [["🎧 نسخه صوتی کامل", "BOOK_01_AUDIO"]],
  "02": [1, 2, 3, 4, 5].map((n) => [
    "🎧 پارت " + toFa(n),
    "BOOK_02_AUDIO_P" + String(n).padStart(2, "0"),
  ]),
  "03": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [
    "🎧 فصل " + toFa(n),
    "BOOK_03_AUDIO_CH" + String(n).padStart(2, "0"),
  ]),
  "04": [["🎧 مقدمه", "BOOK_04_AUDIO_INTRO"]].concat(
    [1, 2, 3, 4, 5, 6, 7].map((n) => [
      "🎧 فصل " + toFa(n),
      "BOOK_04_AUDIO_CH" + String(n).padStart(2, "0"),
    ])
  ),
};

function toFa(n) {
  return String(n).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
}

function bookPartsKeyboard(bookId) {
  const kb = new InlineKeyboard();
  kb.text("📄 نسخه PDF", `CONTENT|BOOK_${bookId}_PDF`).row();
  for (const [label, id] of BOOK_AUDIO_PARTS[bookId] || []) {
    kb.text(label, `CONTENT|${id}`).row();
  }
  return kb.text("🔙 بازگشت به کتابخانه", "BOOK_LIST_BACK").row().text("🏠 منوی اصلی", "MENU_MAIN");
}

export async function sendLibrary(ctx) {
  await sendSection(ctx, "LIBRARY", libraryKeyboard());
}

export async function handleBookSelect(ctx, bookId) {
  if (bookId === "00") {
    const { text: bookText } = await resolveSection(ctx.env, "BOOK_00");
    await ctx.editMessageText(
      bookText,
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
  await editSection(ctx, "LIBRARY", libraryKeyboard());
}

// --- اکسپرت مدیریت سرمایه ---

// شیء خام و نه سازنده‌ی InlineKeyboard: گرامی فیلد style را نمی‌شناسد و
// بی‌صدا دور می‌ریزد، پس دکمه‌ها بی‌رنگ می‌شوند. نسخه‌ی n8n هم دقیقاً به
// همین دلیل به‌جای نود تلگرام از httpRequest استفاده می‌کرد.
//
// دو رنگ برای دو پلتفرم، هم‌رنگ همان مربع‌های ایموجی که کنارشان است.
// «منوی اصلی» عمداً بی‌رنگ می‌ماند: دکمه‌ی حرکت است نه انتخاب، و اگر آن
// هم رنگی شود، رنگ دیگر چیزی را از هم جدا نمی‌کند.
function expertKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🟦 MetaTrader 4", callback_data: "EXPERT_MT4", style: "primary" }],
      [{ text: "🟩 MetaTrader 5", callback_data: "EXPERT_MT5", style: "success" }],
      [{ text: "🏠 منوی اصلی", callback_data: "MENU_MAIN" }],
    ],
  };
}

export async function sendExpert(ctx) {
  await sendSection(ctx, "EXPERT", expertKeyboard());
}

export async function handleExpertPlatform(ctx, platform) {
  const name = platform === "MT4" ? "MetaTrader 4" : "MetaTrader 5";
  await logContentRequest(ctx.env, ctx.from.id, ctx.from.username, `EXPERT_${platform}_FILE`);

  // اکسپرت دو تکه دارد: ویدیوی آموزش نصب، و خود فایل.
  //
  // ویدیو اول می‌رود: کسی که تا حالا اکسپرت نصب نکرده، با دیدن فایل
  // تنها نمی‌داند با آن چه کند. اول یاد می‌گیرد، بعد چیزی را می‌گیرد که
  // نصبش را بلد است - و فایل، آخرین پیام و در دسترس می‌ماند.
  let delivered = 0;
  try {
    await ctx.replyWithChatAction("upload_document").catch(() => {});
    for (const id of [`EXPERT_${platform}_VIDEO`, `EXPERT_${platform}_FILE`]) {
      delivered += await deliverContent(ctx, id);
    }
  } catch (err) {
    console.error("ارسال اکسپرت شکست خورد:", platform, err && err.message);
  }

  await ctx.editMessageText(
    delivered > 0
      ? `✅ اکسپرت هوشمند SsProX نسخه ${name} براتون ارسال شد.\n\nاگر پلتفرم دیگری هم نیاز دارید، از دکمه‌های زیر انتخاب کنید:`
      : `✅ درخواست شما برای اکسپرت هوشمند SsProX نسخه ${name} ثبت شد.\n\nتیم آکادمی به‌زودی فایل و ویدیوی آموزشی رو براتون می‌فرسته. 🙏\n\nاگر پلتفرم دیگری هم نیاز دارید، از دکمه‌های زیر انتخاب کنید:`,
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
  await sendSection(ctx, "FREE_MENU", freeCoursesKeyboard());
}

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
  await sendSection(ctx, "INTRO_COURSE", introSessionsKeyboard());
}

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
  await sendSection(ctx, "EQ_INTRO", eqSessionsKeyboard());
}

// --- تحویل محتوا (فعلاً بدون فایل واقعی) ---

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


// دو تماس مستقل (نوشتن در D1، answer کردن callback) هم‌زمان اجرا
// می‌شوند تا هر پیام کمتر منتظر رفت‌وبرگشت‌های پشت‌سرهم به تلگرام بماند -
// روی مقیاس چند هزار کاربر همزمان این تاخیرها جمع می‌شوند.
export async function handleContentRequest(ctx, contentId) {
  // callback فوراً پاسخ داده می‌شود تا ساعت شنی روی دکمه گیر نکند؛ ثبت
  // درخواست هم موازی می‌رود چون هیچ‌کدام به دیگری وابسته نیست.
  await Promise.allSettled([
    logContentRequest(ctx.env, ctx.from.id, ctx.from.username, contentId),
    ctx.answerCallbackQuery().catch(() => {}),
  ]);

  // اگر فایل واقعی در کتابخانه هست، همین حالا می‌رود. پیام «ثبت شد» فقط
  // برای چیزهایی می‌ماند که هنوز از کانال نیامده‌اند.
  let delivered = 0;
  try {
    await ctx.replyWithChatAction("upload_document").catch(() => {});
    // مدیر باید بتواند موردِ مخفی را هم ببیند - وگرنه پیش از نمایش به
    // کاربران راهی برای بررسی‌اش ندارد.
    delivered = await deliverContent(ctx, contentId, { includeHidden: isOwner(ctx) });
  } catch (err) {
    console.error("ارسال محتوا شکست خورد:", contentId, err && err.message);
  }

  // پیام تایید فقط وقتی معنی دارد که چیزی نرفته باشد؛ بعد از دریافت
  // خودِ فایل، «درخواست شما ثبت شد» گیج‌کننده است.
  // هر دو متن قابل ویرایش‌اند، پس هر بار از پایگاه داده خوانده می‌شوند.
  const ackText = (await resolveSection(ctx.env, "CONTENT_ACK")).text;
  const ack = delivered > 0 ? "" : ackText + "\n\n";

  if (contentId === "EMOTIONAL_P04") {
    const eqDone = (await resolveSection(ctx.env, "EQ_DONE")).text;
    await ctx.reply(ack + eqDone, {
      reply_markup: new InlineKeyboard().url(
        "🎓 تست هوش هیجانی",
        encodeURI("https://sobhansamadi.com/مجموعه-آموزشی-هوش-هیجانی/")
      ),
    });
    return;
  }

  if (contentId === "INTRO_P16") {
    await ctx.reply(ack + INTRO_P16_FOLLOWUP_TEXT, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("🎓 مجموعه آموزشی پیشرفته", "INTRO_REGISTER_ADVANCED"),
    });
    return;
  }

  // فایل رفت و دنباله‌ای هم ندارد: دیگر چیزی لازم نیست.
  if (delivered > 0) return;

  await ctx.reply(ackText);
}
