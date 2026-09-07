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
import { holidayLabel } from "./holidayNames.js";
import { makeLabelHelpers, mdCell, wrapName } from "./labels.js";

// همان فیلتر و مرتب‌سازی که هر دو نمای متن و markdown از آن استفاده
// می‌کنند، تا دو نسخه هرگز از هم جدا نیفتند.
function todaysEvents(events) {
  const today = new Date().toISOString().slice(0, 10);
  return events
    .filter((e) => e.date === today && e.importance !== "low")
    .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
}

function weekEventsOf(events) {
  const today = new Date().toISOString().slice(0, 10);
  const todayD = new Date(today + "T00:00:00Z");
  const weekEnd = new Date(todayD.getTime() + 7 * 86400000);
  return events
    .filter((e) => {
      if (!e.date || e.importance === "low") return false;
      const d = new Date(e.date + "T00:00:00Z");
      return d >= todayD && d <= weekEnd;
    })
    .sort((a, b) => (a.date + (a.time || "99:99")).localeCompare(b.date + (b.time || "99:99")));
}

// متن‌های زیر عیناً همان چیزی را می‌سازند که نودهای Build Today Text،
// Build Week Text و Build Next Event Text در n8n می‌ساختند - فقط منبع
// داده از جدول‌های n8n به آینه‌ی D1 عوض شده. فرمت پیام دست‌نخورده است تا
// کاربر تفاوتی حس نکند.

// دو نمای امروز و هفته در نسخه‌ی n8n با متد sendRichMessage و ستون
// markdown فرستاده می‌شدند، نه با متن ساده. پس هر دو ساخته می‌شوند: متن
// ساده برای مسیرهایی که همان را می‌خواهند، و markdown برای همان چیزی که
// کاربر واقعاً می‌دید.

export function buildTodayText(events) {
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  const todays = todaysEvents(events);

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
  const weekEvents = weekEventsOf(events);

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

  // خلاصه‌ی صبح از فهرست بالا برداشته شد چون دیگر به این کلید وابسته
  // نیست: برای همه‌ی اعضا می‌رود و خط جداگانه‌ی خودش را دارد. ماندنش در
  // فهرستِ «با فعال کردن هشدار...» یعنی کسی که هشدار را خاموش می‌کند
  // فکر کند خلاصه هم قطع شده، در حالی که فردا صبح باز می‌آید.
  return (
    "🔔 هشدار اخبار اقتصادی\n\n" +
    "با فعال کردن هشدار، دو چیز برات فرستاده می‌شه:\n\n" +
    "⏰ چند دقیقه قبل از هر خبر مهم — یادآوری\n" +
    "📊 بلافاصله بعد از انتشار — عدد واقعی\n\n" +
    "می‌تونی فقط اخبار خیلی مهم رو بگیری یا اخبار متوسط رو هم اضافه کنی، و انتخاب کنی چند دقیقه قبل بهت خبر بدم.\n\n" +
    "وضعیت فعلی:\n" +
    (subscribed ? "✅" : "❌") + " هشدار اخبار خیلی مهم\n" +
    (showMedium ? "✅" : "❌") + " هشدار اخبار با اهمیت متوسط\n" +
    "⏱ زمان‌بندی: " + minutes + " دقیقه قبل از انتشار\n" +
    (sub.digest_off ? "❌" : "✅") + " 📰 خلاصه‌ی اخبار، هر روز صبح"
  );
}

// ---------------------------------------------------------------------
// نماهای Rich. نسخه‌ی n8n این‌ها را با متد sendRichMessage می‌فرستاد؛
// جدول markdown، بلوک‌های <details> تاشو و «خوانش برای دلار» همان چیزی
// است که کاربر روی دکمه‌های «امروز» و «این هفته» می‌دید.
// ---------------------------------------------------------------------

/**
 * تعطیلیِ یک روزِ مشخص، از فهرستِ تعطیلات.
 *
 * فهرست همیشه پاس داده نمی‌شود - صداکننده‌های قدیمی دو آرگومان می‌دادند -
 * پس نبودنش خطا نیست و فقط یعنی «نشانی نگذار».
 */
function holidayOn(holidays, date) {
  return (holidays || []).find((h) => h && h.date === date) || null;
}

/**
 * نوارِ بالای نمای امروز.
 *
 * چرا بالای جدول و نه پایینش: کاربر جدول را می‌بیند و بلافاصله قضاوت
 * می‌کند «امروز خبری نیست». اگر دلیلش پایین‌تر نوشته شده باشد، دیگر
 * خوانده نمی‌شود.
 */
function holidayBanner(holiday) {
  if (!holiday) return "";
  // سرتیتر و نه یک خطِ پررنگ: نما با «## اخبار امروز» شروع می‌شود و یک
  // خطِ معمولی زیر آن گم می‌شد. سرتیتر همان وزنِ بصری را دارد که خبر
  // لازم دارد، و 🔴 از دور می‌گوید این یک اعلانِ مهم است نه یک ردیفِ
  // دیگرِ جدول.
  // 🔴 همان نشانی است که در جدول برای خبرهای خیلی مهم به کار می‌رود، پس
  // کاربر معنی‌اش را از قبل می‌داند و اینجا هم بدونِ توضیح می‌فهمد که این
  // خط مهم است.
  //
  // RLM پیش از هر خط: تلگرام جهتِ خط را از اولین حرفِ قوی می‌گیرد و
  // ایموجی حرفِ قوی نیست؛ خطی که با ایموجی و بعد پرانتزِ لاتین شروع
  // می‌شود می‌تواند چپ‌چین بیفتد.
  return (
    "### " + RLM + "🔴 امروز تعطیلی بانکی آمریکا\n\n" +
    RLM + "🏦 **" + mdCell(holidayLabel(holiday)) + "**\n\n" +
    RLM + "📉 نقدینگی بازار پایین است\n\n" +
    RLM + "📰 داده‌ی اقتصادی مهمی منتشر نمی‌شود\n\n" +
    "---\n\n"
  );
}

export function buildTodayMarkdown(events, labels, holidays) {
  const { enShort, enFull, faName, usdRead } = makeLabelHelpers(labels);
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);
  const todays = todaysEvents(events);

  // جزئیات کامل هر رویداد، به‌صورت پیش‌فرض بسته، تا پیام خوانا بماند.
  function detailsBlock(list) {
    if (!list || list.length === 0) return "";
    const lines = ["<details><summary>" + RLM + "📋 جزئیات کامل رویدادها</summary>", ""];
    for (const e of list) {
      const when = e.time
        ? toPersianDigits(etTimeToTehran(e.date, e.time)) + " به وقت تهران"
        : "زمان اعلام‌نشده";
      const en = enFull(e);
      const fa2 = faName(e);
      lines.push(
        RLM + "**" + mdCell(en || fa2) + "**" +
          (en && fa2 && fa2 !== en ? " — " + mdCell(fa2) : "") +
          " · " + when
      );
      lines.push("");
      const bits = [
        "پیش‌بینی " + (e.forecast || "-"),
        "قبلی " + (e.previous || "-"),
        "واقعی " + (e.actual || (e.status === "upcoming" ? "منتشر نشده" : "-")),
      ];
      if (e.source) bits.push("منبع " + e.source);
      lines.push(RLM + mdCell(bits.join(" · ")));
      lines.push("");
    }
    lines.push("</details>");
    lines.push("");
    return lines.join("\n");
  }

  function usdReadBlock(list) {
    const lines = [];
    for (const e of list) {
      if (e.status !== "released") continue;
      const r = usdRead(e);
      if (!r) continue;
      lines.push("- " + mdCell(enShort(e)) + " " + r.arrow + " " + r.word + " — " + r.icon + " " + r.verdict);
    }
    if (lines.length === 0) return "";
    return (
      "\n**💵 خوانش برای دلار**\n\n" + lines.join("\n") +
      "\n\n_این یک برداشت کلی از رابطه معمول این شاخص با دلار است، نه سیگنال معاملاتی._\n"
    );
  }

  const holiday = holidayOn(holidays, today);

  // RLM پیش از هر خطِ متنی، تا هیچ خطی چپ‌چین نیفتد. جهتِ خط از اولین
  // حرفِ قویِ همان خط می‌آید و ایموجی، عدد و پرانتزِ لاتین هیچ‌کدام قوی
  // نیستند - پس خطی که با «🇺🇸» یا «📅 ۱۶» شروع می‌شود می‌تواند برعکس
  // بیفتد. نشانه بعد از علامتِ markdown می‌آید تا سرتیتر نشکند.
  let markdown = "## " + RLM + "🇺🇸 اخبار مهم اقتصادی امروز (دلار)\n\n";
  markdown += RLM + "📅 " + formatJalaliDate(today) + "\n\n";
  markdown += holidayBanner(holiday);
  if (todays.length === 0) {
    // در روزِ تعطیل این جمله گمراه‌کننده است: کاربر فکر می‌کند داده را
    // نداریم، نه اینکه بازار تعطیل است. نوارِ بالا خودش توضیح داده.
    if (!holiday) markdown += RLM + "امروز رویداد مهمی برای دلار ثبت نشده است.\n\n";
  } else {
    markdown += "| ساعت | رویداد | پیش‌بینی | واقعی |\n";
    markdown += "|---|---|---|---|\n";
    for (const e of todays) {
      const emoji = IMPORTANCE_EMOJI[e.importance] || "⚪";
      const t = e.time ? toPersianDigits(etTimeToTehran(e.date, e.time)) : "-";
      let actual = e.actual || (e.status === "upcoming" ? "—" : "-");
      if (e.actual) {
        const r0 = usdRead(e);
        if (r0) actual = e.actual + " " + r0.icon;
      }
      const name = emoji + " " + wrapName(mdCell(enShort(e)), 12);
      markdown += "| " + mdCell(t) + " | " + name + " | " + mdCell(e.forecast || "-") + " | " + mdCell(actual) + " |\n";
    }
    markdown += "\n";
    const upcoming = todays.filter((e) => e.time && e.status === "upcoming");
    if (upcoming.length > 0) {
      const nextEvent = upcoming[0];
      const cd = formatCountdown(etMinutesUntilNow(nextEvent.date, nextEvent.time));
      if (cd) markdown += RLM + "**" + mdCell(faName(nextEvent)) + "** — " + cd + "\n\n";
    }
  }
  markdown += detailsBlock(todays);
  markdown += usdReadBlock(todays);
  const lastUpdated = todays.length > 0 ? todays[0].last_updated : nowIso;
  markdown += RLM + "ℹ️ آخرین بروزرسانی: " + relativeTimeFa(lastUpdated);
  return markdown;
}

export function buildWeekMarkdown(events, labels, holidays) {
  const { enShort, enFull, faName, usdRead } = makeLabelHelpers(labels);
  const weekEvents = weekEventsOf(events);

  // روزهای تعطیلِ همین بازه، حتی آن‌هایی که هیچ رویدادی ندارند.
  //
  // بدونِ این، تعطیلیِ بی‌رویداد اصلاً در برنامه‌ی هفته دیده نمی‌شد: روز
  // از فهرست غایب بود و کاربر نمی‌فهمید آن روز بازار وضعیت خاصی دارد.
  // بازه همان بازه‌ی رویدادهاست - امروز تا هفت روز بعد - نه از اولین تا
  // آخرین رویداد. اگر از روی رویدادها ساخته می‌شد، تعطیلیِ پنجشنبه در
  // هفته‌ای که آخرین خبرش سه‌شنبه است بیرون می‌افتاد.
  const weekDates = weekEvents.map((e) => e.date).filter(Boolean).sort();
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(new Date(from + "T00:00:00Z").getTime() + 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  const holidayDays = (holidays || [])
    .filter((h) => h && h.date && h.date >= from && h.date <= to)
    .map((h) => h.date);

  let markdown = "## 📆 تقویم اقتصادی این هفته (دلار)\n";
  if (weekEvents.length === 0) {
    markdown += "\nرویداد مهمی برای این هفته ثبت نشده است.";
    return markdown.trim();
  }

  // روزها به ترتیب، چه رویداد داشته باشند چه فقط تعطیل باشند.
  const allDates = [...new Set([...weekDates, ...holidayDays])].sort();
  // سرتیترِ روز، دقیقاً یک شکل برای همه‌ی روزها.
  //
  // نشانِ تعطیلی پیشتر به همین خط چسبانده می‌شد و همان یک خط را با بقیه
  // ناهم‌جهت می‌کرد: در فهرستی که سرتیترها چپ می‌نشستند، تنها روزِ تعطیل
  // راست می‌افتاد. حالا سرتیتر همیشه یکسان است و نشان یک خط پایین‌تر
  // می‌نشیند - هم ناهماهنگی رفع می‌شود، هم خودِ نشان جای بیشتری دارد.
  const dayHeader = (date) => {
    const dd = new Date(date + "T00:00:00Z");
    return "\n### 📅 " + DAY_FA[dd.getUTCDay()] + " " + formatJalaliDate(date) + "\n\n";
  };

  /** خطِ تعطیلی، زیرِ سرتیتر. برای روزِ عادی رشته‌ی خالی. */
  const holidayLine = (date) => {
    const hol = holidayOn(holidays, date);
    return hol ? "🔴 🏦 تعطیل بانکی: " + mdCell(holidayLabel(hol)) + "\n\n" : "";
  };

  // روزهایی که فقط تعطیل‌اند و هیچ رویدادی ندارند، همین‌جا نوشته می‌شوند
  // و از حلقه‌ی رویدادها بیرون می‌مانند.
  const eventDates = new Set(weekDates);
  const emptyHolidays = allDates.filter((d) => !eventDates.has(d));

  let lastMdDate = "";
  for (const e of weekEvents) {
    if (e.date !== lastMdDate) {
      // هر روزِ تعطیلِ بی‌رویداد که پیش از این روز است، اول نوشته شود تا
      // ترتیبِ تاریخ‌ها به هم نخورد.
      for (const d of emptyHolidays) {
        if (d < e.date && d > lastMdDate) {
          markdown +=
            dayHeader(d) + holidayLine(d) + "📉 نقدینگی پایین · 📰 بدون داده‌ی اقتصادی\n";
        }
      }
      markdown += dayHeader(e.date) + holidayLine(e.date);
      markdown += "| ساعت | رویداد | پیش‌بینی | واقعی |\n|---|---|---|---|\n";
      lastMdDate = e.date;
    }
    const em = IMPORTANCE_EMOJI[e.importance] || "⚪";
    const tt = e.time ? toPersianDigits(etTimeToTehran(e.date, e.time)) : "-";
    let ac = e.actual || (e.status === "upcoming" ? "—" : "-");
    if (e.actual) {
      const r0 = usdRead(e);
      if (r0) ac = e.actual + " " + r0.icon;
    }
    const name = em + " " + wrapName(mdCell(enShort(e)), 12);
    markdown += "| " + mdCell(tt) + " | " + name + " | " + mdCell(e.forecast || "-") + " | " + mdCell(ac) + " |\n";
  }

  // تعطیلی‌هایی که بعد از آخرین روزِ رویدادها می‌افتند - حلقه‌ی بالا به
  // آن‌ها نمی‌رسد چون رویدادی پس از آن‌ها نیست.
  for (const d of emptyHolidays) {
    if (d > lastMdDate) {
      markdown +=
        dayHeader(d) + holidayLine(d) + "📉 نقدینگی پایین · 📰 بدون داده‌ی اقتصادی\n";
    }
  }

  // واژه‌نامه‌ی تاشو: نام کامل انگلیسی → فارسی، یک‌بار برای هر رویداد
  // متمایز.
  const seen = {};
  const gl = [];
  for (const e of weekEvents) {
    const en = enFull(e);
    if (!en || seen[en]) continue;
    seen[en] = true;
    const fa2 = faName(e);
    gl.push("- **" + mdCell(en) + "**" + (fa2 && fa2 !== en ? " — " + mdCell(fa2) : ""));
  }
  if (gl.length > 0) {
    markdown += "\n<details><summary>📖 نام کامل و ترجمه رویدادها</summary>\n\n" + gl.join("\n") + "\n\n</details>\n";
  }
  markdown += "\n⏰ زمان‌ها به وقت تهران هستن.";
  return markdown.trim();
}

export function buildHolidaysMarkdown(holidays) {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (holidays || [])
    .filter((h) => h.date && h.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  let markdown = "## 🏦 تعطیلات بانکی آمریکا\n\n";
  markdown += "تعطیلی بانک‌ها روی نقدینگی و شرایط معاملاتی دلار اثر می‌گذارد.\n\n";
  if (upcoming.length === 0) {
    markdown += "تعطیلی ثبت‌شده‌ای برای بازه‌ی پیش‌رو وجود ندارد.";
    return markdown.trim();
  }

  const nx = upcoming[0];
  const isTodayHoliday = nx.date === today;
  const daysLeft = Math.round(
    (new Date(nx.date + "T00:00:00Z") - new Date(today + "T00:00:00Z")) / 86400000
  );
  markdown +=
    (isTodayHoliday
      ? "**🔴 امروز تعطیل بانکی است: " + mdCell(nx.name) + "**"
      : "**🔜 تعطیلی بعدی: " + mdCell(nx.name) + "** — " + toPersianDigits(daysLeft) + " روز دیگر") + "\n\n";
  markdown += "| تاریخ | مناسبت |\n|---|---|\n";
  for (const hh of upcoming.slice(0, 8)) {
    markdown += "| " + mdCell(formatJalaliDate(hh.date)) + " | " + mdCell(hh.name) + " |\n";
  }
  markdown += "\n⚠️ تعطیلی بانکی به معنای تعطیلی کامل بازار فارکس نیست.";
  return markdown.trim();
}

// زمینه‌ای که به ایجنت هوش مصنوعی داده می‌شود. عیناً از نود
// Build Explain Prompt. برخلاف نماهای بالا اینجا رویدادهای کم‌اهمیت هم
// می‌آیند - ایجنت باید کل تصویر روز را ببیند، نه فقط تیترها.
export function buildExplainContext(events, holidays) {
  const today = new Date().toISOString().slice(0, 10);
  const todays = (events || []).filter((e) => e.date === today);
  const holiday = holidayOn(holidays, today);

  return (
    "امروز: " + formatJalaliDate(today) + "\n" +
    // بدونِ این خط، مدل در روزِ تعطیل نمی‌داند چرا جدول خالی است و
    // درباره‌ی روزی حرف می‌زند که اصلاً بازارش باز نبوده.
    (holiday
      ? "توجه: امروز تعطیلی بانکی آمریکا است (" + holidayLabel(holiday) +
        "). نقدینگی بازار پایین است و داده‌ی اقتصادی مهمی منتشر نمی‌شود.\n"
      : "") +
    (todays.length === 0
      ? "امروز رویداد مهم اقتصادی ثبت‌شده‌ای برای دلار در منبع داده وجود ندارد."
      : todays
          .map(
            (e) =>
              "- " + e.event_fa +
              (e.time ? " | ساعت " + etTimeToTehran(e.date, e.time) + " (به‌وقت تهران)" : "") +
              (e.actual ? " | Actual: " + e.actual : "") +
              (e.previous ? " | Previous: " + e.previous : "") +
              " | منبع: " + e.source
          )
          .join("\n"))
  );
}

// ---------------------------------------------------------------------
// آراستن پاسخ هوش مصنوعی
// ---------------------------------------------------------------------
// متن را مدل می‌سازد، پس شکلش هر بار کمی فرق می‌کند: گاهی تگی می‌آورد که
// تلگرام نمی‌شناسد و کل پیام رد می‌شود، گاهی ساعت را با رقم لاتین
// می‌نویسد در حالی که بقیه‌ی ربات فارسی است، گاهی سه خط خالی پشت‌سرهم
// می‌گذارد. این تابع همان‌ها را یکدست می‌کند تا ظاهر پیام به سلیقه‌ی مدل
// وابسته نباشد.

// فهرست تگ‌های مجاز تلگرام. هرچه بیرون این فهرست باشد حذف می‌شود ولی
// متنش می‌ماند - بهتر از رد شدن کل پیام.
const TELEGRAM_TAGS = new Set(["b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "code", "pre", "a", "blockquote", "tg-spoiler", "br"]);

function stripUnknownTags(html) {
  return String(html).replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)[^>]*>/g, (tag, name) =>
    TELEGRAM_TAGS.has(name.toLowerCase()) ? tag : ""
  );
}

// ارقام فقط در متن عوض می‌شوند، نه داخل تگ‌ها - وگرنه href و نام تگ خراب
// می‌شود و پیام از کار می‌افتد.
function persianDigitsOutsideTags(html) {
  return String(html)
    .split(/(<[^>]*>)/)
    .map((part, i) => (i % 2 === 1 ? part : toPersianDigits(part)))
    .join("");
}

export function formatAiAnswer(answer) {
  let out = stripUnknownTags(answer);
  out = persianDigitsOutsideTags(out);

  // مدل گاهی با «سلام» یا یک جمله‌ی مقدماتی شروع می‌کند. سرصفحه را خودمان
  // می‌گذاریم، پس این تکرار فقط جا می‌گیرد.
  out = out.replace(/^\s*(سلام[.،!]?\s*)/, "");

  // فاصله‌های افراطی جمع می‌شوند تا پیام فشرده و خوانا بماند.
  out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  return out;
}

// سرصفحه‌ی ثابت. چون خودمان می‌سازیم، تاریخ همیشه درست و یکسان است و به
// اینکه مدل یادش بماند تاریخ بنویسد وابسته نیست.
export function buildAiHeader() {
  const today = new Date().toISOString().slice(0, 10);
  return "🤖 <b>تحلیل اخبار اقتصادی امروز</b>\n📅 " + formatJalaliDate(today) + "\n\n";
}
