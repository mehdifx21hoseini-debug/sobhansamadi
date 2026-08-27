import {
  RLM,
  IMPORTANCE_EMOJI,
  DAY_FA,
  etTimeToTehran,
  etMinutesUntilNow,
  formatJalaliDate,
  formatCountdown,
  statusBadge,
  relativeTimeFa,
  toPersianDigits,
} from "./format.js";

// متن‌های زیر عیناً همان چیزی را می‌سازند که نودهای Build Today Text،
// Build Week Text و Build Next Event Text در n8n می‌ساختند - فقط منبع
// داده از جدول‌های n8n به آینه‌ی D1 عوض شده. فرمت پیام دست‌نخورده است تا
// کاربر تفاوتی حس نکند.

// نسخه‌ی n8n فقط ستون‌های text را می‌فرستاد؛ نسخه‌ی markdown آن برای
// پیام‌های Rich بود که این منو استفاده‌شان نمی‌کرد، پس پورت نشده.

export function buildTodayText(events) {
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  const todays = events
    .filter((e) => e.date === today && e.importance !== "low")
    .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));

  let text = RLM + "🇺🇸 اخبار مهم اقتصادی امروز (دلار)\n" + RLM + "📅 " + formatJalaliDate(today) + "\n\n";

  if (todays.length === 0) {
    text += RLM + "امروز رویداد مهم اقتصادی ثبت‌شده‌ای برای دلار در منبع فعلی وجود ندارد.\n\n";
  } else {
    for (const e of todays) {
      const emoji = IMPORTANCE_EMOJI[e.importance] || "⚪";
      const timeTehran = e.time ? etTimeToTehran(e.date, e.time) : "";
      text += RLM + emoji + " " + e.event_fa + statusBadge(e.status) + "\n";
      if (timeTehran) text += RLM + "⏰ " + timeTehran + " (به وقت تهران)\n";
      const countdown = e.time ? formatCountdown(etMinutesUntilNow(e.date, e.time)) : "";
      if (countdown) text += RLM + countdown + "\n";
      if (e.forecast || e.previous || e.actual) {
        text += RLM + "پیش‌بینی: " + (e.forecast || "-") + "\n";
        text += RLM + "قبلی: " + (e.previous || "-") + "\n";
        text += RLM + "واقعی: " + (e.actual || (e.status === "upcoming" ? "منتشر نشده" : "-")) + "\n";
      }
      text += RLM + "منبع: " + e.source + "\n\n";
    }
  }

  const lastUpdated = todays.length > 0 ? todays[0].last_updated : nowIso;
  text += RLM + "ℹ️ آخرین بروزرسانی: " + relativeTimeFa(lastUpdated);
  return text;
}

export function buildWeekText(events) {
  const today = new Date().toISOString().slice(0, 10);
  const todayD = new Date(today + "T00:00:00Z");
  const weekEnd = new Date(todayD.getTime() + 7 * 86400000);
  const inRange = (dateStr) => {
    const d = new Date(dateStr + "T00:00:00Z");
    return d >= todayD && d <= weekEnd;
  };

  const weekEvents = events
    .filter((e) => e.date && inRange(e.date) && e.importance !== "low")
    .sort((a, b) => (a.date + (a.time || "99:99")).localeCompare(b.date + (b.time || "99:99")));

  let text = RLM + "📆 تقویم اقتصادی این هفته (دلار)\n\n";

  if (weekEvents.length === 0) {
    text += RLM + "رویداد مهم ثبت‌شده‌ای برای این هفته در منبع فعلی وجود ندارد.";
    return text;
  }

  let lastDate = "";
  for (const e of weekEvents) {
    if (e.date !== lastDate) {
      if (lastDate !== "") text += "\n";
      const d = new Date(e.date + "T00:00:00Z");
      text += RLM + "📅 " + DAY_FA[d.getUTCDay()] + " " + formatJalaliDate(e.date) + "\n\n";
      lastDate = e.date;
    }
    const emoji = IMPORTANCE_EMOJI[e.importance] || "⚪";
    const timeTehran = e.time ? etTimeToTehran(e.date, e.time) : "";
    text += RLM + emoji + " " + e.event_fa + statusBadge(e.status) + "\n";
    if (timeTehran) text += RLM + "⏰ " + timeTehran + " (به وقت تهران)\n";
    if (e.forecast || e.previous || e.actual) {
      text += RLM + "پیش‌بینی: " + (e.forecast || "-") + "\n";
      text += RLM + "قبلی: " + (e.previous || "-") + "\n";
      text += RLM + "واقعی: " + (e.actual || (e.status === "upcoming" ? "منتشر نشده" : "-")) + "\n";
    }
    text += RLM + "منبع: " + e.source + "\n\n";
  }
  text += RLM + "⏰ زمان‌ها به وقت تهران هستن.";
  return text;
}

export function buildNextEventText(events) {
  const today = new Date().toISOString().slice(0, 10);

  // این نما فقط high/medium را نشان می‌دهد و برخلاف دو نمای دیگر، برای
  // low هیچ ایموجی پیش‌فرضی ندارد - این تفاوت در نسخه‌ی n8n هم بود.
  const NEXT_EMOJI = { high: "🔴", medium: "🟡" };

  const upcoming = events
    .filter((e) => e.date && e.importance !== "low" && e.status !== "released" && e.date >= today)
    .sort((a, b) =>
      (a.date + "_" + (a.time || "99:99")).localeCompare(b.date + "_" + (b.time || "99:99"))
    );

  let text = RLM + "⏭ رویداد بعدی اقتصادی دلار\n\n";

  if (upcoming.length === 0) {
    text += RLM + "در حال حاضر رویداد مهم آتی برای دلار در منبع فعلی ثبت نشده است.";
    return text;
  }

  const e = upcoming[0];
  const emoji = NEXT_EMOJI[e.importance] || "⚪";
  const timeTehran = e.time ? etTimeToTehran(e.date, e.time) : "";
  text += RLM + emoji + " " + e.event_fa + "\n";
  text += RLM + "📅 " + formatJalaliDate(e.date) + "\n";
  if (timeTehran) text += RLM + "⏰ " + timeTehran + " (به وقت تهران)\n";
  const countdown = e.time ? formatCountdown(etMinutesUntilNow(e.date, e.time)) : "";
  if (countdown) text += RLM + countdown + "\n";
  if (e.forecast || e.previous) {
    text += "\n" + RLM + "پیش‌بینی: " + (e.forecast || "-") + "\n";
    text += RLM + "قبلی: " + (e.previous || "-") + "\n";
  }
  if (upcoming.length > 1) {
    text += "\n" + RLM + "➕ " + toPersianDigits(upcoming.length - 1) + " رویداد دیگر در صف انتظار است.";
  }
  return text;
}

export function buildAlertSettingsText(sub) {
  const subscribed = sub.subscribed === true;
  const showMedium = sub.show_low_importance === true;
  const minutes = sub.alert_minutes || 15;

  return (
    "🔔 هشدار اخبار اقتصادی\n\n" +
    "با فعال کردن هشدار، سه چیز برات فرستاده می‌شه:\n\n" +
    "⏰ چند دقیقه قبل از هر خبر مهم — یادآوری\n" +
    "📊 بلافاصله بعد از انتشار — عدد واقعی\n" +
    "📰 هر روز صبح — خلاصه اخبار روز\n\n" +
    "می‌تونی فقط اخبار خیلی مهم رو بگیری یا اخبار متوسط رو هم اضافه کنی، و انتخاب کنی چند دقیقه قبل بهت خبر بدم.\n\n" +
    "وضعیت فعلی:\n" +
    (subscribed ? "✅" : "❌") + " هشدار اخبار خیلی مهم\n" +
    (showMedium ? "✅" : "❌") + " هشدار اخبار با اهمیت متوسط\n" +
    "⏱ زمان‌بندی: " + minutes + " دقیقه قبل از انتشار"
  );
}
