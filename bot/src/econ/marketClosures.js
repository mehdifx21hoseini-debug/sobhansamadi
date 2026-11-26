// Verified against WM Markets' holiday and daylight-saving tables on 2026-11-26.
// https://en.wmmarkets.com/market-holiday/
// https://en.wmmarkets.com/products/ (winter server time UTC+2)
const SOURCE = "https://fa.wmmarkets.com/market-holiday/";
const RLM = "\u200f";
export const MARKET_CLOSE_APPROVAL_FLAG = "early_close_20261127_approved";
export const EARLY_CLOSE_DATE = "2026-11-27";
export const SERVER_UTC_OFFSET_MINUTES = 120;
export const EARLY_CLOSES = [
  { name: "داوجونز (Dow Jones / US30CASH)", serverTime: "20:12" },
  { name: "طلا (XAU)", serverTime: "21:45" },
];

export function closeTimeInTehran(serverTime) {
  const instant = new Date(EARLY_CLOSE_DATE + "T" + serverTime + ":00Z");
  instant.setUTCMinutes(instant.getUTCMinutes() - SERVER_UTC_OFFSET_MINUTES);
  return new Intl.DateTimeFormat("fa-IR", {
    timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(instant);
}

// The caller supplies the Tehran calendar date. No "tomorrow" text or recurrence.
export function marketCloseNotice(dateIso) {
  if (dateIso !== EARLY_CLOSE_DATE) return "";
  return [
    "### " + RLM + "⚠️ امروز طلا و داوجونز زودتر بسته می‌شوند (Early Close)",
    RLM + "امروز جمعه ۶ آذر (۲۷ نوامبر)، به‌دلیل تغییر ساعت معاملات در روز پس از تعطیلات شکرگزاری آمریکا، زمان بسته‌شدن این نمادها در بروکر معتمد زودتر است:",
    ...EARLY_CLOSES.map((item) => RLM + "🔹 **" + item.name + ":**\n" + RLM + "**" + closeTimeInTehran(item.serverTime) + " به وقت ایران — " + item.serverTime.replace(/[0-9]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]) + " به وقت بروکر**"),
    RLM + "**جفت‌ارزهای فارکس ساعات عادی دارند؛ کل بازار تعطیل نیست.**",
    RLM + "[منبع: برنامه تعطیلات بروکر معتمد](" + SOURCE + ")",
  ].join("\n\n");
}
