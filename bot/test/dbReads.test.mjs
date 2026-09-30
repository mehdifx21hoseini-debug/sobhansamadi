// کم کردنِ ردیف‌خوانیِ D1.
//
// ─── چرا این فایل هست ─────────────────────────────────────────────
//
// اندازه‌گیریِ ۲۸ سپتامبر: روزی حدود ۲۴ میلیون ردیف‌خوانی، در حالی که
// سقفِ پلنِ رایگان ۵ میلیون است. تقریباً همه‌اش از یک جا می‌آمد -
// readEvents کلِ جدولِ تقویم را بی‌هیچ WHERE می‌خواند، و آن جدول با
// نگه‌داریِ ۶۰ روزه چند هزار ردیف دارد.
//
// دو تغییر: خواندنِ بازه‌ای به‌جای کلِ جدول، و نخواندنِ جدولِ مشترکین
// وقتی هیچ خبری در راه نیست.
//
// ─── و چرا تست لازم دارد ──────────────────────────────────────────
//
// هر دو تغییر می‌توانند «موفق» به نظر برسند و در عمل هشدارها را خفه
// کنند: بازه‌ی خیلی تنگ یعنی خبر پیدا نمی‌شود، و دروازه‌ی «چیزی در راه
// نیست» اگر اشتباه بگوید یعنی هیچ‌وقت کسی هشدار نمی‌گیرد. از بیرون هر
// دو دقیقاً شبیه «امروز خبری نبود» دیده می‌شوند.
//
// پس هر ادعای «کمتر خواند» یک ادعای جفتِ «ولی هنوز می‌فرستد» دارد.

import { readEventsRange, readReleasedByNames, dayOffset } from "../src/econ/store.js";
import { runAlertSweep } from "../src/econ/sender.js";
import { etMinutesUntilNow } from "../src/econ/format.js";
import { clearAll } from "../src/cache.js";

let n = 0;
const ok = (c, m, x) => {
  if (!c) { console.log("❌ " + m + (x !== undefined ? " → " + JSON.stringify(x) : "")); process.exitCode = 1; }
  else { console.log("✅ " + m); n++; }
};

// ─── دیتابیسِ ساختگی که هر کوئری را ثبت می‌کند ──────────────────
//
// چیزی که می‌سنجیم «چند ردیف خوانده شد» نیست - آن را فقط پروداکشن
// می‌داند - بلکه «کدام جدول‌ها اصلاً لمس شدند» و «کوئری WHERE داشت یا
// نه». همین دو تا کلِ این تغییر را پوشش می‌دهند.
function fakeDb({ events = [], labels = [], subs = [], config = {} } = {}) {
  const seen = [];
  const db = {
    seen,
    touched: (table) => seen.filter((q) => new RegExp(table, "i").test(q.sql)).length,
    prepare(sql) {
      const st = {
        _a: [],
        bind(...a) { st._a = a; return st; },
        async all() {
          seen.push({ sql, binds: st._a });
          if (/FROM\s+econ_events/i.test(sql)) {
            if (/status\s*=\s*'released'/i.test(sql)) return { results: [] };
            // بازه را واقعاً اعمال می‌کند، وگرنه تست «فیلتر شد» را
            // نمی‌سنجد بلکه فقط «کوئری رفت» را می‌سنجد.
            const [from, to] = st._a;
            const rows = from && to
              ? events.filter((e) => e.date >= from && e.date <= to)
              : events;
            return { results: rows };
          }
          if (/FROM\s+econ_labels/i.test(sql)) return { results: labels };
          if (/FROM\s+econ_subscriber/i.test(sql)) return { results: subs };
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
        async run() { seen.push({ sql, binds: st._a }); return { meta: { changes: 0 } }; },
      };
      return st;
    },
    async batch(list) { return list.map(() => ({ meta: { changes: 0 } })); },
  };
  return db;
}

// رویدادی که «n دقیقه‌ی دیگر» است. همان روشِ alertLevels.test.mjs:
// هر دو حالتِ ساعتِ نیویورک امتحان می‌شود تا تست در هیچ فصلی نشکند.
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

// ─── ۱) خواندنِ بازه‌ای ──────────────────────────────────────────
clearAll();
{
  const db = fakeDb({ events: [] });
  await readEventsRange({ DB: db }, "2026-09-01", "2026-09-03");
  const q = db.seen.find((x) => /FROM\s+econ_events/i.test(x.sql));
  ok(!!q, "بازه‌خوانی به جدولِ رویدادها می‌زند");
  ok(/WHERE\s+date\s*>=\s*\?\s*AND\s+date\s*<=\s*\?/i.test(q.sql),
     "و کوئری واقعاً WHERE روی تاریخ دارد - نه اسکنِ کامل");
  ok(q.binds[0] === "2026-09-01" && q.binds[1] === "2026-09-03",
     "با همان دو تاریخی که خواسته شده", q.binds);
}

// کشِ هر بازه جداست، وگرنه «امروز» و «این هفته» یکدیگر را خراب می‌کنند.
clearAll();
{
  const db = fakeDb({ events: [] });
  const env = { DB: db };
  await readEventsRange(env, "2026-09-01", "2026-09-03");
  await readEventsRange(env, "2026-09-01", "2026-09-03");
  ok(db.touched("econ_events") === 1, "بازه‌ی تکراری از کش می‌آید", db.touched("econ_events"));
  await readEventsRange(env, "2026-09-01", "2026-09-10");
  ok(db.touched("econ_events") === 2, "ولی بازه‌ی دیگر کشِ خودش را دارد", db.touched("econ_events"));
}

// dayOffset باید همان شکلی باشد که ستونِ date دارد.
ok(/^\d{4}-\d{2}-\d{2}$/.test(dayOffset(0)), "dayOffset شکلِ YYYY-MM-DD می‌دهد");
ok(dayOffset(1) > dayOffset(0) && dayOffset(-1) < dayOffset(0), "و جهتش درست است");

// ─── ۲) تاریخچه فقط برای نام‌های روی صفحه ───────────────────────
clearAll();
{
  const db = fakeDb();
  const out = await readReleasedByNames({ DB: db }, []);
  ok(out.length === 0 && db.touched("econ_events") === 0,
     "فهرستِ خالیِ نام، هیچ کوئری‌ای نمی‌زند");
}
clearAll();
{
  const db = fakeDb();
  await readReleasedByNames({ DB: db }, ["A", "B", "A"]);
  const q = db.seen.find((x) => /FROM\s+econ_events/i.test(x.sql));
  ok(/event\s+IN\s*\(/i.test(q.sql), "تاریخچه با IN روی نام می‌پرسد، نه اسکنِ کامل");
  ok(q.binds.length === 2, "و نامِ تکراری یک بار می‌رود", q.binds);
}

// ─── ۳) دروازه‌ی «چیزی در راه نیست» ─────────────────────────────
//
// نصفِ مهمِ این بخش ادعای دوم است: وقتی خبری هست، باید برود.
const SENDER_ON = { econ_worker_sender: "on" };
// یک روزِ وسطِ هفته، وگرنه runAlertSweep سرِ آخر هفته زود برمی‌گردد و
// تست چیزی را نمی‌سنجد.
const WEEKDAY = new Date("2026-09-30T12:00:00Z");

clearAll();
{
  // خبر هست، ولی نه در بازه‌ی هشدار: شش ساعت دیگر.
  const db = fakeDb({ events: [ev(360)], config: SENDER_ON });
  await runAlertSweep({ DB: db, BOT_TOKEN: "x" }, WEEKDAY);
  ok(db.touched("econ_subscriber") === 0,
     "وقتی خبری در بازه‌ی هشدار نیست، جدولِ مشترکین اصلاً خوانده نمی‌شود",
     db.touched("econ_subscriber"));
}

clearAll();
{
  // هیچ خبری نیست.
  const db = fakeDb({ events: [], config: SENDER_ON });
  await runAlertSweep({ DB: db, BOT_TOKEN: "x" }, WEEKDAY);
  ok(db.touched("econ_subscriber") === 0, "روزِ خالی هم همین‌طور");
}

clearAll();
{
  // خبرِ ده دقیقه‌ی دیگر: حالا باید سراغِ مشترکین برود.
  const db = fakeDb({ events: [ev(10)], config: SENDER_ON });
  await runAlertSweep({ DB: db, BOT_TOKEN: "x" }, WEEKDAY);
  ok(db.touched("econ_subscriber") > 0,
     "ولی وقتی خبری در راه است، مشترکین خوانده می‌شوند - دروازه هشدار را خفه نمی‌کند");
}

clearAll();
{
  // درست روی لبه‌ی شصت دقیقه، بلندترین گزینه‌ای که کاربر دارد.
  const db = fakeDb({ events: [ev(58)], config: SENDER_ON });
  await runAlertSweep({ DB: db, BOT_TOKEN: "x" }, WEEKDAY);
  ok(db.touched("econ_subscriber") > 0, "خبرِ ۵۸ دقیقه‌ای هم داخلِ بازه است");
}

clearAll();
{
  // خبرِ منتشرشده هشدار ندارد، پس نباید دروازه را باز کند.
  const db = fakeDb({ events: [ev(10, { status: "released", actual: "1.2" })], config: SENDER_ON });
  await runAlertSweep({ DB: db, BOT_TOKEN: "x" }, WEEKDAY);
  ok(db.touched("econ_subscriber") === 0, "خبرِ منتشرشده دروازه را باز نمی‌کند");
}

// ─── ۴) بازه‌ای که خودِ جاروی هشدار می‌خواهد ───────────────────
clearAll();
{
  const db = fakeDb({ events: [ev(10)], config: SENDER_ON });
  await runAlertSweep({ DB: db, BOT_TOKEN: "x" }, WEEKDAY);
  const q = db.seen.find((x) => /FROM\s+econ_events/i.test(x.sql));
  ok(q && q.binds.length === 2, "جاروی هشدار هم بازه‌ای می‌خواند");
  ok(q.binds[0] === dayOffset(-1) && q.binds[1] === dayOffset(1),
     "و بازه‌اش سه روز است - یک روز حاشیه برای اختلافِ نیویورک و UTC",
     q.binds);
}

console.log("\n" + n + " ادعا");
