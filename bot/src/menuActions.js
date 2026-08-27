import { logContentRequest } from "./db.js";

export { sendEconMenu as sendEconCalendar, handleEconCallback } from "./econ/index.js";

// بخش‌هایی که هنوز فایل واقعی‌شان از آکادمی گرفته نشده. به‌جای یک پیام
// بن‌بست، درخواست در جدول content_requests ثبت می‌شود؛ این‌طور آکادمی در
// CRM می‌بیند چند نفر منتظر کدام بخش‌اند و اولویت تولید محتوا روشن است.
const PENDING_SECTIONS = {
  PSY_VOICES: {
    id: "PSY_VOICES",
    title: "🎧 ویس‌های روانشناسی",
    body: "این بخش هنوز در حال آماده‌سازیه.",
  },
  LIVE_TRADE: {
    id: "LIVE_TRADE",
    title: "📈 ویدیوهای لایو ترید",
    body: "ویدیوهای لایو معاملات هنوز در حال آماده‌سازیه.",
  },
};

export async function sendPendingSection(ctx, key) {
  const section = PENDING_SECTIONS[key];
  if (!section) return;

  // اگر ثبت درخواست به هر دلیلی شکست بخورد، کاربر نباید پیام خطا ببیند —
  // برای او فرقی ندارد و پیام اصلی باید در هر حالت برسد.
  await logContentRequest(ctx.env, ctx.from.id, ctx.from.username, section.id).catch(() => {});

  await ctx.reply(
    `${section.title}\n\n${section.body}\n\n` +
      "✅ درخواست شما ثبت شد؛ به‌محض آماده شدن، همین‌جا براتون می‌فرستیم. 🙏"
  );
}
