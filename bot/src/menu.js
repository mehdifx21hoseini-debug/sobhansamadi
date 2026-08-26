import { Keyboard } from "grammy";

// این متن‌ها دقیقاً همان‌هایی هستند که در منطق واقعی بات (WF-01
// Telegram Main Router) به این عنوان‌ها نگاشته شده‌اند - از n8n
// استخراج شده، حدسی نیست. منوی اصلی یک کیبورد ثابت پایین صفحه است
// (Reply Keyboard)، نه دکمه‌ی شیشه‌ای زیر پیام.
export const MENU_LABELS = {
  LIBRARY: "🧠 کتاب‌های روانشناسی",
  FREE_COURSES: "🎓 دوره‌های رایگان",
  PSY_VOICES: "🎧 ویس‌های روانشناسی",
  EXPERT: "🤖 اکسپرت مدیریت سرمایه",
  ECON_CALENDAR: "📅 تقویم اقتصادی",
  LIVE_TRADE: "📈 ویدیوهای لایو ترید",
  CONSULT: "🚀 شرکت در مجموعه آموزشی پیشرفته",
  TRUSTED_BROKER: "🏦 بروکر معتمد",
  SUPPORT: "💬 پشتیبانی",
  ABOUT: "🏛 درباره آکادمی",
};

export function mainMenuKeyboard() {
  return new Keyboard()
    .text(MENU_LABELS.LIBRARY)
    .text(MENU_LABELS.FREE_COURSES)
    .row()
    .text(MENU_LABELS.PSY_VOICES)
    .text(MENU_LABELS.EXPERT)
    .row()
    .text(MENU_LABELS.ECON_CALENDAR)
    .text(MENU_LABELS.LIVE_TRADE)
    .row()
    .text(MENU_LABELS.CONSULT)
    .row()
    .text(MENU_LABELS.TRUSTED_BROKER)
    .text(MENU_LABELS.SUPPORT)
    .row()
    .text(MENU_LABELS.ABOUT)
    .resized();
}
