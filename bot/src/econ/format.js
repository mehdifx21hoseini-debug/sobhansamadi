// این توابع عیناً از نودهای Build Today/Week/Next Event Text در
// WF-Economic-Calendar آورده شده‌اند. هدف این است که متن ساخته‌شده در
// ورکر مو‌به‌مو همان چیزی باشد که کاربر قبلاً می‌دید؛ پس هیچ‌کدام
// «تمیزکاری» نشده‌اند.

export const RLM = "‏";

export const IMPORTANCE_EMOJI = { high: "🔴", medium: "🟡", low: "⚪" };
export const DAY_FA = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

const JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];
const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function isDstUS(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  const year = d.getUTCFullYear();
  let marchSecondSunday, count = 0;
  for (let day = 1; day <= 31; day++) {
    const dd = new Date(Date.UTC(year, 2, day));
    if (dd.getUTCDay() === 0) { count++; if (count === 2) { marchSecondSunday = dd; break; } }
  }
  let novFirstSunday;
  for (let day = 1; day <= 7; day++) {
    const dd = new Date(Date.UTC(year, 10, day));
    if (dd.getUTCDay() === 0) { novFirstSunday = dd; break; }
  }
  return d >= marchSecondSunday && d < novFirstSunday;
}

// `nextDaySuffix` جدا شده چون دو مصرف‌کننده دو نشانه‌ی متفاوت می‌خواهند:
// پیام تلگرام «(+۱ روز)» فارسی و خوانا می‌نویسد، ولی مینی‌اپ در یک سلول
// باریک کنار ساعت «+1» می‌گذارد - همان چیزی که نود Build MiniApp Data در
// n8n می‌فرستاد. محاسبه یکی است تا دو ساعت متفاوت از یک رویداد ساخته نشود.
export function etTimeToTehran(dateStr, timeStr, nextDaySuffix = " (+۱ روز)") {
  if (!timeStr) return "";
  const parts = String(timeStr).split(":").map(Number);
  const hh = parts[0], mm = parts[1];
  const offsetHours = isDstUS(dateStr) ? 7.5 : 8.5;
  let totalMin = hh * 60 + mm + offsetHours * 60;
  let dayShift = 0;
  while (totalMin >= 24 * 60) { totalMin -= 24 * 60; dayShift++; }
  const h2 = Math.floor(totalMin / 60);
  const m2 = totalMin % 60;
  return String(h2).padStart(2, "0") + ":" + String(m2).padStart(2, "0") + (dayShift > 0 ? nextDaySuffix : "");
}

export function etMinutesUntilNow(dateStr, timeStr) {
  const parts = String(timeStr).split(":").map(Number);
  const hh = parts[0], mm = parts[1];
  const offsetHours = isDstUS(dateStr) ? 4 : 5;
  const dateParts = String(dateStr).split("-").map(Number);
  const utcInstant = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], hh + offsetHours, mm));
  return Math.round((utcInstant.getTime() - Date.now()) / 60000);
}

// همان تبدیلی که etMinutesUntilNow انجام می‌دهد، ولی خودِ لحظه را
// برمی‌گرداند نه فاصله‌اش تا حالا. مینی‌اپ به این نیاز دارد چون
// شمارش معکوسش را سمت مرورگر و هر ثانیه یک‌بار حساب می‌کند، پس یک
// لحظه‌ی مطلق می‌خواهد نه عددی که در لحظه‌ی ساخت پاسخ منجمد شده.
export function etInstantIso(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const parts = String(timeStr).split(":").map(Number);
  if (!Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  const dateParts = String(dateStr).split("-").map(Number);
  if (dateParts.length !== 3 || dateParts.some((n) => !Number.isFinite(n))) return null;
  const offsetHours = isDstUS(dateStr) ? 4 : 5;
  const d = new Date(
    Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], parts[0] + offsetHours, parts[1])
  );
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function div(a, b) { return Math.floor(a / b); }

export function toJalali(gy, gm, gd) {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 365 * gy + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) - 80 + gd + g_d_m[gm - 1];
  jy += 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) { jy += div(days - 1, 365); days = (days - 1) % 365; }
  let jm, jd;
  if (days < 186) { jm = 1 + div(days, 31); jd = 1 + (days % 31); }
  else { jm = 7 + div(days - 186, 30); jd = 1 + ((days - 186) % 30); }
  return [jy, jm, jd];
}

export function toPersianDigits(str) {
  return String(str).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[d]);
}

export function formatJalaliDate(gregDateStr) {
  const [gy, gm, gd] = String(gregDateStr).split("-").map(Number);
  const [jy, jm, jd] = toJalali(gy, gm, gd);
  return toPersianDigits(jd) + " " + JALALI_MONTHS[jm - 1] + " " + toPersianDigits(jy);
}

export function formatCountdown(mins) {
  if (mins === null || mins <= 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const parts = [];
  if (h > 0) parts.push(toPersianDigits(h) + " ساعت");
  if (m > 0 || h === 0) parts.push(toPersianDigits(m) + " دقیقه");
  return "⏳ " + parts.join(" و ") + " دیگر";
}

export function statusBadge(status) {
  if (status === "released") return " ✅";
  if (status === "upcoming") return " 🕓";
  return "";
}

export function relativeTimeFa(isoStr) {
  const diffMin = Math.round((Date.now() - new Date(isoStr).getTime()) / 60000);
  if (diffMin < 1) return "همین الان";
  if (diffMin < 60) return toPersianDigits(diffMin) + " دقیقه پیش";
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return toPersianDigits(diffHour) + " ساعت پیش";
  const diffDay = Math.round(diffHour / 24);
  return toPersianDigits(diffDay) + " روز پیش";
}
