// گزارش روزانه‌ی فروش - جای‌گزینِ WF-18.
//
// همان اعدادی که نود Compute در n8n می‌ساخت و همان قالبِ متن، تا تیم
// فروش صبح چیزِ آشنا ببیند نه یک گزارشِ تازه که باید یاد بگیرد.
//
// یک تفاوت عمدی: «امروز» به وقت تهران حساب می‌شود، نه به وقتِ سرور.
// در n8n این وابسته به تنظیم منطقه‌ی زمانیِ خودِ instance بود؛ روی
// ورکر همه‌چیز UTC است و بدون تصریح، گزارشِ ساعت ۹ شبِ تهران نصفش
// مربوط به «فردا» می‌شد.

import { computeSalesKpi } from "./dashboards.js";
import { notifyAdmins } from "./intake.js";

const TEHRAN = "Asia/Tehran";

/** ابتدا و انتهای «امروز» به وقت تهران، بر حسب میلی‌ثانیه‌ی UTC. */
export function tehranDayBounds(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TEHRAN, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  // تهران از ۲۰۲۲ ساعت تابستانی ندارد، پس اختلاف ثابت است.
  const start = new Date(parts + "T00:00:00+03:30").getTime();
  return [start, start + 24 * 60 * 60 * 1000 - 1];
}

function fmt(n) {
  return new Intl.NumberFormat("fa-IR").format(n || 0);
}

/**
 * متنِ گزارش از روی داده.
 *
 * جدا از خواندنِ دیتابیس نگه داشته شده تا بشود با ورودیِ ساختگی و
 * «الان»ِ ثابت سنجیدش - وگرنه تنها راهِ آزمودنش صبر کردن تا ساعت ۹ شب
 * است.
 */
export function buildReport(leads, calls, orders, now = new Date()) {
  const [start, end] = tehranDayBounds(now);
  const inDay = (iso) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= start && t <= end;
  };

  const paid = orders.filter((o) => o.payment_status === "paid");
  const paidToday = paid.filter((o) => inDay(o.payment_date));
  const revenue = paidToday.reduce((s, o) => s + (Number(o.amount) || 0), 0);
  const conversion = leads.length > 0
    ? Math.round((paid.length / leads.length) * 1000) / 10
    : 0;

  const date = new Intl.DateTimeFormat("fa-IR", { timeZone: TEHRAN }).format(now);

  return {
    leads_today: leads.filter((l) => inDay(l.created_at)).length,
    calls_today: calls.filter((c) => inDay(c.created_at)).length,
    purchases_today: paidToday.length,
    revenue_today: revenue,
    text: [
      "📊 گزارش روزانه فروش — " + date,
      "",
      "👤 لید جدید امروز: " + fmt(leads.filter((l) => inDay(l.created_at)).length),
      "📞 تماس ثبت‌شده امروز: " + fmt(calls.filter((c) => inDay(c.created_at)).length),
      "💰 خرید امروز: " + fmt(paidToday.length),
      "💵 درآمد امروز: " + fmt(revenue) + " تومان",
      "",
      "📈 نرخ تبدیل کل: " + conversion + "%",
      "📋 کل لیدها: " + fmt(leads.length),
    ].join("\n"),
  };
}

/** خواندن، ساختن، فرستادن. */
export async function sendDailyReport(env) {
  const [leads, calls, orders] = await Promise.all([
    env.DB.prepare("SELECT lead_id, created_at FROM crm_leads").all(),
    env.DB.prepare("SELECT call_id, created_at FROM crm_calls").all(),
    env.DB.prepare("SELECT order_id, amount, payment_status, payment_date FROM crm_orders").all(),
  ]);

  const report = buildReport(
    leads.results || [], calls.results || [], orders.results || []
  );
  const out = await notifyAdmins(env, report.text);
  return { ...out, leads_today: report.leads_today, purchases_today: report.purchases_today };
}

// برای پیوند دادنِ این ماژول به داشبورد، تا اگر روزی فرمول عوض شد در دو
// جا از هم دور نیفتند.
export { computeSalesKpi };
