// پنجره‌ی ارسالِ خلاصه‌ی روزانه.
//
// ─── باگی که این فایل برایش نوشته شد ─────────────────────────────
//
// یک عضو گزارش داد که خلاصه را ۰۱:۳۰ بامداد می‌گیرد، با سرتیترِ
// **دیروز** - در حالی که برای آکادمی پیش از ۸ صبح می‌آمد.
//
// علتش یک شرطِ جاافتاده بود. شناسه‌ی یکتاییِ خلاصه تاریخِ تهران است و
// تاریخِ تهران سرِ نیمه‌شب عوض می‌شود. درِینِ هر پنج دقیقه فقط می‌پرسید
// «خلاصه‌ی این ref تمام شده؟» - و سرِ ۰۰:۰۰ جوابْ نه بود، چون ref تازه
// بود. پس ارسال از نیمه‌شب راه می‌افتاد و تا صبح چند هزار نفر را
// می‌گرفت.
//
// سلامِ دوشنبه و اطلاعیه هر دو از اول `hhmm < "08:00"` داشتند؛ فقط
// خودِ خلاصه و اعلانِ تعطیلی نداشتند.

import { drainDailyDigest, drainHolidayNotice, tehranHhmm, digestRef } from "../src/econ/sender.js";

let n = 0;
const ok = (c, m, x) => {
  if (!c) { console.log("❌ " + m + (x !== undefined ? " → " + JSON.stringify(x) : "")); process.exitCode = 1; }
  else { console.log("✅ " + m); n++; }
};

// دیتابیسِ ساختگی. فقط چیزی که این دو تابع پیش از دروازه لمس می‌کنند:
// خواندنِ تنظیمات. هر خواندن شمرده می‌شود، چون «هزینه‌ی صفر پیش از
// ۷:۳۰» خودش یکی از ادعاهاست.
let reads = 0;
function fakeDb(config) {
  return {
    prepare(sql) {
      const st = {
        _a: [],
        bind(...a) { st._a = a; return st; },
        async all() {
          if (/FROM\s+bot_config/i.test(sql)) {
            reads++;
            const key = st._a[0];
            return { results: key in config ? [{ value: config[key] }] : [] };
          }
          // هر کوئریِ دیگری یعنی دروازه رد شده و رفته‌ایم سراغِ فهرستِ
          // مخاطب - که پیش از ۷:۳۰ نباید اتفاق بیفتد.
          reads++;
          return { results: [] };
        },
        async first() {
          reads++;
          if (/FROM\s+bot_config/i.test(sql)) {
            const key = st._a[0];
            return key in config ? { value: config[key] } : null;
          }
          return null;
        },
        async run() { return { meta: { changes: 0 } }; },
      };
      return st;
    },
  };
}

function envAt(config = {}) {
  return { DB: fakeDb({ econ_worker_sender: "on", ...config }), BOT_TOKEN: "x" };
}

// یک لحظه‌ی مشخص به وقتِ تهران. تهران ساعتِ تابستانی ندارد، پس
// UTC+3:30 تمامِ سال ثابت است و این تبدیل هیچ‌وقت نمی‌لغزد.
function tehran(dateStr, hh, mm) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 3, mm - 30));
}

// ── خودِ ساعت ───────────────────────────────────────────────────
ok(tehranHhmm(tehran("2026-09-22", 7, 30)) === "07:30", "۷:۳۰ تهران درست خوانده می‌شود");
ok(tehranHhmm(tehran("2026-09-22", 0, 5)) === "00:05", "۰۰:۰۵ تهران هم");
ok(tehranHhmm(tehran("2026-09-22", 23, 59)) === "23:59", "و ۲۳:۵۹");

// روزِ تهران سرِ نیمه‌شب عوض می‌شود، نه سرِ نیمه‌شبِ UTC. همین جابه‌جایی
// بود که ارسالِ نیمه‌شب را راه می‌انداخت.
ok(digestRef(tehran("2026-09-22", 0, 5)) === "2026-09-22", "ref سرِ ۰۰:۰۵ تهران عوض شده");
ok(
  digestRef(new Date(Date.UTC(2026, 8, 21, 22, 0))) === "2026-09-22",
  "۲۲:۰۰ UTC روزِ بعدِ تهران است - همان لحظه‌ای که ارسالِ نیمه‌شب شروع می‌شد"
);

// ── دروازه ──────────────────────────────────────────────────────
const shutHours = [[0, 5], [1, 30], [3, 30], [6, 0], [7, 29]];
for (const [h, m] of shutHours) {
  reads = 0;
  const r = await drainDailyDigest(envAt(), tehran("2026-09-22", h, m));
  const label = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  ok(r && r.skipped === "هنوز ۷:۳۰ نشده", "خلاصه در " + label + " حرکت نمی‌کند", r);
  // یک خواندن برای کلیدِ روشن/خاموشِ فرستنده، و نه بیشتر. اگر روزی
  // دروازه جابه‌جا شود و کوئریِ مخاطب اجرا شود، این عدد بالا می‌رود.
  ok(reads <= 1, "و پیش از دروازه به جدولِ مخاطب دست نمی‌زند (" + label + ")", reads);
}

reads = 0;
const at0130 = await drainHolidayNotice(envAt(), tehran("2026-09-22", 1, 30));
ok(at0130 && at0130.skipped === "هنوز ۷:۳۰ نشده", "اعلانِ تعطیلی هم نیمه‌شب حرکت نمی‌کند", at0130);

// ── و بعد از ۷:۳۰ بسته نمی‌ماند ─────────────────────────────────
//
// نصفِ این باگ آسان بود؛ نصفِ خطرناکش این است که دروازه را ببندیم و
// خلاصه اصلاً نرود. پس ادعا فقط «نمی‌رود» نیست، «می‌رود» هم هست.
for (const [h, m] of [[7, 30], [7, 35], [9, 0], [10, 59]]) {
  const label = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  const r = await drainDailyDigest(envAt(), tehran("2026-09-22", h, m));
  ok(r && !r.skipped, "در " + label + " پنجره باز است", r);
}

// ── و سرِ ۱۱ بسته می‌شود ────────────────────────────────────────
//
// این برای تازه‌واردهاست: جاروی ساعتی هر عضوِ تازه را برمی‌دارد، و
// بدونِ سقف کسی که عصر عضو می‌شد «خلاصه‌ی صبح» را عصر می‌گرفت.
for (const [h, m] of [[11, 0], [14, 0], [19, 30], [23, 55]]) {
  const label = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  const r = await drainDailyDigest(envAt(), tehran("2026-09-22", h, m));
  ok(r && r.skipped === "پنجره‌ی امروز بسته شده", "در " + label + " پنجره بسته است", r);
}

const holClosed = await drainHolidayNotice(envAt(), tehran("2026-09-22", 16, 0));
ok(
  holClosed && holClosed.skipped === "پنجره‌ی امروز بسته شده",
  "اعلانِ تعطیلی هم عصر نمی‌رود",
  holClosed
);

// مرزها دقیقاً همان‌جایی‌اند که نوشته شده - نه یک دقیقه این‌ور و آن‌ور.
ok(
  (await drainDailyDigest(envAt(), tehran("2026-09-22", 10, 59))).skipped === undefined,
  "۱۰:۵۹ هنوز داخلِ پنجره است"
);
ok(
  (await drainDailyDigest(envAt(), tehran("2026-09-22", 11, 0))).skipped === "پنجره‌ی امروز بسته شده",
  "و ۱۱:۰۰ دیگر نه"
);

// پرچمِ «تمام شد» همان کارِ قبلی‌اش را می‌کند - دروازه جایش را نگرفته.
const doneR = await drainDailyDigest(
  envAt({ econ_digest_done: "2026-09-22" }),
  tehran("2026-09-22", 9, 0)
);
ok(doneR && doneR.skipped === "تمام شده", "روزی که تمام شده دوباره شروع نمی‌شود", doneR);

// و پرچمِ دیروز جلوی امروز را نمی‌گیرد.
const staleR = await drainDailyDigest(
  envAt({ econ_digest_done: "2026-09-21" }),
  tehran("2026-09-22", 7, 30)
);
ok(staleR && !staleR.skipped, "پرچمِ دیروز خلاصه‌ی امروز را نمی‌بلعد", staleR);

// کلیدِ خاموشِ فرستنده هنوز از همه‌چیز جلوتر است.
const offR = await drainDailyDigest(
  { DB: fakeDb({ econ_worker_sender: "off" }), BOT_TOKEN: "x" },
  tehran("2026-09-22", 9, 0)
);
ok(offR && offR.skipped === "خاموش", "کلیدِ خاموش بر دروازه مقدم است", offR);

console.log("\n" + n + " ادعا");
