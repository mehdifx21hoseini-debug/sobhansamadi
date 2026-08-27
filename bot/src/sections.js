// زیرمنوهای سطح دوم.
//
// منوی اصلی به ۱۱ دکمه در ۶ ردیف رسیده بود و چون کیبورد ریپلای همیشه روی
// صفحه می‌ماند، نصف نمایشگر را می‌گرفت. سه دسته‌ی زیر آن را به ۶ دکمه در
// ۴ ردیف رساندند.
//
// این‌ها عمداً کیبورد inline هستند نه ریپلای: کیبورد ریپلای اگر عوض شود
// جای منوی اصلی را می‌گیرد و کاربر باید راه برگشت پیدا کند. با inline
// منوی اصلی همیشه سر جایش می‌ماند و زیرمنو فقط یک پیام است.

const LEARN_TEXT = [
  "🎓 آموزش‌ها",
  "",
  "همه‌ی محتوای آموزشی آکادمی در یک جا. یکی را انتخاب کنید:",
].join("\n");

const TOOLS_TEXT = [
  "🧰 ابزارها",
  "",
  "ابزارهایی که در مسیر معامله‌گری کنارتان هستند:",
].join("\n");

const ABOUT_US_TEXT = [
  "ℹ️ درباره ما",
  "",
  "برای شناخت بیشتر آکادمی یا ارتباط مستقیم با ما:",
].join("\n");

export async function sendLearnMenu(ctx) {
  await ctx.reply(LEARN_TEXT, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🎓 دوره‌های رایگان", callback_data: "SEC_FREE_COURSES", style: "primary" },
          { text: "🧠 کتاب‌های روانشناسی", callback_data: "SEC_LIBRARY", style: "primary" },
        ],
        [
          { text: "🎧 ویس‌های روانشناسی", callback_data: "SEC_PSY_VOICES", style: "primary" },
          { text: "📈 ویدیوهای لایو ترید", callback_data: "SEC_LIVE_TRADE", style: "primary" },
        ],
      ],
    },
  });
}

export async function sendToolsMenu(ctx) {
  await ctx.reply(TOOLS_TEXT, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🤖 اکسپرت مدیریت سرمایه", callback_data: "SEC_EXPERT", style: "primary" }],
        [{ text: "🏦 بروکر معتمد", callback_data: "SEC_BROKER", style: "primary" }],
      ],
    },
  });
}

export async function sendAboutUsMenu(ctx) {
  await ctx.reply(ABOUT_US_TEXT, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🏛 درباره آکادمی", callback_data: "SEC_ABOUT", style: "primary" },
          { text: "📞 تماس با ما", callback_data: "SEC_CONTACT", style: "primary" },
        ],
      ],
    },
  });
}
