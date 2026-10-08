// رساندنِ هشدار به همه‌ی مشترکین، نه فقط اولِ فهرست.
//
// ─── باگی که این فایل برایش نوشته شد ─────────────────────────────
//
// یک عضو گزارش داد خلاصه‌ی صبح می‌رسد ولی هشدارِ «۵ دقیقه قبل از خبر»
// هیچ‌وقت نیامده. اندازه‌گیریِ پروداکشن در ۸ اکتبر:
//
//   مشترکِ فعال                                    ۳٬۳۸۴
//   سخنرانی ترامپ (۷ اکتبر) رسید به                  ۵۴۰
//   صورت‌جلسه‌ی فدرال‌رزرو (۷ اکتبر)                  ۵۴۰
//   سخنرانی والر (۸ اکتبر)                           ۵۴۰
//
// آن عدد ۱۲ تیکِ پنج‌دقیقه‌ای × ۴۵ پیام است - سقفِ subrequest در هر
// فراخوانیِ ورکر، نه یک نفر بیشتر. خلاصه و اطلاعیه و سلام هر سه
// ورک‌فلوی موازیِ خودشان را داشتند؛ هشدار نداشت.
//
// و ترتیب بدترش می‌کرد: پنجره‌ی ۶۰ دقیقه زودتر باز می‌شود و بودجه را
// می‌برد، پس ۴۱۵ نفری که «۵ دقیقه» را انتخاب کرده بودند عملاً هرگز
// چیزی نگرفتند.
//
// ─── و چرا تست لازم دارد ──────────────────────────────────────────
//
// نشانگر دقیقاً همان‌جایی است که این تغییر می‌تواند بی‌صدا بشکند. دو
// خرابیِ متقابل:
//
//   • اگر نشانگر فقط روی کسانی جلو برود که پیام گرفتند، ردیف‌های
//     بی‌موعد هر دور دوباره خوانده می‌شوند و پیمایش هیچ‌وقت به آخرِ
//     فهرست نمی‌رسد - یعنی همان باگ، با ظاهرِ تازه.
//   • اگر روی کسی جلو برود که بودجه تمام شده و پیامش نرفته، آن نفر
//     برای همیشه رد می‌شود.
//
// از بیرون هر دو شبیهِ «امروز خبری نبود» دیده می‌شوند.

import { runAlertSweep, alertTiersOpening, ALERT_TIERS } from "../src/econ/sender.js";
import { listActiveSubscribersPage } from "../src/econ/subscribers.js";
import { etMinutesUntilNow } from "../src/econ/format.js";
import { clearAll } from "../src/cache.js";

let n = 0;
const ok = (c, m, x) => {
  if (!c) { console.log("❌ " + m + (x !== undefined ? " → " + JSON.stringify(x) : "")); process.exitCode = 1; }
  else { console.log("✅ " + m); n++; }
};

// ─── رویدادی که «n دقیقه‌ی دیگر» است ────────────────────────────
//
// همان روشِ dbReads.test.mjs: هر دو حالتِ ساعتِ نیویورک امتحان می‌شود
// تا تست در هیچ فصلی نشکند.
function inMinutes(mins) {
  const target = new Date(Date.now() + mins * 60_000);
  for (const off of [4, 5]) {
    const d = new Date(target.getTime() - off * 3_600_000);
    const date = d.toISOString().slice(0, 10);
    const time = d.toISOString().slice(11, 16);
    if (Math.abs(etMinutesUntilNow(date, time) - mins) <= 1) return { date, time };
  }
  throw new Error("نتوانستم رویدادی در " + mins + " دقیقه‌ی دیگر بسازم");
}

function ev(mins, extra = {}) {
  const { date, time } = inMinutes(mins);
  return {
    event_id: "E" + mins, date, time, event: "Test Event", event_fa: "آزمایشی",
    currency: "USD", importance: "high", forecast: "", previous: "", actual: "",
    status: "scheduled", source: "FF", ...extra,
  };
}

// ─── دیتابیسِ ساختگی که صفحه‌بندی را واقعاً اعمال می‌کند ─────────
//
// اگر cursor و LIMIT را نادیده بگیرد، تست «صفحه‌بندی شد» را نمی‌سنجد
// بلکه فقط «کوئری رفت» را می‌سنجد - و همان اشتباه یک بار واقعاً
// افتاد.
function fakeDb({ events = [], subs = [], config = {}, failSendAt = -1 } = {}) {
  const seen = [];
  const sent = [];
  const claimed = new Set();
  const db = {
    seen, sent, claimed,
    lastSubQuery: null,
    prepare(sql) {
      const st = {
        _a: [],
        bind(...a) { st._a = a; return st; },
        async all() {
          seen.push({ sql, binds: st._a });
          if (/FROM\s+econ_events/i.test(sql)) {
            if (/status\s*=\s*'released'/i.test(sql)) return { results: [] };
            return { results: events };
          }
          if (/FROM\s+econ_labels/i.test(sql)) return { results: [] };
          if (/FROM\s+econ_subscriber/i.test(sql)) {
            db.lastSubQuery = { sql, binds: st._a };
            // ترتیب، نشانگر، تکه و سقف - همه همان‌طور که کوئری خواسته.
            let rows = subs.filter((s) => s.subscribed === 1);
            rows.sort((a, b) =>
              String(a.telegram_user_id).localeCompare(String(b.telegram_user_id))
            );
            const mod = /%\s*(\d+)\s*=\s*(\d+)/.exec(sql);
            if (mod) {
              const of = Number(mod[1]), mine = Number(mod[2]);
              rows = rows.filter((s) => Number(s.telegram_user_id) % of === mine);
            }
            const hasCursor = /telegram_user_id\s*>\s*\?/i.test(sql);
            const binds = st._a.slice();
            const limit = Number(binds[binds.length - 1]);
            if (hasCursor) {
              const after = String(binds[0]);
              rows = rows.filter(
                (s) => String(s.telegram_user_id).localeCompare(after) > 0
              );
            }
            if (Number.isFinite(limit)) rows = rows.slice(0, limit);
            return { results: rows };
          }
          if (/FROM\s+bot_config/i.test(sql)) {
            const key = st._a[0];
            return { results: key in config ? [{ value: config[key] }] : [] };
          }
          return { results: [] };
        },
        async first() {
          seen.push({ sql, binds: st._a });
          if (/FROM\s+bot_config/i.test(sql)) {
            const key = st._a[0];
            return key in config ? { value: config[key] } : null;
          }
          return null;
        },
        async run() {
          seen.push({ sql, binds: st._a });
          if (/INSERT\s+OR\s+IGNORE\s+INTO\s+econ_sent_log/i.test(sql)) {
            const k = st._a.slice(0, 3).join("|");
            if (claimed.has(k)) return { meta: { changes: 0 } };
            claimed.add(k);
            return { meta: { changes: 1 } };
          }
          if (/DELETE\s+FROM\s+econ_sent_log/i.test(sql)) {
            claimed.delete(st._a.slice(0, 3).join("|"));
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return st;
    },
    async batch(list) { return list.map(() => ({ meta: { changes: 0 } })); },
  };
  return db;
}

// تلگرامِ ساختگی. ورکرِ واقعی از fetch استفاده می‌کند، پس همان را
// می‌گیریم - و هر chat_id را ثبت می‌کنیم تا «به چه کسی رفت» سنجیدنی
// باشد.
function installFetch(log, failAfter = Infinity) {
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init && init.body ? init.body : "{}");
    if (log.length >= failAfter) throw new Error("boom");
    log.push(String(body.chat_id));
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
}

function subscriber(id, minutes) {
  return {
    telegram_user_id: String(id), chat_id: String(id), subscribed: 1,
    alert_minutes: minutes, show_low_importance: 0, digest_off: 0,
    currencies: "", alert_levels: "high,medium",
    created_at: "", updated_at: "",
  };
}

const SENDER_ON = { econ_worker_sender: "on" };
// یک روزِ وسطِ هفته لازم است، وگرنه جارو سرِ آخر هفته زود برمی‌گردد.
// چهارشنبه ۳۰ سپتامبر ۲۰۲۶.
const WEEKDAY = new Date("2026-09-30T12:00:00Z");

// ─── ۱) پنجره‌هایی که تازه باز شده‌اند ───────────────────────────
//
// این تعیین می‌کند درِین چند بار در روز راه بیفتد. اگر هر تیکی که
// خبری در یک‌ساعتِ پیشِ رو دارد درِین بزند، روزی حدود هشتاد اجرا
// می‌شود بی‌آنکه یک پیامِ اضافه بفرستد.
ok(ALERT_TIERS.join(",") === "60,30,15,5", "فاصله‌ها همان چهار گزینه‌ی ربات‌اند");

ok(alertTiersOpening([ev(3)]).join(",") === "5", "خبرِ سه‌دقیقه‌ای فقط پنجره‌ی ۵ را باز می‌کند");
ok(alertTiersOpening([ev(13)]).join(",") === "15", "و خبرِ سیزده‌دقیقه‌ای فقط پنجره‌ی ۱۵ را");
ok(alertTiersOpening([ev(58)]).join(",") === "60", "و خبرِ پنجاه‌وهشت‌دقیقه‌ای فقط ۶۰ را");
ok(alertTiersOpening([ev(40)]).length === 0, "خبرِ چهل‌دقیقه‌ای هیچ پنجره‌ای را تازه باز نمی‌کند");
ok(alertTiersOpening([ev(-5)]).length === 0, "و خبرِ گذشته هم نه");
ok(
  alertTiersOpening([ev(3, { importance: "low" })]).length === 0,
  "کم‌اهمیت درِینِ موازی راه نمی‌اندازد - بیست نفرش را کرانِ خودِ ورکر می‌رساند"
);
ok(
  alertTiersOpening([ev(3, { status: "released" })]).length === 0,
  "خبرِ منتشرشده هم نه"
);
ok(
  alertTiersOpening([ev(3), ev(58)]).sort().join(",") === "5,60",
  "دو خبر در دو بازه، دو پنجره",
  alertTiersOpening([ev(3), ev(58)])
);
ok(alertTiersOpening([]).length === 0, "و روزِ خالی هیچ اجرایی نمی‌سازد");

// ─── ۲) خودِ کوئریِ صفحه‌بندی ────────────────────────────────────
{
  const db = fakeDb({ subs: [subscriber(10, 15)] });
  await listActiveSubscribersPage({ DB: db }, 120, { of: 6, index: 2 }, "5");
  const q = db.lastSubQuery;
  ok(/ORDER\s+BY\s+s\.telegram_user_id/i.test(q.sql),
     "صفحه ترتیبِ ثابت دارد - وگرنه نشانگر معنایی ندارد");
  ok(/telegram_user_id\s*>\s*\?/i.test(q.sql),
     "و نشانگر روی کلیدِ اصلی می‌نشیند، نه با CAST");
  ok(/%\s*6\s*=\s*2/.test(q.sql), "تکه‌بندی داخلِ کوئری است");
  ok(q.binds[0] === "5" && q.binds[1] === 120, "با همان نشانگر و سقفی که خواسته شد", q.binds);
}
{
  const db = fakeDb({ subs: [subscriber(10, 15)] });
  await listActiveSubscribersPage({ DB: db }, 50, null, null);
  const q = db.lastSubQuery;
  ok(!/telegram_user_id\s*>\s*\?/i.test(q.sql), "دورِ اول شرطِ نشانگر ندارد");
  ok(!/%/.test(q.sql), "و بی‌شارد، شرطِ تکه هم ندارد");
}

// ─── ۳) نشانگر از بی‌موعدها هم جلو می‌رود ───────────────────────
//
// این ادعای اصلیِ این فایل است. خبر پنجاه‌وهشت دقیقه‌ی دیگر است، پس
// فقط مشترکِ ۶۰ دقیقه‌ای موعدش رسیده. اگر نشانگر فقط روی فرستاده‌ها
// جلو برود، دورِ دوم همان صفحه را می‌خواند و هیچ‌وقت جلو نمی‌رود.
clearAll();
{
  const subs = [];
  for (let i = 1; i <= 200; i++) subs.push(subscriber(1000 + i, i === 200 ? 60 : 15));
  const log = [];
  installFetch(log);
  const db = fakeDb({ events: [ev(58)], subs, config: SENDER_ON });
  const env = { DB: db, BOT_TOKEN: "x" };

  const r1 = await runAlertSweep(env, WEEKDAY, null, "");
  ok(r1.page === 120, "دورِ اول یک صفحه‌ی کامل برداشت", r1);
  ok(r1.sent === 0, "و هیچ‌کس در آن صفحه موعدش نبود", r1);
  ok(r1.cursor === "1120", "ولی نشانگر تا آخرِ همان صفحه جلو رفت", r1);
  ok(r1.done !== true, "و «تمام شد» نگفت", r1);

  const r2 = await runAlertSweep(env, WEEKDAY, null, r1.cursor);
  ok(r2.sent === 1, "دورِ دوم به مشترکِ ۶۰ دقیقه‌ای رسید", r2);
  ok(log.join(",") === "1200", "و پیام واقعاً به همان نفر رفت", log);
  ok(r2.done === true, "و چون صفحه کوتاه بود، تمام شد", r2);
}

// ─── ۴) ولی از کسی که بودجه نرسیده جلو نمی‌رود ──────────────────
//
// بودجه ۴۵ است. پنجاه مشترکِ موعد‌رسیده یعنی پنج نفر باید برای دورِ
// بعد بمانند - و نشانگر باید دقیقاً روی چهل‌وپنجمی بایستد.
clearAll();
{
  const subs = [];
  for (let i = 1; i <= 50; i++) subs.push(subscriber(2000 + i, 60));
  const log = [];
  installFetch(log);
  const db = fakeDb({ events: [ev(58)], subs, config: SENDER_ON });
  const env = { DB: db, BOT_TOKEN: "x" };

  const r1 = await runAlertSweep(env, WEEKDAY, null, "");
  ok(r1.sent === 45, "بودجه‌ی یک دور ۴۵ پیام است", r1);
  ok(r1.throttled === true, "و دور با بودجه‌ی تمام‌شده می‌ایستد", r1);
  ok(r1.done !== true, "پس «تمام شد» نمی‌گوید", r1);
  ok(r1.cursor === "2045", "نشانگر روی آخرین نفرِ فرستاده‌شده است، نه جلوتر", r1);

  const r2 = await runAlertSweep(env, WEEKDAY, null, r1.cursor);
  ok(r2.sent === 5, "دورِ دوم همان پنج نفرِ جامانده را می‌فرستد", r2);
  ok(new Set(log).size === 50, "و در کلِ دو دور، هر پنجاه نفر دقیقاً یک پیام", log.length);
  ok(r2.done === true, "و حالا تمام شد", r2);
}

// ─── ۵) شکستِ ارسال نفرِ قربانی را نمی‌سوزاند ───────────────────
//
// اگر fetch بترکد، claim پس گرفته می‌شود. نشانگر هم نباید از آن نفر
// بگذرد، وگرنه آن یک نفر برای همیشه رد می‌شود.
clearAll();
{
  const subs = [];
  for (let i = 1; i <= 10; i++) subs.push(subscriber(3000 + i, 60));
  const log = [];
  installFetch(log, 3);
  const db = fakeDb({ events: [ev(58)], subs, config: SENDER_ON });
  const env = { DB: db, BOT_TOKEN: "x" };

  const r = await runAlertSweep(env, WEEKDAY, null, "");
  ok(r.sent === 3, "سه نفر پیش از ترکیدن پیام گرفتند", r);
  ok(r.cursor === "3003", "و نشانگر روی همان سومی ایستاد - نه چهارمی", r);
  ok(db.claimed.size === 3, "claimِ نفرِ چهارم پس گرفته شد", db.claimed.size);
}

// ─── ۶) تکه‌بندی: شش کارگر، هیچ‌کس دو بار ────────────────────────
clearAll();
{
  const subs = [];
  for (let i = 0; i < 60; i++) subs.push(subscriber(4000 + i, 60));
  const log = [];
  installFetch(log);
  const db = fakeDb({ events: [ev(58)], subs, config: SENDER_ON });
  const env = { DB: db, BOT_TOKEN: "x" };

  let total = 0;
  for (let w = 0; w < 6; w++) {
    let after = null;
    for (let round = 0; round < 10; round++) {
      const r = await runAlertSweep(env, WEEKDAY, { of: 6, index: w }, after);
      total += r.sent || 0;
      if (r.done === true || !r.cursor) break;
      after = r.cursor;
    }
  }
  ok(total === 60, "شش کارگر با هم کلِ شصت نفر را پوشاندند", total);
  ok(new Set(log).size === 60, "و هیچ‌کس دو پیام نگرفت", log.length);
}

// ─── ۷) رفتارِ قدیمی دست‌نخورده ─────────────────────────────────
//
// کرانِ خودِ ورکر بی‌شارد و بی‌نشانگر صدا می‌زند و باید همان کارِ قبلی
// را بکند: از اولِ فهرست، تا سقفِ بودجه، بی‌هیچ نشانگری در پاسخ.
clearAll();
{
  const subs = [subscriber(5001, 60), subscriber(5002, 60)];
  const log = [];
  installFetch(log);
  const db = fakeDb({ events: [ev(58)], subs, config: SENDER_ON });
  const r = await runAlertSweep({ DB: db, BOT_TOKEN: "x" }, WEEKDAY);
  ok(r.sent === 2, "اجرای بی‌شارد همان‌طور می‌فرستد", r);
  ok(r.cursor === undefined, "و نشانگری برنمی‌گرداند - پس ورک‌فلو اشتباهی ادامه نمی‌دهد", r);
  ok(r.done === undefined, "و «تمام شد» هم نمی‌گوید", r);
}

// ─── ۸) دروازه‌ها بر صفحه‌بندی مقدم‌اند ─────────────────────────
clearAll();
{
  const db = fakeDb({ events: [ev(58)], subs: [subscriber(6001, 60)], config: { econ_worker_sender: "off" } });
  const r = await runAlertSweep({ DB: db, BOT_TOKEN: "x" }, WEEKDAY, null, "");
  ok(r.skipped === "خاموش", "کلیدِ خاموش جلوی درِین را هم می‌گیرد", r);
  ok(r.cursor === undefined, "و نشانگری نمی‌دهد که ورک‌فلو بچرخد", r);
}
clearAll();
{
  // شنبه.
  const db = fakeDb({ events: [ev(58)], subs: [subscriber(6002, 60)], config: SENDER_ON });
  const r = await runAlertSweep({ DB: db, BOT_TOKEN: "x" }, new Date("2026-10-03T12:00:00Z"), null, "");
  ok(r.skipped === "آخر هفته", "آخر هفته هم همین‌طور", r);
}
clearAll();
{
  // خبر هست ولی شش ساعت دیگر: جدولِ مشترکین نباید لمس شود.
  const db = fakeDb({ events: [ev(360)], subs: [subscriber(6003, 60)], config: SENDER_ON });
  const r = await runAlertSweep({ DB: db, BOT_TOKEN: "x" }, WEEKDAY, null, "");
  const touched = db.seen.filter((q) => /FROM\s+econ_subscriber/i.test(q.sql)).length;
  ok(touched === 0, "دروازه‌ی «چیزی در راه نیست» پیش از صفحه‌بندی است", touched);
  ok(r.cursor === undefined, "و نشانگری برنمی‌گردد", r);
}


// ─── ۹) اجرای خشک: می‌شمارد، نمی‌فرستد ─────────────────────────
//
// برای این هست که بشود صفحه‌بندی را روی جدولِ واقعیِ پروداکشن امتحان
// کرد بی‌آنکه منتظرِ یک خبرِ واقعی ماند. پس دو ادعا دارد، و دومی
// مهم‌ترِش است: نباید هیچ‌چیز بفرستد.
clearAll();
{
  const subs = [];
  for (let i = 1; i <= 10; i++) subs.push(subscriber(7000 + i, 60));
  const log = [];
  installFetch(log);
  // خبر شش ساعت دیگر است، پس دروازه‌ی «چیزی در راه نیست» بسته است -
  // و اجرای خشک باید از همان دروازه رد شود، وگرنه چیزی را نمی‌سنجد.
  const db = fakeDb({ events: [ev(360)], subs, config: SENDER_ON });
  const r = await runAlertSweep({ DB: db, BOT_TOKEN: "x" }, WEEKDAY, null, "", true);
  ok(r.dry === true, "اجرای خشک خودش را اعلام می‌کند", r);
  ok(r.looked === 10, "و کلِ صفحه را پیمود - پس از دروازه رد شد", r);
  ok(r.cursor === "7010", "نشانگر تا آخرِ صفحه جلو رفت", r);
  ok(r.sent === 0 && log.length === 0, "و هیچ پیامی نرفت", { sent: r.sent, fetches: log.length });
  ok(db.claimed.size === 0, "و هیچ claimی ثبت نشد - هیچ نوشتنی", db.claimed.size);
  ok(r.would_send === 0, "و چون خبری در بازه نبود، کسی هم موعدش نبود", r);
}
clearAll();
{
  // همان، ولی با خبری که واقعاً در بازه است: باید بگوید چند نفر
  // می‌گرفتند، و باز هم نفرستد.
  const subs = [];
  for (let i = 1; i <= 10; i++) subs.push(subscriber(8000 + i, 60));
  const log = [];
  installFetch(log);
  const db = fakeDb({ events: [ev(58)], subs, config: SENDER_ON });
  const r = await runAlertSweep({ DB: db, BOT_TOKEN: "x" }, WEEKDAY, null, "", true);
  ok(r.would_send === 10, "می‌گوید ده نفر موعدشان بود", r);
  ok(log.length === 0 && db.claimed.size === 0, "ولی باز هم نه پیامی و نه claimی", log.length);
}

console.log("\n" + n + " ادعا");
