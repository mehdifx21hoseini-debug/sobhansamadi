// فهرست دستورهایی که تلگرام کنار کادر تایپ نشان می‌دهد.
//
// دو فهرست، نه یکی: تلگرام اجازه می‌دهد فهرست دستورها برای یک گفتگوی
// مشخص جدا تعریف شود. پس کاربر عادی فقط /start و /help را می‌بیند و
// مدیر، دستورهای مدیریتی را هم - بدون اینکه وجودشان برای بقیه لو برود.
//
// چرا مهم است: تا حالا /edit و /diag فقط در حافظه‌ی مدیر بودند. دستوری
// که باید یادت بماند، دستوری است که استفاده نمی‌شود.

export const PUBLIC_COMMANDS = [
  { command: "start", description: "منوی اصلی" },
  { command: "help", description: "راهنمای ربات" },
];

export const ADMIN_COMMANDS = [
  ...PUBLIC_COMMANDS,
  { command: "edit", description: "✏️ ویرایش متن و عکس بخش‌ها" },
  { command: "diag", description: "🔧 وضعیت ربات" },
  { command: "members", description: "👥 تعداد کاربران ربات" },
  { command: "kbsync", description: "🧠 ساختن پایگاه دانش دستیار" },
  { command: "kblist", description: "🧠 مدخل‌های پایگاه دانش" },
  { command: "kbadd", description: "🧠 افزودن پرسش و پاسخ" },
  { command: "aistats", description: "📊 کارکرد دستیار و سوال‌های بی‌جواب" },
  { command: "econsender", description: "🔔 کلید ارسال تقویم از ورکر" },
  { command: "delete", description: "🗑 حذف یک محتوا با شناسه" },
  { command: "resetchannel", description: "🔄 عوض کردن کانال محتوا" },
];

// چه گفتگوهایی فهرست مدیر را گرفته‌اند. فقط در حافظه‌ی همین isolate
// می‌ماند و با سرد شدنش پاک می‌شود - که ایرادی ندارد: تلگرام این
// فراخوانی را idempotent می‌داند و تکرارش فقط یک درخواست اضافه است،
// نه یک تغییر.
const registered = new Set();

/**
 * فهرست مدیریتی را برای گفتگوی همین مدیر ثبت می‌کند.
 *
 * چرا اینجا و نه یک‌بار موقع بالا آمدن ورکر: دسترسی مدیر می‌تواند با
 * نام کاربری باشد و آیدی عددی‌اش از قبل معلوم نباشد. اولین پیامی که
 * می‌فرستد، هم هویتش را می‌گوید هم شماره‌ی گفتگویش را.
 *
 * شکستش هیچ‌وقت نباید جلوی پردازش پیام را بگیرد - یک فهرست دستور، به
 * اندازه‌ی جواب ندادن به کاربر مهم نیست.
 */
export async function ensureAdminCommands(ctx) {
  const chatId = ctx.chat && ctx.chat.id;
  if (!chatId || ctx.chat.type !== "private") return;
  if (registered.has(chatId)) return;
  registered.add(chatId);

  try {
    await ctx.api.setMyCommands(ADMIN_COMMANDS, {
      scope: { type: "chat", chat_id: chatId },
    });
  } catch (err) {
    // اگر شکست خورد، دفعه‌ی بعد دوباره تلاش می‌شود.
    registered.delete(chatId);
    console.error("ثبت دستورهای مدیر شکست خورد:", err && err.message);
  }
}
