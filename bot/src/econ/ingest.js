// جمع‌آوری داده‌ی تقویم، مستقیم از منبع.
//
// تا امروز این کار در n8n انجام می‌شد و ورکر نتیجه‌اش را آینه می‌کرد. دو
// منبعِ تقویم هر دو JSON عمومی‌اند و هیچ رمزی نمی‌خواهند، پس آن واسطه
// هیچ چیزی اضافه نمی‌کرد جز یک سرور دیگر که می‌توانست بخوابد.
//
// منطق نرمال‌سازی مو‌به‌مو از نودهای Normalize Filter FF Events،
// Normalize Holidays و Preserve Released Actuals آورده شده تا شناسه‌ی
// رویدادها عوض نشود. اگر `event_id` فرق می‌کرد، دفترِ هشدارها همه‌ی
// رویدادهای موجود را «تازه» می‌دید و برای هر کدام دوباره هشدار می‌رفت.

import { ensureSchema, replaceHolidays, markSynced } from "./store.js";
import { readConfig } from "../content/channel.js";

export const INGEST_FLAG = "econ_worker_ingest";

export async function ingestEnabled(env) {
  const v = await readConfig(env, INGEST_FLAG).catch(() => "");
  return String(v).toLowerCase() === "on";
}

const FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const HOLIDAY_URL = (year) => `https://date.nager.at/api/v3/publicholidays/${year}/US`;

function slugify(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * فید ForexFactory را به ردیف‌های جدول تبدیل می‌کند.
 *
 * جدا از تابع شبکه نگه داشته شده تا بشود بدون زدن به اینترنت تستش کرد -
 * و همین‌جاست که همه‌ی تصمیم‌های ریز نشسته‌اند.
 */
export function normalizeFfEvents(raw, nowIso = new Date().toISOString()) {
  const results = [];
  for (const ev of raw || []) {
    const currency = String((ev && ev.country) || "").trim();
    // فقط دلار - به‌علاوه‌ی رویدادهای «All».
    //
    // ForexFactory جکسون‌هول و نشست‌های G7/G20 را با کشور "All" علامت
    // می‌زند و آن‌ها هر جفت‌ارز دلاری را تکان می‌دهند. یک بار همین فیلتر
    // باعث شد بزرگ‌ترین رویداد هفته اصلاً در تقویم نیاید.
    if (currency !== "USD" && currency !== "All") continue;

    const impactRaw = String((ev && ev.impact) || "").trim().toLowerCase();
    let importance;
    if (impactRaw === "high") importance = "high";
    else if (impactRaw === "medium") importance = "medium";
    // تعطیلات جدول خودش را دارد؛ اینجا دوباره‌کاری است.
    else if (impactRaw === "holiday") continue;
    else importance = "low";

    const dateStr = String((ev && ev.date) || "");
    const datePart = dateStr.slice(0, 10);
    const timePart = dateStr.slice(11, 16);
    if (!datePart) continue;

    const title = String((ev && ev.title) || "").trim();
    if (!title) continue;

    const actual = String((ev && ev.actual) || "").trim();

    results.push({
      event_id: "FF_" + datePart + "_" + slugify(title),
      date: datePart,
      time: timePart,
      // event_fa عمداً همان عنوان انگلیسی است. ترجمه‌ی فارسی موقع ساختن
      // متن از جدول برچسب‌ها می‌آید، نه از اینجا - یک جای واحد که آکادمی
      // می‌تواند عوضش کند بدون دست زدن به داده‌ی خام.
      event: title,
      event_fa: title,
      importance,
      forecast: String((ev && ev.forecast) || ""),
      previous: String((ev && ev.previous) || ""),
      actual,
      status: actual ? "released" : "upcoming",
      source: "ForexFactory",
      last_updated: nowIso,
    });
  }
  return results;
}

export function normalizeHolidays(raw, nowIso = new Date().toISOString()) {
  const out = [];
  for (const h of raw || []) {
    if (!h || !h.date) continue;
    const types = h.types || [];
    // فقط تعطیلی بانکی و عمومی. بقیه‌ی انواع (مثلاً «Optional») بازار را
    // نمی‌بندند و آوردنشان فقط جدول را شلوغ می‌کند.
    if (types.indexOf("Bank") === -1 && types.indexOf("Public") === -1) continue;
    out.push({
      date: h.date,
      name: h.name,
      name_fa: "",
      country: "United States",
      market_status: types.indexOf("Bank") !== -1 ? "bank_holiday" : "public_holiday",
      last_updated: nowIso,
    });
  }
  return out;
}

/**
 * عدد «واقعی» را از ردیف قبلی نگه می‌دارد.
 *
 * فید ForexFactory عدد واقعی را دیر - یا اصلاً - نمی‌آورد. بدون این، هر
 * اجرای ساعتی یک رشته‌ی خالی روی عددی می‌نوشت که قبلاً منتشر شده بود، و
 * رویدادِ منتشرشده دوباره «در انتظار» می‌شد. نتیجه‌اش در چشم کاربر این
 * است که عدد ظاهر می‌شود و یک ساعت بعد ناپدید.
 */
export function preserveActuals(fresh, existingRows) {
  const old = new Map();
  for (const r of existingRows || []) {
    if (r && r.event_id) old.set(String(r.event_id), r);
  }
  return (fresh || []).map((e) => {
    if (e.actual) return e;
    const prev = old.get(e.event_id);
    if (prev && String(prev.actual || "").trim()) {
      return { ...e, actual: prev.actual, status: "released" };
    }
    return e;
  });
}

async function fetchJson(url, label) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    // فید بدون User-Agent گاهی ۴۰۳ می‌دهد و ۴۲۹ هم می‌زند؛ معرفی خودمان
    // ارزان‌ترین کاری است که می‌شود کرد.
    headers: { "User-Agent": "sobhansamadi-bot/1.0 (+https://sobhansamadi.com)" },
  });
  if (!res.ok) throw new Error(label + " پاسخ نداد: " + res.status);
  return res.json();
}

/**
 * رویدادها را به‌روز می‌کند بدون اینکه جدول را خالی کند.
 *
 * برخلاف آینه‌سازی از n8n که یک جای‌گزینی کامل بود، اینجا فید فقط
 * «همین هفته» را می‌دهد. اگر جدول خالی می‌شد، هفته‌ی گذشته و رویدادهای
 * دورتر - که نمای «این هفته» و تاریخچه به آن‌ها نیاز دارند - هر ساعت از
 * بین می‌رفتند.
 */
async function upsertEvents(env, rows) {
  if (rows.length === 0) return 0;
  const statements = rows.map((e) =>
    env.DB.prepare(
      `INSERT INTO econ_events
         (event_id, date, time, event, event_fa, importance, forecast,
          previous, actual, status, source, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET
         date = excluded.date,
         time = excluded.time,
         event = excluded.event,
         importance = excluded.importance,
         forecast = excluded.forecast,
         previous = excluded.previous,
         actual = excluded.actual,
         status = excluded.status,
         last_updated = excluded.last_updated`
    ).bind(
      e.event_id, e.date, e.time, e.event, e.event_fa, e.importance,
      e.forecast, e.previous, e.actual, e.status, e.source, e.last_updated
    )
  );
  await env.DB.batch(statements);
  return rows.length;
}

// رویدادهای کهنه. ۶۰ روز از هر بازه‌ای که نماها نگاه می‌کنند بلندتر است
// (طولانی‌ترین‌شان «این هفته» است) و جا برای تاریخچه هم می‌گذارد.
async function pruneOldEvents(env) {
  const cutoff = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const res = await env.DB.prepare(`DELETE FROM econ_events WHERE date < ?`).bind(cutoff).run();
  return (res && res.meta ? res.meta.changes || 0 : 0);
}

/**
 * یک دور کامل جمع‌آوری.
 *
 * دو منبع مستقل‌اند و شکست یکی نباید دیگری را زمین بزند: اگر فید تقویم
 * ۴۲۹ بدهد ولی تعطیلات بیاید، تعطیلات باید نوشته شود. هر خطا در نتیجه
 * برمی‌گردد، نه اینکه بالا پرت شود - صداکننده یک زمان‌بند است و چیزی
 * برای گرفتنِ استثنا آن بالا نیست جز لاگ.
 */
export async function ingestEconSources(env) {
  if (!(await ingestEnabled(env))) return { skipped: "خاموش" };

  await ensureSchema(env);
  const nowIso = new Date().toISOString();
  const out = { events: 0, holidays: 0, pruned: 0, errors: [] };

  try {
    const feed = await fetchJson(FF_URL, "فید ForexFactory");
    const fresh = normalizeFfEvents(Array.isArray(feed) ? feed : [], nowIso);
    if (fresh.length === 0) {
      // فیدِ سالم هرگز خالی نیست. یک آرایه‌ی خالی یعنی ساختار عوض شده یا
      // صفحه‌ی خطا برگشته؛ در هر دو حالت نوشتنش یعنی پاک کردن تقویم.
      out.errors.push("فید تقویم خالی بود؛ داده‌ی قبلی دست‌نخورده ماند");
    } else {
      const { results } = await env.DB
        .prepare(`SELECT event_id, actual FROM econ_events`)
        .all();
      out.events = await upsertEvents(env, preserveActuals(fresh, results || []));
      out.pruned = await pruneOldEvents(env);
    }
  } catch (err) {
    out.errors.push(String(err && err.message));
  }

  try {
    const year = new Date().getUTCFullYear();
    // امسال و سال بعد: در دی و بهمن، نمای «این هفته» به ژانویه‌ی سال
    // بعد می‌رسد و بدون این، تعطیلات آن هفته گم می‌شد.
    const [a, b] = await Promise.all([
      fetchJson(HOLIDAY_URL(year), "تعطیلات"),
      fetchJson(HOLIDAY_URL(year + 1), "تعطیلات سال بعد").catch(() => []),
    ]);
    const rows = normalizeHolidays([...(a || []), ...(b || [])], nowIso);
    if (rows.length > 0) {
      out.holidays = await replaceHolidays(env, rows);
    }
  } catch (err) {
    out.errors.push(String(err && err.message));
  }

  if (out.events > 0 || out.holidays > 0) await markSynced(env, nowIso);
  return out;
}
