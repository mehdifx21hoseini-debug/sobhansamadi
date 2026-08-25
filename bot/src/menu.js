import { InlineKeyboard } from "grammy";

// TODO(فاز پورت منو): این دکمه‌ها موقتی هستند. به‌محض اینکه n8n پاسخ‌گو شد،
// دکمه‌ها و متن‌های دقیق منوی فعلی (WF اصلی بات) از آنجا خوانده و اینجا
// جایگزین می‌شوند تا رفتار با نسخه‌ی فعلی عیناً یکی باشد.
export function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text("📅 تقویم و سشن‌ها", "econ_calendar")
    .row()
    .text("🎓 منتورینگ اختصاصی", "mentoring")
    .row()
    .text("☎️ پشتیبانی", "support");
}
