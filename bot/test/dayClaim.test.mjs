// «این پیامِ روزانه برای این نفر رفته» - روی ردیفِ خودش، نه ردیفِ دفتر.
//
// ─── چرا این تغییر ────────────────────────────────────────────────
//
// سقفِ نوشتنِ پلنِ رایگانِ D1 صد هزار ردیف در روز است. اندازه‌گیریِ
// ۸ اکتبر ۱۳۶٬۳۱۹ بود - روزی که پیامِ همگانیِ موسیقی رفت - و روزهای
// عادی ۶۳ تا ۸۶ هزار، یعنی بی‌حاشیه.
//
// چهار پیام یک خاصیتِ مشترک دارند: هر نفر در هر روز دقیقاً یکی، و
// کلیدشان تاریخ است. تا امروز هر کدام یک ردیف در econ_sent_log
// می‌نوشت - یک نوشتن سرِ ارسال، و یک نوشتنِ دیگر سی روز بعد وقتی
// پاک‌سازی سراغش می‌رفت. با ستون، همان تضمین با یک نوشتن و بی‌هیچ
// حذفی به‌دست می‌آید.
//
// ─── و چرا تست لازم دارد ──────────────────────────────────────────
//
// این همان چیزی است که تضمین می‌کند هیچ‌کس یک پیام را دو بار نمی‌گیرد،
// و اشتباهش را پانزده هزار نفر هم‌زمان می‌بینند. سه خرابیِ ممکن:
//
//   • ثبت کار نکند → همه هر دور دوباره پیام بگیرند.
//   • ثبت زیادی کار کند → کسی که پیامش نرفته «گرفته» علامت بخورد.
//   • روزِ جابه‌جایی، مرجعِ قدیمی نادیده گرفته شود → هر کسی که پیامِ
//     امروز را از راهِ قبلی گرفته، همان روز دوباره بگیرد.
//
// سومی خطرناک‌ترین است چون فقط یک بار و فقط در یک روز اتفاق می‌افتد،
// و تا اتفاق بیفتد هیچ نشانه‌ای ندارد.

import {
  dayColumn,
  claimDay,
  unclaimDay,
  listPendingAudience,
  DAY_CLAIM_FROM,
} from "../src/econ/subscribers.js";
import { changedRows } from "../src/econ/ingest.js";

let n = 0;
const ok = (c, m, x) => {
  if (!c) { console.log("❌ " + m + (x !== undefined ? " → " + JSON.stringify(x) : "")); process.exitCode = 1; }
  else { console.log("✅ " + m); n++; }
};

// ─── دیتابیسِ ساختگی ────────────────────────────────────────────
//
// ردیف‌های user_state را واقعاً نگه می‌دارد و UPDATE را واقعاً اعمال
// می‌کند - وگرنه «ثبت اتمیک است» سنجیده نمی‌شود، فقط «کوئری رفت».
function fakeDb(users = [], sentLog = []) {
  const seen = [];
  const rows = users.map((u) => ({
    telegram_user_id: String(u.id),
    blocked_at: u.blocked || null,
    sent_digest: u.sent_digest || null,
    sent_notice: u.sent_notice || null,
    sent_greet: null,
    sent_holiday: null,
  }));
  const log = new Set(sentLog.map((r) => r.join("|")));
  const db = {
    seen, rows, log,
    writes: 0,
    lastSql: null,
    prepare(sql) {
      const st = {
        _a: [],
        bind(...a) { st._a = a; return st; },
        async all() {
          seen.push({ sql, binds: st._a });
          db.lastSql = sql;
          if (/FROM\s+user_state/i.test(sql)) {
            let out = rows.filter((r) => r.blocked_at === null);
            const mod = /%\s*(\d+)\s*=\s*(\d+)/.exec(sql);
            if (mod) {
              const of = Number(mod[1]), mine = Number(mod[2]);
              out = out.filter((r) => Number(r.telegram_user_id) % of === mine);
            }
            const binds = st._a.slice();
            if (/telegram_user_id\s*>\s*\?/i.test(sql)) {
              const after = String(binds.shift());
              out = out.filter((r) => r.telegram_user_id.localeCompare(after) > 0);
            }
            // شرطِ ستون، یا شرطِ دفترِ قدیمی - هرکدام که در SQL آمده.
            const colM = /u\.(sent_\w+)\s+IS\s+NULL/i.exec(sql);
            if (colM) {
              const col = colM[1];
              const ref = String(binds.shift());
              out = out.filter((r) => r[col] === null || r[col] !== ref);
            } else if (/econ_sent_log/i.test(sql)) {
              const kind = String(binds.shift());
              const ref = String(binds.shift());
              out = out.filter((r) => !log.has([kind, ref, r.telegram_user_id].join("|")));
            }
            out.sort((a, b) => a.telegram_user_id.localeCompare(b.telegram_user_id));
            const limit = Number(binds.shift());
            if (Number.isFinite(limit)) out = out.slice(0, limit);
            return {
              results: out.map((r) => ({
                telegram_user_id: r.telegram_user_id,
                chat_id: r.telegram_user_id,
              })),
            };
          }
          return { results: [] };
        },
        async first() { seen.push({ sql, binds: st._a }); return null; },
        async run() {
          seen.push({ sql, binds: st._a });
          db.lastSql = sql;
          const m = /SET\s+(sent_\w+)\s*=/i.exec(sql);
          if (m && /UPDATE\s+user_state/i.test(sql)) {
            const col = m[1];
            const toNull = /=\s*NULL/i.test(sql);
            let changes = 0;
            if (toNull) {
              const [id, ref] = st._a;
              for (const r of rows) {
                if (r.telegram_user_id === String(id) && r[col] === String(ref)) {
                  r[col] = null; changes++;
                }
              }
            } else {
              const [ref, id] = st._a;
              for (const r of rows) {
                if (r.telegram_user_id === String(id) && r[col] !== String(ref)) {
                  r[col] = String(ref); changes++;
                }
              }
            }
            db.writes += changes;
            return { meta: { changes } };
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

const AFTER = "2026-10-09";  // بعد از روزِ جابه‌جایی
const BEFORE = "2026-10-07"; // قبلش

// ─── ۱) مرزِ جابه‌جایی ──────────────────────────────────────────
ok(DAY_CLAIM_FROM === "2026-10-08", "روزِ جابه‌جایی همان است که در کد نوشته شده", DAY_CLAIM_FROM);
ok(dayColumn("digest", AFTER) === "sent_digest", "خلاصه‌ی فردا از ستون می‌آید");
ok(dayColumn("notice", AFTER) === "sent_notice", "اطلاعیه هم");
ok(dayColumn("greet", AFTER) === "sent_greet", "و سلام");
ok(dayColumn("holiday", AFTER) === "sent_holiday", "و اعلانِ تعطیلی");
ok(dayColumn("digest", BEFORE) === null, "ولی تاریخِ قبلِ جابه‌جایی مرجعش دفترِ قدیمی است");
ok(dayColumn("digest", DAY_CLAIM_FROM) === null, "خودِ روزِ جابه‌جایی هم دفترِ قدیمی");
ok(dayColumn("alert", AFTER) === null, "هشدار ستون ندارد - هر نفر در یک روز چند خبر می‌گیرد");
ok(dayColumn("result", AFTER) === null, "اعلامِ نتیجه هم نه");
ok(dayColumn("چیزِ ناشناس", AFTER) === null, "و نوعِ ناشناس هیچ ستونی نمی‌سازد");

// ─── ۲) ثبت: یک بار بله، دفعه‌ی دوم نه ─────────────────────────
{
  const db = fakeDb([{ id: "100" }]);
  const env = { DB: db };
  const first = await claimDay(env, "sent_digest", AFTER, "100");
  const second = await claimDay(env, "sent_digest", AFTER, "100");
  ok(first === true, "اولین ثبت برنده می‌شود");
  ok(second === false, "دومین ثبتِ همان ref بازنده - پس پیام دو بار نمی‌رود");
  ok(db.writes === 1, "و فقط یک نوشتن انجام شد، نه دو", db.writes);
}

// روزِ بعد همان ستون دوباره قابلِ ثبت است - وگرنه فردا هیچ‌کس خلاصه
// نمی‌گرفت و از بیرون شبیهِ «ربات خراب شد» می‌شد.
{
  const db = fakeDb([{ id: "100", sent_digest: "2026-10-09" }]);
  const r = await claimDay({ DB: db }, "sent_digest", "2026-10-10", "100");
  ok(r === true, "ثبتِ روزِ بعد روی همان ستون انجام می‌شود");
  ok(db.rows[0].sent_digest === "2026-10-10", "و ستون تاریخِ تازه را دارد", db.rows[0]);
  ok(db.writes === 1, "باز هم یک نوشتن، و هیچ حذفی", db.writes);
}

// ─── ۳) پس گرفتن: فقط چیزی که خودمان نوشتیم ───────────────────
{
  const db = fakeDb([{ id: "100" }]);
  const env = { DB: db };
  await claimDay(env, "sent_digest", AFTER, "100");
  await unclaimDay(env, "sent_digest", AFTER, "100");
  ok(db.rows[0].sent_digest === null, "پس گرفتن ستون را خالی می‌کند");
  const again = await claimDay(env, "sent_digest", AFTER, "100");
  ok(again === true, "پس دورِ بعد دوباره سراغش می‌رود - پیامش گم نمی‌شود");
}
{
  // ثبتِ یک رفِ دیگر نباید با پس‌گرفتنِ این یکی پاک شود.
  const db = fakeDb([{ id: "100", sent_digest: "2026-10-11" }]);
  await unclaimDay({ DB: db }, "sent_digest", AFTER, "100");
  ok(db.rows[0].sent_digest === "2026-10-11", "پس گرفتنِ یک ref، ثبتِ ref دیگر را پاک نمی‌کند", db.rows[0]);
}

// ─── ۴) فهرستِ مخاطب: ستون واقعاً فیلتر می‌کند ─────────────────
{
  const db = fakeDb([
    { id: "100" },
    { id: "200", sent_digest: AFTER },   // گرفته
    { id: "300", sent_digest: BEFORE },  // دیروز گرفته، امروز نه
    { id: "400", blocked: "2026-01-01" },
  ]);
  const rows = await listPendingAudience({ DB: db }, "digest", AFTER, 45, null, null);
  const ids = rows.map((r) => r.telegram_user_id).sort();
  ok(ids.join(",") === "100,300", "فقط کسانی که خلاصه‌ی امروز را نگرفته‌اند", ids);
  ok(!/econ_sent_log/i.test(db.lastSql), "و کوئری دیگر به دفترِ ارسال نمی‌زند - زیرکوئری رفت");
  ok(/u\.sent_digest\s+IS\s+NULL/i.test(db.lastSql), "به‌جایش ستونِ همان ردیف را می‌خواند");
}

// ─── ۵) روزِ جابه‌جایی: مرجعِ قدیمی نادیده گرفته نمی‌شود ───────
//
// خطرناک‌ترین حالتِ این تغییر. برای تاریخِ قبلِ جابه‌جایی، کوئری باید
// همان دفترِ قدیمی را ببیند - وگرنه هر کسی که آن روز پیام گرفته بود
// دوباره می‌گرفت.
{
  const db = fakeDb(
    [{ id: "100" }, { id: "200" }],
    [["digest", BEFORE, "200"]]
  );
  const rows = await listPendingAudience({ DB: db }, "digest", BEFORE, 45, null, null);
  const ids = rows.map((r) => r.telegram_user_id);
  ok(ids.join(",") === "100", "تاریخِ قبلِ جابه‌جایی از دفترِ قدیمی خوانده می‌شود", ids);
  ok(/econ_sent_log/i.test(db.lastSql), "یعنی زیرکوئریِ قدیمی سرِ جایش است");
}

// و برعکسش هم باید درست باشد: ردیفِ قدیمیِ دفتر نباید جلوی پیامِ
// فردا را بگیرد.
{
  const db = fakeDb([{ id: "100" }], [["digest", BEFORE, "100"]]);
  const rows = await listPendingAudience({ DB: db }, "digest", AFTER, 45, null, null);
  ok(rows.length === 1, "ردیفِ دیروزِ دفتر جلوی خلاصه‌ی فردا را نمی‌گیرد", rows);
}

// ─── ۶) نشانگر و تکه‌بندی کنارِ ستون کار می‌کنند ───────────────
{
  const db = fakeDb([{ id: "100" }, { id: "200" }, { id: "300" }]);
  const rows = await listPendingAudience({ DB: db }, "digest", AFTER, 45, null, "100");
  ok(rows.map((r) => r.telegram_user_id).join(",") === "200,300", "نشانگر با ستون هم کار می‌کند", rows);
}
{
  const db = fakeDb([{ id: "12" }, { id: "13" }, { id: "18" }]);
  const rows = await listPendingAudience({ DB: db }, "digest", AFTER, 45, { of: 6, index: 0 }, null);
  ok(rows.map((r) => r.telegram_user_id).join(",") === "12,18", "تکه‌بندی هم", rows);
}

// ─── ۷) تقویم: فقط تغییرها نوشته می‌شوند ──────────────────────
//
// این ساعتی اجرا می‌شود و هر بار همه‌ی ~۵۱۱ رویداد را بازنویسی می‌کرد:
// روزی ۱۲٬۳۰۰ نوشتن، در حالی که ساعت به ساعت تقریباً هیچ‌چیز عوض
// نمی‌شود.
const base = {
  event_id: "E1", date: "2026-10-09", time: "13:30", event: "CPI",
  currency: "USD", importance: "high", forecast: "0.2", previous: "0.1",
  actual: "", status: "scheduled", last_updated: "2026-10-09T10:00:00Z",
};
ok(changedRows([base], [{ ...base }]).length === 0, "ردیفِ بی‌تغییر نوشته نمی‌شود");
ok(changedRows([base], []).length === 1, "ردیفِ تازه نوشته می‌شود");
ok(
  changedRows([{ ...base, actual: "0.3" }], [{ ...base }]).length === 1,
  "عددِ واقعیِ تازه نوشته می‌شود"
);
ok(
  changedRows([{ ...base, time: "14:00" }], [{ ...base }]).length === 1,
  "جابه‌جاییِ ساعت هم"
);
ok(
  changedRows([{ ...base, last_updated: "2026-10-09T23:00:00Z" }], [{ ...base }]).length === 0,
  "ولی جلو رفتنِ last_updated به‌تنهایی تغییر نیست - وگرنه هیچ صرفه‌ای نمی‌ماند"
);
// فید رشته‌ی خالی می‌دهد و دیتابیس NULL نگه می‌دارد. بی‌یکسان‌سازی، هر
// ردیفِ بی‌مقدار هر ساعت «عوض شده» حساب می‌شد.
ok(
  changedRows([{ ...base, actual: "" }], [{ ...base, actual: null }]).length === 0,
  "رشته‌ی خالی و NULL یکی حساب می‌شوند"
);
ok(
  changedRows([{ ...base, forecast: "" }], [{ ...base, forecast: undefined }]).length === 0,
  "و undefined هم همین‌طور"
);

console.log("\n" + n + " ادعا");
