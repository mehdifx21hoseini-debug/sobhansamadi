import { InlineKeyboard } from "grammy";

// TODO(فاز پورت منو): این دکمه‌ها موقتی هستند. به‌محض اینکه n8n پاسخ‌گو شد
// یا متن دقیق منوی قبلی از یک اسکرین‌شات تایید شود، اینجا با نسخه‌ی
// نهایی جایگزین می‌شود.
export function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text("📅 تقویم و سشن‌ها", "econ_calendar")
    .row()
    .text("🎓 منتورینگ اختصاصی", "mentoring")
    .row()
    .text("☎️ پشتیبانی", "support");
}
