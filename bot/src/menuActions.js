import { InlineKeyboard } from "grammy";

const ECON_APP_URL = "https://mehdifx21hoseini-debug.github.io/sobhansamadi/econ-app.html?v=26";

const ABOUT_TEXT = [
  "🏛 درباره آکادمی سبحان صمدی",
  "",
  "من سبحان صمدی هستم؛ بیش از ۸ سال به‌صورت تخصصی در بازارهای مالی فعالیت می‌کنم و تنها کسی هستم که در ایران هر روز لایو تریدهای واقعی خودم رو با مخاطبانم به اشتراک می‌ذارم.",
].join("\n");

// TODO: این پیام موقتی است. باید یا محتوای واقعی (فایل/لینک) این بخش
// از صاحب آکادمی گرفته شود، یا اگر قرار است پیام کاربر به تیم پشتیبانی
// فوروارد شود، آن منطق (شبیه admin_reply_forward نسخه‌ی قبلی) ساخته شود.
function comingSoon(topic) {
  return `${topic}\n\nاین بخش به‌زودی با محتوای واقعی تکمیل می‌شه. 🙏`;
}

export async function sendEconCalendar(ctx) {
  await ctx.reply("📅 تقویم اقتصادی زنده رو از اینجا باز کن:", {
    reply_markup: new InlineKeyboard().webApp("📅 باز کردن تقویم", ECON_APP_URL),
  });
}

export async function sendAbout(ctx) {
  await ctx.reply(ABOUT_TEXT);
}

export async function sendSupportPlaceholder(ctx) {
  await ctx.reply("💬 پیامتون رو همین‌جا بنویسید، به‌زودی تیم پشتیبانی جواب می‌ده.");
}

export async function sendLibraryPlaceholder(ctx) {
  await ctx.reply(comingSoon("🧠 کتاب‌های روانشناسی"));
}

export async function sendFreeCoursesPlaceholder(ctx) {
  await ctx.reply(comingSoon("🎓 دوره‌های رایگان"));
}

export async function sendPsyVoicesPlaceholder(ctx) {
  await ctx.reply(comingSoon("🎧 ویس‌های روانشناسی"));
}

export async function sendExpertPlaceholder(ctx) {
  await ctx.reply(comingSoon("🤖 اکسپرت مدیریت سرمایه"));
}

export async function sendLiveTradePlaceholder(ctx) {
  await ctx.reply(comingSoon("📈 ویدیوهای لایو ترید"));
}

export async function sendConsultPlaceholder(ctx) {
  await ctx.reply(comingSoon("🚀 شرکت در مجموعه آموزشی پیشرفته"));
}

export async function sendTrustedBrokerPlaceholder(ctx) {
  await ctx.reply(comingSoon("🏦 بروکر معتمد"));
}
