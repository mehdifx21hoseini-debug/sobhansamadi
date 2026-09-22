// انتخابِ سطحِ اهمیت.
//
// این فایل برای یک باگِ واقعی نوشته شده: سخنرانیِ ترامپ در فید نارنجی
// (medium) بود، درست دریافت شد، و بعد عمداً فیلتر شد - چون پیش‌فرضِ
// واقعی «فقط خیلی مهم» بود در حالی که متنِ تنظیمات «مهم و خیلی مهم»
// وعده می‌داد.
//
// سه چیز اینجا مهم‌تر از بقیه‌اند:
//
//   ۱. پیش‌فرض واقعاً high + medium باشد - چه ردیفِ تازه، چه ردیفِ
//      قدیمی که هنوز ستونِ alert_levels ندارد.
//   ۲. هر سطح فقط وقتی برود که کاربر روشنش کرده باشد؛ نه کمتر، نه
//      بیشتر.
//   ۳. آخرین سطح خاموش نشود - وگرنه کاربر مشترک می‌ماند و هیچ‌وقت هیچ
//      چیزی نمی‌گیرد، حالتی که از بیرون با «ربات خراب است» یکی است.

import {
  ALERT_LEVELS,
  DEFAULT_LEVELS,
  parseLevels,
  serializeLevels,
  toggleLevel,
  levelsFromLegacy,
  levelLabel,
} from "../src/econ/levels.js";
import { dueEvents } from "../src/econ/sender.js";
import { etMinutesUntilNow } from "../src/econ/format.js";

let n = 0;
const ok = (c, m, x) => {
  if (!c) { console.log("❌ " + m + (x !== undefined ? " → " + JSON.stringify(x) : "")); process.exitCode = 1; }
  else { console.log("✅ " + m); n++; }
};

// ── ساختنِ خبری که «n دقیقه‌ی دیگر» است ──────────────────────────
//
// etMinutesUntilNow بسته به تاریخ، ساعتِ تابستانی یا زمستانیِ نیویورک
// را فرض می‌کند. به‌جای تکرارِ همان منطق اینجا، هر دو حالت امتحان
// می‌شود و آنی برداشته می‌شود که خودِ تابع تاییدش کند - پس تست در هیچ
// فصلی نمی‌شکند.
function inMinutes(mins) {
  const target = new Date(Date.now() + mins * 60_000);
  for (const off of [4, 5]) {
    const d = new Date(target.getTime() - off * 3_600_000);
    const date = d.toISOString().slice(0, 10);
    const time = d.toISOString().slice(11, 16);
    if (Math.abs(etMinutesUntilNow(date, time) - mins) <= 1) return { date, time };
  }
  throw new Error("نتوانستم خبری در " + mins + " دقیقه‌ی دیگر بسازم");
}

function ev(importance, mins, id) {
  const { date, time } = inMinutes(mins);
  return {
    id: id || importance + "-" + mins,
    date,
    time,
    currency: "USD",
    importance,
    status: "scheduled",
    title: "رویدادِ " + importance,
  };
}

const sub = (levels) => ({ alert_levels: levels, alert_minutes: 30 });

// ── فهرست و برچسب‌ها ────────────────────────────────────────────
ok(ALERT_LEVELS.length === 3, "سه سطح، نه چهار - فید Holiday را رویداد حساب نمی‌کند");
ok(ALERT_LEVELS.map((l) => l.key).join() === "high,medium,low", "ترتیب از مهم به کم‌اهمیت");
ok(ALERT_LEVELS.every((l) => l.fa && l.emoji && l.color), "هر سطح نامِ فارسی و رنگ دارد");
ok(levelLabel("medium") === "مهم", "برچسبِ medium «مهم» است");
ok(levelLabel("چیزِ ناشناخته") === "چیزِ ناشناخته", "کلیدِ ناشناخته خودش برمی‌گردد");

// ── پیش‌فرض ─────────────────────────────────────────────────────
ok(DEFAULT_LEVELS.join() === "high,medium", "پیش‌فرض: خیلی مهم و مهم");
ok(DEFAULT_LEVELS.includes("medium"), "«مهم» در پیش‌فرض هست - همان چیزی که ترامپ را انداخته بود");
ok(!DEFAULT_LEVELS.includes("low"), "«کم‌اهمیت» به کسی تحمیل نمی‌شود");
ok(levelsFromLegacy().join() === "high,medium", "ردیفِ قدیمی هم به همین پیش‌فرض می‌رسد");

// ── parse و serialize ───────────────────────────────────────────
ok(parseLevels("").join() === "high,medium", "خالی یعنی پیش‌فرض، نه «هیچ»");
ok(parseLevels(null).join() === "high,medium", "null هم پیش‌فرض");
ok(parseLevels("چرند,آشغال").join() === "high,medium", "همه‌اش نامعتبر یعنی پیش‌فرض");
ok(parseLevels("low").join() === "low", "فقط کم‌اهمیت هم یک انتخابِ معتبر است");
ok(parseLevels("low,high").join() === "high,low", "ترتیبِ اصلی نگه داشته می‌شود");
ok(parseLevels("HIGH, Medium ").join() === "high,medium", "فاصله و حروفِ بزرگ اشکالی ندارد");
ok(parseLevels("high,high,high").join() === "high", "تکراری یک بار می‌آید");
ok(parseLevels("high,چرند").join() === "high", "معتبرها می‌مانند، بقیه دور ریخته می‌شوند");
ok(serializeLevels(["low", "high"]) === "high,low", "serialize هم مرتب می‌کند");
ok(serializeLevels([]) === "high,medium", "فهرستِ خالی به پیش‌فرض می‌رسد");
ok(serializeLevels(["چرند"]) === "high,medium", "فهرستِ همه‌نامعتبر هم");
ok(serializeLevels(null) === "high,medium", "null هم");
ok(parseLevels(serializeLevels(["medium"])).join() === "medium", "رفت‌وبرگشت مقدار را عوض نمی‌کند");

// ── toggle ──────────────────────────────────────────────────────
ok(toggleLevel(["high"], "medium").join() === "high,medium", "روشن کردنِ یک سطح");
ok(toggleLevel(["high", "medium"], "medium").join() === "high", "خاموش کردنِ یک سطح");
ok(toggleLevel(["medium"], "low").join() === "medium,low", "ترتیب بعد از روشن کردن هم درست می‌ماند");
ok(toggleLevel(["high"], "high").join() === "high", "آخرین سطح خاموش نمی‌شود");
ok(toggleLevel(["low"], "low").join() === "low", "آخرین سطح حتی اگر کم‌اهمیت باشد");
ok(toggleLevel(["high"], "چرند").join() === "high", "کلیدِ ناشناخته چیزی را عوض نمی‌کند");
ok(toggleLevel(["high", "medium", "low"], "high").join() === "medium,low", "از سه به دو");

// ── فیلترِ واقعیِ ارسال ──────────────────────────────────────────
const events = [ev("high", 10), ev("medium", 12), ev("low", 14)];

const got = (levels) =>
  dueEvents(events, sub(levels)).map((e) => e.importance).sort().join();

ok(got(["high"]) === "high", "فقط خیلی مهم");
ok(got(["medium"]) === "medium", "فقط مهم - و این همان چیزی است که تا دیروز ناممکن بود");
ok(got(["low"]) === "low", "فقط کم‌اهمیت - تا دیروز با هیچ حالتی نمی‌رفت");
ok(got(["high", "medium"]) === "high,medium", "پیش‌فرض هر دو را می‌گیرد");
ok(got(["high", "medium", "low"]) === "high,low,medium", "هر سه");
ok(got([]) === "high,medium", "سطحِ خالی به پیش‌فرض می‌افتد، نه به سکوت");
ok(got(undefined) === "high,medium", "ردیفِ بدونِ ستون هم پیش‌فرض می‌گیرد");

// سخنرانیِ ترامپ: نارنجی، دو ساعتِ دیگر، کاربرِ پیش‌فرض.
const trump = { ...ev("medium", 20, "trump"), title: "سخنرانی ترامپ" };
ok(
  dueEvents([trump], sub(undefined)).length === 1,
  "خبرِ نارنجی برای کاربرِ پیش‌فرض می‌رود - همان شکایتی که این تغییر از آن آمد"
);

// ── چیزهایی که فیلترِ سطح نباید خرابشان کند ─────────────────────
ok(dueEvents([ev("high", 90)], sub(["high"])).length === 0, "خارج از بازه‌ی هشدار نمی‌رود");
ok(dueEvents([ev("high", -5)], sub(["high"])).length === 0, "خبرِ گذشته نمی‌رود");
ok(
  dueEvents([{ ...ev("high", 10), status: "released" }], sub(["high"])).length === 0,
  "خبرِ منتشرشده هشدار نمی‌گیرد"
);
ok(
  dueEvents([{ ...ev("high", 10), time: "" }], sub(["high"])).length === 0,
  "خبرِ بی‌ساعت نمی‌رود"
);

// ── آینه‌ی مینی‌اپ ───────────────────────────────────────────────
//
// فهرستِ سطح‌ها در src/econ-app/app.js دستی تکرار شده (آن فایل بی‌ماژول
// است و نمی‌تواند levels.js را import کند). اگر یکی عوض شود و دیگری
// نه، کاربر کلیدی می‌بیند که سرور نمی‌شناسد.
const appJs = new URL("../../src/econ-app/app.js", import.meta.url);
const src = await (await import("node:fs/promises")).readFile(appJs, "utf8");
for (const l of ALERT_LEVELS) {
  ok(src.includes('key: "' + l.key + '"'), "مینی‌اپ سطحِ " + l.key + " را دارد");
  ok(src.includes(l.fa), "مینی‌اپ برچسبِ «" + l.fa + "» را دارد");
}
ok(!src.includes("show_low_importance"), "کلیدِ قدیمی از مینی‌اپ پاک شده");
ok(!src.includes("swLow"), "سوییچِ قدیمی از مینی‌اپ پاک شده");
ok(src.includes('LEVEL_DEFAULT = ["high", "medium"]'), "پیش‌فرضِ مینی‌اپ با سمتِ ربات یکی است");

const html = await (await import("node:fs/promises"))
  .readFile(new URL("../../src/econ-app/index.html", import.meta.url), "utf8");
ok(html.includes('id="levels"'), "جای کلیدها در HTML هست");
ok(!html.includes('id="swLow"'), "سوییچِ قدیمی از HTML پاک شده");

console.log("\n" + n + " تست گذشت");
