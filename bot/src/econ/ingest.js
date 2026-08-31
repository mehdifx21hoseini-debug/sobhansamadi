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

// فید تقویم را ورکر نمی‌تواند بگیرد، و این یک محدودیت شبکه است نه نرخ.
//
// اندازه‌گیری شده: از Cloudflare Worker همیشه ۴۲۹ برمی‌گردد (با و بدون
// User-Agent)، از یک ران‌رِ GitHub Actions همان لحظه ۲۰۰. فید پشت خود
// Cloudflare نشسته و درخواست‌های Workers را رد می‌کند. صبر کردن یا کم
// کردن دفعات این را حل نمی‌کند.
//
// پس فید را یک جاب ساعتی در GitHub Actions می‌گیرد و خامش را به
// POST /econ/ingest می‌فرستد؛ همان تابع نرمال‌سازی اینجا رویش اجرا
// می‌شود. الگویش تازه نیست: خواننده‌ی اعداد واقعی (ff-actuals.yml)
// دقیقاً به همین دلیل از قبل آنجاست.
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
 * رویدادها را از فیدِ خامی که GitHub Actions فرستاده می‌نویسد.
 *
 * نرمال‌سازی اینجا انجام می‌شود نه آن طرف: جاب فقط یک لوله است و هرچه
 * منطق در آن بنشیند، جایی است که نه تست دارد نه به‌سادگی دیده می‌شود.
 */
export async function ingestEvents(env, feed) {
  if (!(await ingestEnabled(env))) return { skipped: "خاموش" };

  await ensureSchema(env);
  const nowIso = new Date().toISOString();
  const fresh = normalizeFfEvents(Array.isArray(feed) ? feed : [], nowIso);

  // فیدِ سالم هرگز خالی نیست. آرایه‌ی خالی یعنی ساختار عوض شده یا صفحه‌ی
  // خطا برگشته؛ در هر دو حالت نوشتنش یعنی پاک کردن تقویم.
  if (fresh.length === 0) {
    return { events: 0, pruned: 0, error: "فید خالی بود؛ داده‌ی قبلی دست‌نخورده ماند" };
  }

  const { results } = await env.DB.prepare(`SELECT event_id, actual FROM econ_events`).all();
  const events = await upsertEvents(env, preserveActuals(fresh, results || []));
  const pruned = await pruneOldEvents(env);
  await markSynced(env, nowIso);
  return { events, pruned };
}

/**
 * تعطیلات - این یکی را ورکر خودش می‌گیرد.
 *
 * date.nager.at از Workers بی‌مشکل جواب می‌دهد، پس بردنش به GitHub
 * Actions فقط یک قطعه‌ی متحرکِ اضافه بود.
 */
export async function ingestHolidays(env) {
  if (!(await ingestEnabled(env))) return { skipped: "خاموش" };

  await ensureSchema(env);
  const nowIso = new Date().toISOString();
  const year = new Date().getUTCFullYear();

  // امسال و سال بعد: در دی و بهمن، نمای «این هفته» به ژانویه‌ی سال بعد
  // می‌رسد و بدون این، تعطیلات آن هفته گم می‌شد.
  const [a, b] = await Promise.all([
    fetchJson(HOLIDAY_URL(year), "تعطیلات"),
    fetchJson(HOLIDAY_URL(year + 1), "تعطیلات سال بعد").catch(() => []),
  ]);

  const rows = normalizeHolidays([...(a || []), ...(b || [])], nowIso);
  if (rows.length === 0) return { holidays: 0, error: "فهرست تعطیلات خالی بود" };
  return { holidays: await replaceHolidays(env, rows) };
}

/**
 * عددهای «واقعی» که خواننده‌ی مرورگری از صفحه‌ی تقویم خوانده.
 *
 * فقط ردیف‌های موجود را به‌روز می‌کند و هرگز چیزی درج نمی‌کند - همان
 * قاعده‌ای که نسخه‌ی n8n داشت. دلیلش این است که این خواننده عنوان را از
 * صفحه‌ی HTML برمی‌دارد و اگر روزی متن عنوان کمی فرق کند، درج یعنی یک
 * رویدادِ تکراریِ بی‌ساعت و بی‌اهمیت در تقویم؛ به‌روزرسانیِ نشده، فقط
 * یعنی این عدد نرسید - که خیلی کم‌هزینه‌تر است و در پاسخ هم دیده می‌شود.
 */
export async function ingestActuals(env, rows) {
  if (!(await ingestEnabled(env))) return { skipped: "خاموش" };
  if (!Array.isArray(rows) || rows.length === 0) return { updated: 0, unmatched: 0 };

  await ensureSchema(env);
  const nowIso = new Date().toISOString();
  let updated = 0;
  const unmatched = [];

  for (const r of rows) {
    const date = String((r && r.date) || "").slice(0, 10);
    const title = String((r && r.title) || "").trim();
    const actual = String((r && r.actual) || "").trim();
    if (!date || !title || !actual) continue;

    // همان فرمولی که رویداد با آن ساخته شده. اگر این دو از هم جدا
    // بیفتند، هیچ عددی هرگز به هیچ رویدادی نمی‌چسبد و از بیرون فقط
    // «ستون واقعی همیشه خالی است» دیده می‌شود.
    const eventId = "FF_" + date + "_" + slugify(title);

    const res = await env.DB
      .prepare(
        `UPDATE econ_events
            SET actual = ?, status = 'released', last_updated = ?
          WHERE event_id = ?`
      )
      .bind(actual, nowIso, eventId)
      .run();

    if ((res && res.meta ? res.meta.changes || 0 : 0) > 0) updated++;
    else unmatched.push(eventId);
  }

  // نامِ ردیف‌هایی که جفت نشدند برمی‌گردد، نه فقط تعدادشان: اگر عنوانی در
  // صفحه عوض شده باشد، این تنها جایی است که لو می‌رود.
  return { updated, unmatched: unmatched.length, unmatched_ids: unmatched.slice(0, 10) };
}

/**
 * اندپوینتی که جاب GitHub Actions به آن POST می‌کند.
 *
 * کلید در بدنه است نه در هدر، چون فرستنده یک `curl` در یک فایل YAML
 * است و بدنه همان جایی است که بقیه‌ی وبهوک‌های این پروژه هم کلید را
 * می‌گیرند - یک عادت، نه دو تا.
 */
export async function handleIngestPost(request, env) {
  return postHandler(request, env, (e, body) => ingestEvents(e, body.events));
}

/** همان مسیر، برای عددهای واقعی. */
export async function handleActualsPost(request, env) {
  return postHandler(request, env, (e, body) => ingestActuals(e, body.events));
}

async function postHandler(request, env, run) {
  const expected = env.ECON_INGEST_KEY || env.ECON_EXPORT_KEY;
  if (!expected) {
    return { status: 503, body: { success: false, error: "کلید ورودی تنظیم نشده است" } };
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, body: { success: false, error: "بدنه JSON معتبر نبود" } };
  }

  if (!body || body.key !== expected) {
    return { status: 401, body: { success: false, error: "unauthorized" } };
  }

  try {
    return { status: 200, body: { success: true, ...(await run(env, body)) } };
  } catch (err) {
    return { status: 500, body: { success: false, error: String(err && err.message) } };
  }
}
