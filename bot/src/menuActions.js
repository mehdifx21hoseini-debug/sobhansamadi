import { logContentRequest } from "./db.js";
import { listContentByPrefix } from "./content/store.js";
import { deliverContent } from "./content/deliver.js";

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

  // ویس‌های روانشناسی کد ثابت ندارند؛ هر پست کانال یک مدخل تازه با پیشوند
  // PSY_VOICE_ می‌سازد. پس اگر چیزی رسیده باشد، همه‌اش فرستاده می‌شود و
  // این بخش دیگر «در حال آماده‌سازی» نیست.
  if (key === "PSY_VOICES") {
    const voices = await listContentByPrefix(ctx.env, "PSY_VOICE_").catch(() => []);
    if (voices.length > 0) {
      await ctx.reply(`${section.title}\n\n${voices.length} مورد برای شما ارسال می‌شود 👇`);
      for (const v of voices) {
        await deliverContent(ctx, v.content_id).catch((err) =>
          console.error("ارسال ویس شکست خورد:", v.content_id, err && err.message)
        );
      }
      return;
    }
  }

  // اگر ثبت درخواست به هر دلیلی شکست بخورد، کاربر نباید پیام خطا ببیند —
  // برای او فرقی ندارد و پیام اصلی باید در هر حالت برسد.
  await logContentRequest(ctx.env, ctx.from.id, ctx.from.username, section.id).catch(() => {});

  await ctx.reply(
    `${section.title}\n\n${section.body}\n\n` +
      "✅ درخواست شما ثبت شد؛ به‌محض آماده شدن، همین‌جا براتون می‌فرستیم. 🙏"
  );
}
