import { InlineKeyboard } from "grammy";
import { logContentRequest } from "./db.js";
import { deliverContent } from "./content/deliver.js";
import { isOwner } from "./owner.js";
import { sendSection, editSection, resolveSection, editWithText } from "./content/sectionText.js";

// --- کتابخانه‌ی روانشناسی ---

const BOOK_TITLES = {
  "01": "📕 کتاب ۱: موفقیت در معامله‌گری",
  "02": "📕 کتاب ۲: تسلط بر بازی روانی معامله‌گری",
  "03": "📕 کتاب ۳: انضباط شخصی برای ذهن‌های مضطرب",
  "04": "📕 کتاب ۴: پایان اهمال‌کاری",
};

// شیء خام و نه سازنده‌ی InlineKeyboard: گرامی فیلد style را بی‌صدا دور
// می‌ریزد و دکمه‌ها بی‌رنگ می‌شوند.
//
// «کتاب من» سبز است و بقیه آبی، چون تنها کتابی است که خریدنی است و
// مسیرش به سایت می‌رود. رنگ اینجا تزئین نیست: می‌گوید این یکی با آن
// چهارتا فرق دارد، پیش از آنکه کاربر رویش بزند.
//
// جایش هم پایینِ فهرست است نه بالایش: چهار کتاب بالایی رایگان‌اند و
// همین حالا دانلود می‌شوند؛ کتابِ خریدنی بعد از آن‌ها می‌آید، وقتی
// کاربر دیده آکادمی چه چیزی مجانی داده.
export const OWN_BOOK_LABEL = "📕 کتاب من: ذهن ثروتمند یک معامله‌گر";

function libraryKeyboard() {
  return {
    inline_keyboard: [
      ...Object.entries(BOOK_TITLES).map(([id, label]) => [
        { text: label, callback_data: "BOOK_SELECT|" + id, style: "primary" },
      ]),
      [{ text: OWN_BOOK_LABEL, callback_data: "BOOK_SELECT|00", style: "success" }],
      [{ text: "🏠 منوی اصلی", callback_data: "MENU_MAIN" }],
    ],
  };
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

// «ذهن ثروتمند» تنها کتابی است که فایل ندارد و از سایت خریده می‌شود،
// پس دکمه‌هایش هم فرق دارند.
function book00Keyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "🛒 سفارش از سایت",
          url: "https://sobhansamadi.com/the-rich-mind-of-a-trader/",
          style: "success",
        },
      ],
      [{ text: "🔙 بازگشت به کتابخانه", callback_data: "BOOK_LIST_BACK" }],
      [{ text: "🏠 منوی اصلی", callback_data: "MENU_MAIN" }],
    ],
  };
}

const CAPTION_LIMIT = 1024;

export async function handleBookSelect(ctx, bookId) {
  const keyboard = bookId === "00" ? book00Keyboard() : bookPartsKeyboard(bookId);
  const { text, photo } = await resolveSection(ctx.env, "BOOK_" + bookId);
  const body = text || `${BOOK_TITLES[bookId] || bookId}\nنسخه موردنظر را انتخاب کنید:`;

  // بدون عکس، همان پیام فهرست ویرایش می‌شود و چت شلوغ نمی‌شود.
  if (!photo) {
    await editWithText(ctx, body, keyboard);
    return;
  }

  // با عکس چاره‌ای جز پیام تازه نیست: تلگرام اجازه نمی‌دهد به یک پیام
  // متنی عکس اضافه شود.
  //
  // پس پیام فهرست بعدش پاک می‌شود تا به‌جای دو پیام روی هم، یکی جای
  // دیگری را بگیرد - همان حسی که ویرایشِ درجا می‌داد. اول ارسال، بعد
  // حذف: اگر ترتیب برعکس بود و ارسال شکست می‌خورد، کاربر با یک چت خالی
  // می‌ماند.
  try {
    if (body.length <= CAPTION_LIMIT) {
      await ctx.replyWithPhoto(photo, { caption: body, reply_markup: keyboard });
    } else {
      await ctx.replyWithPhoto(photo);
      await ctx.reply(body, { reply_markup: keyboard });
    }
    // تلگرام حذف پیام‌های قدیمی‌تر از ۴۸ ساعت را رد می‌کند؛ آن‌وقت فهرست
    // سر جایش می‌ماند که بدترین حالتش کمی شلوغی است، نه خرابی.
    await ctx.deleteMessage().catch(() => {});
  } catch (err) {
    // عکس خراب نباید کتاب را غیرقابل‌دسترس کند.
    console.error("ارسال جلد کتاب شکست خورد:", bookId, err && err.message);
    await editWithText(ctx, body, keyboard).catch(() =>
      ctx.reply(body, { reply_markup: keyboard })
    );
  }
}

export async function handleLibraryBack(ctx) {
  // برگشت از کتابی که جلد دارد.
  //
  // editWithText روی پیام عکس‌دار فقط کپشن را عوض می‌کند، یعنی فهرست
  // کتابخانه زیر جلدِ یک کتاب می‌نشست - عکسی که دیگر به هیچ‌کدام از
  // دکمه‌های زیرش ربط ندارد. اینجا پیام عکس‌دار پاک و فهرست تازه فرستاده
  // می‌شود.
  const msg = ctx.callbackQuery && ctx.callbackQuery.message;
  if (msg && (msg.photo || msg.video || msg.animation)) {
    await sendLibrary(ctx);
    await ctx.deleteMessage().catch(() => {});
    return;
  }
  await editSection(ctx, "LIBRARY", libraryKeyboard());
}

// --- اکسپرت مدیریت سرمایه ---

// شیء خام و نه سازنده‌ی InlineKeyboard: گرامی فیلد style را نمی‌شناسد و
// بی‌صدا دور می‌ریزد، پس دکمه‌ها بی‌رنگ می‌شوند. نسخه‌ی n8n هم دقیقاً به
// همین دلیل به‌جای نود تلگرام از httpRequest استفاده می‌کرد.
//
// هر دو پلتفرم یک رنگ دارند، و این عوض شد.
//
// پیش‌تر متاتریدر ۴ آبی بود و ۵ سبز - هم‌رنگ مربع‌های ایموجی کنارشان.
// ولی رنگ در بقیه‌ی ربات معنی دارد نه تزئین: سبز یعنی «مسیر
// پیشنهادی». دو گزینه‌ای که فقط به پلتفرمِ خود کاربر بستگی دارند و
// هیچ‌کدام بهتر از دیگری نیست، نباید یکی‌شان سبز باشد - کاربرِ
// متاتریدر ۴ نباید حس کند دارد گزینه‌ی درجه‌دو را می‌زند.
//
// دو دکمه‌ی پایین بی‌رنگ‌اند چون هیچ‌کدام انتخابِ این صفحه نیستند: یکی
// از ربات بیرون می‌برد و یکی به منو برمی‌گردد. اگر آن‌ها هم رنگی
// می‌شدند، رنگ دیگر چیزی را از هم جدا نمی‌کرد.
// صفحه‌ی سوالات پرتکرار اکسپرت روی سایت.
//
// آدرس از پیش درصدکدشده است و باید همین‌طور بماند: encodeURI روی این
// رشته % را دوباره کد می‌کند و آدرس را خراب. دکمه‌ی url با آدرس
// نامعتبر هم کل کیبورد را از سمت تلگرام رد می‌کند، نه فقط خودش را.
const EXPERT_FAQ_URL =
  "https://sobhansamadi.com/%D9%85%D8%AF%DB%8C%D8%B1%DB%8C%D8%AA-%D8%AD%D8%B1%D9%81%D9%87-%D8%A7%DB%8C-%D9%85%D8%B9%D8%A7%D9%85%D9%84%D8%A7%D8%AA-%D8%AF%D8%B1-ssprox/";

// دو دکمه‌ی فایل، کنار هم. در هر صفحه‌ای که «قدم بعدی» فایل گرفتن است
// همین ردیف می‌آید.
function expertFileRow() {
  return [
    { text: "📥 فایل متاتریدر ۴", callback_data: "EXPERT_MT4", style: "primary" },
    { text: "📥 فایل متاتریدر ۵", callback_data: "EXPERT_MT5", style: "primary" },
  ];
}

function expertKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🎬 رونمایی و آموزش نصب", callback_data: "EXPERT_VIDEOS", style: "primary" }],
      expertFileRow(),
      // زیر بقیه و بالای منوی اصلی: این کیبورد بعد از ارسال فایل هم
      // دوباره نشان داده می‌شود - دقیقاً همان لحظه‌ای که سوال‌ها پیش
      // می‌آید.
      [{ text: "❓ سوالات پرتکرار", url: EXPERT_FAQ_URL }],
      [{ text: "🏠 منوی اصلی", callback_data: "MENU_MAIN" }],
    ],
  };
}

// هر دو ویدیوی آموزش نصب، پشت سر هم.
//
// پیش‌تر ویدیو به فایل چسبیده بود: هر که متاتریدر ۵ را می‌زد، ویدیوی
// متاتریدر ۴ را هرگز نمی‌دید. ولی این دو، دو نسخه‌ی یک آموزش نیستند که
// یکی‌شان کافی باشد - آکادمی می‌خواهد مخاطب هر دو را ببیند. پس انتخاب
// از روی آموزش برداشته شد و فقط روی فایل ماند، جایی که واقعاً انتخاب
// است: کسی که متاتریدر ۴ دارد نباید فایل ۵ را بگیرد.
// این دو ویدیو هم‌وزن نیستند و کپشنشان هم نباید باشد: اولی رونمایی
// است و نصب متاتریدر ۴، دومی فقط نصب متاتریدر ۵. شماره‌گذاری همین را
// می‌گوید - کسی که قسمت ۲ را جدا ببیند می‌فهمد معرفی را در قسمت ۱ جا
// گذاشته.
//
// کپشن از اینجا می‌آید نه از عنوانِ پست کانال: این دو ویدیو در فهرست
// ⚙️ مدیر نیستند (آن فهرست فقط ویس‌های روانشناسی و لایو تریدهاست)، پس
// تنها راه عوض کردن عنوانشان پست دوباره در کانال بود.
const EXPERT_VIDEOS = [
  {
    id: "EXPERT_MT4_VIDEO",
    label: "رونمایی و نصب متاتریدر ۴",
    caption: [
      "🎬 قسمت ۱ — رونمایی از اکسپرت SsProX و نصب روی متاتریدر ۴",
      "",
      "اول اکسپرت را معرفی می‌کنم و بعد قدم‌به‌قدم نصبش را روی متاتریدر ۴ نشان می‌دهم.",
    ].join("\n"),
  },
  {
    id: "EXPERT_MT5_VIDEO",
    label: "نصب متاتریدر ۵",
    caption: [
      "🎬 قسمت ۲ — نصب روی متاتریدر ۵",
      "",
      "اگر متاتریدر ۵ استفاده می‌کنی، نصب روی همین نسخه را اینجا ببین. معرفی خودِ اکسپرت در قسمت ۱ گفته شده.",
    ].join("\n"),
  },
];

export async function sendExpertVideos(ctx) {
  // «سوالات پرتکرار» زیر ویدیوها هم می‌آید، نه فقط سر در بخش.
  //
  // درست بعد از دیدن آموزش نصب است که سوال‌ها پیش می‌آید - «اکسپرت در
  // Navigator نیست»، «چرا معامله باز نمی‌کند» - و اگر کاربر برای پیدا
  // کردن جوابش باید به صفحه‌ی قبل برگردد، به‌جایش پشتیبانی را می‌زند.
  const next = {
    inline_keyboard: [
      expertFileRow(),
      [{ text: "❓ سوالات پرتکرار", url: EXPERT_FAQ_URL }],
      [{ text: "🔙 بازگشت", callback_data: "SEC_EXPERT" }],
    ],
  };

  const sent = [];
  const missing = [];
  try {
    await ctx.replyWithChatAction("upload_video").catch(() => {});
    for (const video of EXPERT_VIDEOS) {
      // کپشن اینجا جای عنوانِ ردیف کتابخانه را می‌گیرد. سقف کپشن تلگرام
      // ۱۰۲۴ کاراکتر است و متن بلندتر کل ارسال را رد می‌کند.
      const n = await deliverContent(ctx, video.id, {
        extra: { caption: video.caption.slice(0, 1000) },
      }).catch(() => 0);
      (n > 0 ? sent : missing).push(video.label);
    }
  } catch (err) {
    console.error("ارسال ویدیوهای اکسپرت شکست خورد:", err && err.message);
  }

  // متن دقیقاً همان چیزی را می‌گوید که اتفاق افتاده. «هر دو ویدیو ارسال
  // شد» وقتی یکی‌شان نرفته، کاربر را دنبال چیزی می‌فرستد که نیست.
  let text;
  if (missing.length === 0) {
    text = "👆 هر دو قسمت ارسال شد.\n\nحالا فایل اکسپرت پلتفرم خودتان را بگیرید:";
  } else if (sent.length > 0) {
    text =
      "👆 آموزش نصب " + sent.join(" و ") + " ارسال شد.\n\nویدیوی " + missing.join(" و ") +
      " هنوز آماده نیست؛ به‌محض آماده شدن همین‌جا می‌فرستیم. 🙏";
  } else {
    text = "ویدیوهای آموزش نصب هنوز آماده نیستند؛ به‌محض آماده شدن همین‌جا می‌فرستیم. 🙏";
  }

  await ctx.reply(text, { reply_markup: next });
}

export async function sendExpert(ctx) {
  await sendSection(ctx, "EXPERT", expertKeyboard());
}

// فقط خودِ فایل. آموزش نصب دکمه‌ی خودش را دارد.
export async function handleExpertPlatform(ctx, platform) {
  const name = platform === "MT4" ? "MetaTrader 4" : "MetaTrader 5";
  await logContentRequest(ctx.env, ctx.from.id, ctx.from.username, `EXPERT_${platform}_FILE`);

  let delivered = 0;
  try {
    await ctx.replyWithChatAction("upload_document").catch(() => {});
    // دکمه‌ها به خود فایل می‌چسبند: فایل آخرین پیام و همیشه در دسترس
    // می‌ماند، و قدم بعدی هم زیر همان است.
    delivered = await deliverContent(ctx, `EXPERT_${platform}_FILE`, {
      extra: { reply_markup: expertKeyboard() },
    });
  } catch (err) {
    console.error("ارسال اکسپرت شکست خورد:", platform, err && err.message);
  }

  // پیام تازه و نه ویرایش پیام قبلی: این دکمه ممکن است از زیر یک ویدیو
  // زده شود، و تلگرام اجازه نمی‌دهد متنِ پیامِ ویدیویی ویرایش شود.
  if (delivered === 0) {
    await ctx.reply(
      `✅ درخواست شما برای اکسپرت هوشمند SsProX نسخه ${name} ثبت شد.\n\nتیم آکادمی به‌زودی فایل رو براتون می‌فرسته. 🙏`,
      { reply_markup: expertKeyboard() }
    );
  }
}

// --- دوره‌های رایگان (زیرمنو) ---

// شیء خام و نه سازنده‌ی InlineKeyboard: گرامی فیلد style را بی‌صدا دور
// می‌ریزد و دکمه‌ها بی‌رنگ می‌شوند.
//
// «آموزش رایگان» از هر دو برچسب برداشته شد: کاربر تازه از دکمه‌ی
// «دوره‌های رایگان» آمده و رایگان بودن را می‌داند؛ تکرارش فقط نام دوره
// را عقب می‌راند.
function freeCoursesKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📚 دوره مقدماتی", callback_data: "MENU_FREE_INTRO", style: "primary" }],
      [{ text: "🧠 دوره هوش هیجانی", callback_data: "MENU_FREE_EQ", style: "primary" }],
      [{ text: "🏠 منوی اصلی", callback_data: "MENU_MAIN" }],
    ],
  };
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
  // «واریز و برداشت» (INTRO_P15) از این فهرست برداشته شد و جایش در بخش
  // بروکر معتمد است. خودِ محتوا سر جایش مانده و از آنجا پخش می‌شود؛ فقط
  // دیگر یک جلسه‌ی دوره به حساب نمی‌آید.
  ["مسیر پیش رو", "INTRO_P16"],
];

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const fa = (n) => String(n).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

// جلسه‌ی آخر سبز، بقیه آبی.
//
// در فهرستی که همه‌ی دکمه‌هایش یک رنگ‌اند، رنگ هیچ چیزی نمی‌گوید. اینجا
// سبز یعنی «خط پایان» - همان جلسه‌ای که بعدش قدم بعدی پیشنهاد می‌شود.
//
// شماره از جای جلسه در فهرست ساخته می‌شود، نه از عددی که داخل عنوان
// نوشته شده باشد. اگر روزی جلسه‌ای اضافه یا جابه‌جا شود، شماره‌ها خودشان
// درست می‌مانند - وگرنه فهرستی می‌ماند که شماره‌هایش با ترتیب واقعی
// نمی‌خواند و کاربر فکر می‌کند جلسه‌ای را جا انداخته.
function introSessionsKeyboard() {
  const last = INTRO_SESSIONS.length - 1;
  return {
    inline_keyboard: [
      ...INTRO_SESSIONS.map(([label, id], i) => [
        {
          text: fa(i + 1) + ". " + label,
          callback_data: `CONTENT|${id}`,
          style: i === last ? "success" : "primary",
        },
      ]),
      [{ text: "🏠 منوی اصلی", callback_data: "MENU_MAIN" }],
    ],
  };
}

export async function sendFreeIntro(ctx) {
  await sendSection(ctx, "INTRO_COURSE", introSessionsKeyboard());
}

// قسمت ۳ سبز است و نه قسمت آخر: تست هوش هیجانی همراه همین قسمت می‌رود،
// و برچسبش هم همین را می‌گوید تا کاربر پیش از زدن بداند چه می‌گیرد.
function eqSessionsKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "قسمت ۱", callback_data: "CONTENT|EMOTIONAL_P01", style: "primary" }],
      [{ text: "قسمت ۲", callback_data: "CONTENT|EMOTIONAL_P02", style: "primary" }],
      [{ text: "قسمت ۳ (همراه با تست)", callback_data: "CONTENT|EMOTIONAL_P03", style: "success" }],
      [{ text: "قسمت ۴", callback_data: "CONTENT|EMOTIONAL_P04", style: "primary" }],
      [{ text: "🏠 منوی اصلی", callback_data: "MENU_MAIN" }],
    ],
  };
}

export async function sendFreeEq(ctx) {
  await sendSection(ctx, "EQ_INTRO", eqSessionsKeyboard());
}

// --- تحویل محتوا (فعلاً بدون فایل واقعی) ---

// یک قدم بعدی در پایان دوره‌ی مقدماتی، نه دو تا.
//
// پیش‌تر دکمه‌ی «آزمون تعیین سطح» هم اینجا بود و کاربری که تازه شانزده
// جلسه را تمام کرده - آماده‌ترین لحظه‌ی کل مسیر - بین دو راه می‌ماند و
// اغلب سراغ آزمون می‌رفت و برنمی‌گشت. حالا فقط یک دکمه هست و ابهامی
// نیست.
function introDoneKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🎓 مجموعه آموزشی پیشرفته", callback_data: "INTRO_REGISTER_ADVANCED", style: "success" }],
    ],
  };
}


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

  // تست، همراه قسمت ۳ می‌رود نه قسمت آخر: تا آن‌جا کاربر مفاهیم را
  // دیده و سنجیدن خودش معنی دارد، و قسمت ۴ بعدش با همان دیدِ تازه
  // خوانده می‌شود.
  if (contentId === "EMOTIONAL_P03") {
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
    const introDone = (await resolveSection(ctx.env, "INTRO_DONE")).text;
    // بدون parse_mode: این متن از /edit قابل ویرایش است و یک «<» در چیزی
    // که مدیر می‌نویسد، کل پیام را رد می‌کند.
    await ctx.reply(ack + introDone, {
      reply_markup: introDoneKeyboard(),
    });
    return;
  }

  // فایل رفت و دنباله‌ای هم ندارد: دیگر چیزی لازم نیست.
  if (delivered > 0) return;

  await ctx.reply(ackText);
}
