// نام فارسی تعطیلات آمریکا.
//
// چرا اینجا و نه در پایگاه داده: منبعِ تعطیلات (date.nager.at) فقط نام
// انگلیسی می‌دهد و ستون name_fa همیشه خالی می‌ماند. تا امروز کاربر
// «Labor Day» می‌دید و نمی‌فهمید چه خبر است. این فهرست کوتاه و ثابت
// است - تعطیلات فدرال آمریکا سالی یک‌بار عوض نمی‌شوند - پس نگه داشتنش
// در کد از نگه داشتنش در یک جدول ساده‌تر و قابل‌اعتمادتر است.
//
// تطبیق روی متنِ نرمال‌شده انجام می‌شود نه تساویِ دقیق: منبع گاهی
// «Washington's Birthday» می‌دهد و گاهی «Presidents' Day»، و آپاستروف
// هم گاهی مستقیم است و گاهی فرفری.
const NAMES = [
  [/new year/i, "روز اول سال میلادی"],
  [/martin luther king/i, "روز مارتین لوتر کینگ"],
  [/washington.*birthday|presidents/i, "روز رؤسای جمهور"],
  [/good friday/i, "جمعه‌ی نیک"],
  [/memorial day/i, "روز یادبود"],
  [/juneteenth/i, "روز پایان برده‌داری"],
  [/independence day/i, "روز استقلال آمریکا"],
  [/labou?r day/i, "روز کارگر"],
  [/columbus|indigenous peoples/i, "روز کریستف کلمب"],
  [/veterans day/i, "روز کهنه‌سربازان"],
  [/thanksgiving/i, "روز شکرگزاری"],
  [/christmas/i, "کریسمس"],
];

/**
 * نام فارسی یک تعطیلی.
 *
 * اگر ستونِ name_fa پر بود همان برمی‌گردد - آکادمی باید بتواند نامی را
 * دستی اصلاح کند و آن اصلاح نباید با این فهرست بازنویسی شود.
 *
 * @returns {string} رشته‌ی خالی یعنی نمی‌شناسیمش؛ صداکننده باید همان نام
 *   انگلیسی را نشان بدهد، نه یک جای خالی.
 */
export function holidayNameFa(holiday) {
  if (!holiday) return "";
  const stored = String(holiday.name_fa || "").trim();
  if (stored) return stored;
  const en = String(holiday.name || "");
  for (const [pattern, fa] of NAMES) {
    if (pattern.test(en)) return fa;
  }
  return "";
}

/** «روز کارگر (Labor Day)» - و اگر فارسی‌اش را نداشتیم، فقط انگلیسی. */
export function holidayLabel(holiday) {
  const fa = holidayNameFa(holiday);
  const en = String((holiday && holiday.name) || "").trim();
  if (fa && en) return fa + " (" + en + ")";
  return fa || en;
}
