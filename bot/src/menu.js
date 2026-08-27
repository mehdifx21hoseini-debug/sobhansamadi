// این منو عیناً همان چیزی است که در نسخه‌ی n8n (نود Send Main Menu در
// WF-01) به تلگرام فرستاده می‌شد - متن دکمه‌ها، ترتیب سطرها، رنگ‌ها و
// آیدی ایموجی‌های پرمیوم از همان‌جا برداشته شده، حدسی نیست.
//
// دو فیلد `style` و `icon_custom_emoji_id` در سازنده‌ی Keyboard گرامی
// وجود ندارند، برای همین reply_markup را دستی می‌سازیم و خام می‌فرستیم؛
// نسخه‌ی قبلی هم دقیقاً به همین دلیل به‌جای نود تلگرام از httpRequest
// استفاده می‌کرد.
export const MENU_LABELS = {
  LIBRARY: "🧠 کتاب‌های روانشناسی",
  FREE_COURSES: "🎓 دوره‌های رایگان",
  PSY_VOICES: "🎧 ویس‌های روانشناسی",
  EXPERT: "🤖 اکسپرت مدیریت سرمایه",
  // این سه دکمه در نسخه‌ی واقعی هیچ ایموجی یونیکدی در متنشان ندارند؛
  // آیکون‌شان از ایموجی پرمیوم می‌آید.
  ECON_CALENDAR: "تقویم اقتصادی",
  LIVE_TRADE: "ویدیوهای لایو ترید",
  CONSULT: "شرکت در مجموعه آموزشی پیشرفته",
  TRUSTED_BROKER: "🏦 بروکر معتمد",
  SUPPORT: "💬 پشتیبانی",
  ABOUT: "🏛 درباره آکادمی",
  CONTACT: "📞 تماس با ما",
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

export function mainMenuKeyboard() {
  return {
    keyboard: [
      [btn(MENU_LABELS.LIBRARY, "primary"), btn(MENU_LABELS.FREE_COURSES, "primary")],
      [btn(MENU_LABELS.PSY_VOICES, "primary"), btn(MENU_LABELS.EXPERT, "primary")],
      [
        btn(MENU_LABELS.ECON_CALENDAR, "primary", ICON.ECON_CALENDAR),
        btn(MENU_LABELS.LIVE_TRADE, "primary", ICON.LIVE_TRADE),
      ],
      [btn(MENU_LABELS.CONSULT, "success", ICON.CONSULT)],
      [btn(MENU_LABELS.TRUSTED_BROKER, "primary"), btn(MENU_LABELS.SUPPORT, "primary")],
      [btn(MENU_LABELS.ABOUT, "primary"), btn(MENU_LABELS.CONTACT, "primary")],
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
  "📈 ویدیوهای لایو ترید": "LIVE_TRADE",
  "🚀 شرکت در مجموعه آموزشی پیشرفته": "CONSULT",
  // نسخه‌ی 💜 که چند دقیقه روی هوا بود. کیبورد تلگرام سمت کاربر کش می‌شود،
  // پس هرکس در همان بازه /start زده باشد هنوز همین را می‌فرستد و بدون این
  // ردیف دکمه‌اش بی‌جواب می‌ماند.
  "💜 درباره آکادمی": "ABOUT",
};

// تنها جایی که متن ورودی به کنش منو نگاشته می‌شود. هم متن فعلی و هم
// متن قدیمی را می‌پذیرد و اگر هیچ‌کدام نبود null برمی‌گرداند.
export function resolveMenuAction(text) {
  for (const [key, label] of Object.entries(MENU_LABELS)) {
    if (label === text) return key;
  }
  return LEGACY_LABELS[text] || null;
}
