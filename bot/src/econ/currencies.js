// ارزهای تقویم اقتصادی.
//
// ForexFactory رویدادها را با کدِ ارز می‌دهد و تا امروز هر چیزی که دلار
// نبود همان لحظه دور ریخته می‌شد. حالا همه نگه داشته می‌شوند و کاربر
// خودش انتخاب می‌کند چه ببیند.
//
// طلا و نفت عمداً گزینه‌ی جدا ندارند: فارکس‌فکتوری برایشان رویدادِ
// مستقل نمی‌دهد و هر دو با داده‌ی دلار حرکت می‌کنند. یک دکمه‌ی «طلا» که
// پشتش همان خبرهای دلار باشد، به کاربر چیزی می‌گوید که راست نیست.

export const CURRENCIES = [
  { code: "USD", flag: "🇺🇸", fa: "دلار آمریکا" },
  { code: "EUR", flag: "🇪🇺", fa: "یورو" },
  { code: "GBP", flag: "🇬🇧", fa: "پوند انگلیس" },
  { code: "JPY", flag: "🇯🇵", fa: "ین ژاپن" },
  { code: "AUD", flag: "🇦🇺", fa: "دلار استرالیا" },
  { code: "CAD", flag: "🇨🇦", fa: "دلار کانادا" },
  { code: "NZD", flag: "🇳🇿", fa: "دلار نیوزیلند" },
  { code: "CHF", flag: "🇨🇭", fa: "فرانک سوئیس" },
];

// یوان چین عمداً نیست.
//
// فارکس‌فکتوری داده‌اش را می‌دهد، ولی جفت‌ارزهای یوان در بروکرهای
// معمولی معامله نمی‌شوند و هیچ‌کدام از مخاطبان ما رویشان کار نمی‌کنند.
// نگه داشتنش فقط یک دکمه‌ی اضافه در صفحه و ردیف‌های اضافه در جدول بود.
// هر ردیفی که با کد CNY در فید بیاید، همان‌جا رد می‌شود.

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

/**
 * ارزهایی که در جدول ذخیره می‌شوند.
 *
 * «All» جزو فهرستِ انتخاب نیست ولی همیشه ذخیره و همیشه نشان داده
 * می‌شود: فارکس‌فکتوری جکسون‌هول و نشست‌های G7/G20 را با همین برچسب
 * می‌زند و آن‌ها هر جفت‌ارزی را تکان می‌دهند. یک بار حذفشان باعث شد
 * بزرگ‌ترین رویدادِ هفته اصلاً در تقویم نیاید.
 */
export function isStorableCurrency(code) {
  const c = String(code || "").trim();
  return c === "All" || BY_CODE.has(c);
}

export function currencyFlag(code) {
  const c = BY_CODE.get(String(code || "").trim());
  return c ? c.flag : "🌐";
}

export function currencyFa(code) {
  const c = BY_CODE.get(String(code || "").trim());
  if (c) return c.fa;
  // «All» یعنی رویدادی که به یک ارز خاص وصل نیست.
  return String(code || "").trim() === "All" ? "رویدادهای جهانی" : String(code || "");
}

/** «🇺🇸 دلار آمریکا» */
export function currencyLabel(code) {
  return currencyFlag(code) + " " + currencyFa(code);
}

// پیش‌فرضِ همه، از جمله کاربرانِ فعلی: فقط دلار.
//
// این عمدی است. روزی که چند ارزی روشن شد، یازده هزار نفر نباید هیچ
// تغییری حس کنند؛ هر کس خودش بقیه را اضافه می‌کند.
export const DEFAULT_CURRENCIES = ["USD"];

/**
 * رشته‌ی ذخیره‌شده را به فهرست تبدیل می‌کند.
 *
 * خالی یا نامعتبر یعنی پیش‌فرض - نه «هیچ». کاربری که هیچ ارزی نبیند،
 * یک نمای خالی می‌گیرد و فکر می‌کند ربات خراب است.
 */
export function parseCurrencies(raw) {
  const list = String(raw || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => BY_CODE.has(s));
  const uniq = [...new Set(list)];
  return uniq.length ? uniq : [...DEFAULT_CURRENCIES];
}

export function serializeCurrencies(list) {
  const clean = (Array.isArray(list) ? list : [])
    .map((s) => String(s || "").trim().toUpperCase())
    .filter((s) => BY_CODE.has(s));
  const uniq = [...new Set(clean)];
  return (uniq.length ? uniq : DEFAULT_CURRENCIES).join(",");
}

/** روشن/خاموش کردنِ یک ارز، با نگه داشتنِ ترتیبِ فهرستِ اصلی. */
export function toggleCurrency(current, code) {
  const c = String(code || "").trim().toUpperCase();
  if (!BY_CODE.has(c)) return [...current];
  const set = new Set(current);
  if (set.has(c)) set.delete(c);
  else set.add(c);
  // آخرین ارز خاموش نمی‌شود: نمای خالی از نمای پر بدتر است و کاربر
  // فکر می‌کند چیزی شکسته.
  if (set.size === 0) return [...current];
  return CURRENCIES.map((x) => x.code).filter((x) => set.has(x));
}

/**
 * فیلترِ رویدادها بر اساس انتخابِ کاربر.
 *
 * رویدادهای «All» همیشه می‌مانند - به هیچ ارزی وصل نیستند و همه را
 * تکان می‌دهند.
 */
export function filterByCurrencies(events, selected) {
  const set = new Set(selected && selected.length ? selected : DEFAULT_CURRENCIES);
  return (events || []).filter((e) => {
    const c = String((e && e.currency) || "").trim();
    // ردیف‌های قدیمی که پیش از ذخیره‌ی ارز نوشته شده‌اند، دلار بودند.
    if (!c) return set.has("USD");
    return c === "All" || set.has(c);
  });
}
