// این منو عیناً همان چیزی است که در نسخه‌ی n8n (نود Send Main Menu در
// WF-01) به تلگرام فرستاده می‌شد - متن دکمه‌ها، ترتیب سطرها، رنگ‌ها و
// آیدی ایموجی‌های پرمیوم از همان‌جا برداشته شده، حدسی نیست.
//
// دو فیلد `style` و `icon_custom_emoji_id` در سازنده‌ی Keyboard گرامی
// وجود ندارند، برای همین reply_markup را دستی می‌سازیم و خام می‌فرستیم؛
// نسخه‌ی قبلی هم دقیقاً به همین دلیل به‌جای نود تلگرام از httpRequest
// استفاده می‌کرد.
export const MENU_LABELS = {
  // این دو دکمه هیچ ایموجی یونیکدی در متنشان ندارند؛ آیکون‌شان از ایموجی
  // پرمیوم می‌آید.
  ECON_CALENDAR: "تقویم اقتصادی",
  CONSULT: "شرکت در مجموعه آموزشی پیشرفته",

  LEARN: "🎓 آموزش‌ها",
  TOOLS: "🧰 ابزارها",
  SUPPORT: "💬 پشتیبانی",
  ABOUT_US: "ℹ️ درباره ما",
};

// آیدی ایموجی‌های پرمیوم، از همان نود Send Main Menu.
const ICON = {
  ECON_CALENDAR: "5274055917766202507",
  LIVE_TRADE: "5197503331215361533",
  CONSULT: "5195033767969839232",
};

function btn(text, style, iconId) {
  const b = { text, style };
  if (iconId) b.icon_custom_emoji_id = iconId;
  return b;
}

// سطح اول فقط سه چیز را نگه می‌دارد: چیزی که روزانه استفاده می‌شود
// (تقویم)، چیزی که درآمد می‌سازد (ثبت‌نام)، و چیزی که فوری است
// (پشتیبانی). بقیه پشت سه دسته رفتند. نتیجه: ۱۱ دکمه در ۶ ردیف شد ۶ دکمه
// در ۴ ردیف، و چون کیبورد ریپلای همیشه روی صفحه است، همین یعنی دو ردیف
// بیشتر از چت دیده می‌شود.
export function mainMenuKeyboard() {
  return {
    keyboard: [
      [
        btn(MENU_LABELS.ECON_CALENDAR, "primary", ICON.ECON_CALENDAR),
        btn(MENU_LABELS.LEARN, "primary"),
      ],
      [btn(MENU_LABELS.TOOLS, "primary"), btn(MENU_LABELS.SUPPORT, "primary")],
      // تنها دکمه‌ای که مستقیم درآمد می‌سازد: تنها، تمام‌عرض و سبز.
      [btn(MENU_LABELS.CONSULT, "success", ICON.CONSULT)],
      [btn(MENU_LABELS.ABOUT_US, "primary")],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

// کیبورد قبلی روی گوشی کاربرانی که هنوز پیام تازه‌ای نگرفته‌اند باقی
// می‌ماند، و آن نسخه روی این سه دکمه ایموجی یونیکد داشت. تا وقتی همه
// کیبورد تازه را بگیرند، متن قدیمی هم باید شناخته شود وگرنه ضربه‌شان
// بی‌جواب می‌ماند.
const LEGACY_LABELS = {
  "📅 تقویم اقتصادی": "ECON_CALENDAR",
  "🚀 شرکت در مجموعه آموزشی پیشرفته": "CONSULT",

  // دکمه‌هایی که از سطح اول به زیرمنوها رفتند. کیبورد تلگرام سمت کاربر کش
  // می‌شود، پس تا وقتی همه یک‌بار /start نزده‌اند این متن‌ها هنوز فرستاده
  // می‌شوند و باید مثل قبل کار کنند - وگرنه ضربه‌شان بی‌جواب می‌ماند.
  "🧠 کتاب‌های روانشناسی": "LIBRARY",
  "🎓 دوره‌های رایگان": "FREE_COURSES",
  "🎧 ویس‌های روانشناسی": "PSY_VOICES",
  "🤖 اکسپرت مدیریت سرمایه": "EXPERT",
  "ویدیوهای لایو ترید": "LIVE_TRADE",
  "📈 ویدیوهای لایو ترید": "LIVE_TRADE",
  "🏦 بروکر معتمد": "TRUSTED_BROKER",
  "🏛 درباره آکادمی": "ABOUT",
  "💜 درباره آکادمی": "ABOUT",
  "📞 تماس با ما": "CONTACT",
};

// تنها جایی که متن ورودی به کنش منو نگاشته می‌شود. هم متن فعلی و هم
// متن قدیمی را می‌پذیرد و اگر هیچ‌کدام نبود null برمی‌گرداند.
export function resolveMenuAction(text) {
  for (const [key, label] of Object.entries(MENU_LABELS)) {
    if (label === text) return key;
  }
  return LEGACY_LABELS[text] || null;
}
