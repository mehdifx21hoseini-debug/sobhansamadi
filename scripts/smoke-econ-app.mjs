// دودِ مینی‌اپ: اپِ ساخته‌شده را واقعاً در یک مرورگر بالا می‌آورد.
//
// ─── چرا لازم شد ───────────────────────────────────────────────────
//
// econ-app.yml امروز فقط می‌پرسد «خروجی با منبع یکی است؟». این سوالِ
// درستی است ولی جوابش هیچ ربطی به کار کردنِ اپ ندارد: خروجی می‌تواند
// دقیقاً با منبع یکی باشد و اپ روی گوشیِ کاربر سفید بالا بیاید.
//
// دقیقاً همین افتاد. یک متغیرِ محلی به نامِ clock تابعِ clock() را
// پوشاند و کلِ تبِ سشن‌ها خالی شد. نه تستی گرفتش، نه خطایی جایی ثبت شد،
// و نه بیلد قرمز شد - چون از نظرِ بیلد هیچ چیزی خراب نبود.
//
// ─── چرا ادعا، و نه مقایسه‌ی عکس ────────────────────────────────────
//
// مقایسه‌ی تصویری یعنی نگه داشتنِ عکس‌های مرجع در مخزن، و آن عکس‌ها با
// هر نسخه‌ی فونت و هر نسخه‌ی مرورگر جابه‌جا می‌شوند - یعنی قرمزهایی که
// هیچ باگی پشتشان نیست. تجربه نشان داده چنین تستی را آدم‌ها بعد از چند
// بار خاموش می‌کنند.
//
// این‌جا به‌جایش چیزهایی سنجیده می‌شود که اگر خراب شوند، حتماً باگ‌اند:
// خطای اجرا، تبِ خالی، و اسکرولِ افقی. همان سه چیزی که کاربر می‌بیند و
// هیچ‌کدام امروز جایی ثبت نمی‌شوند.
//
//   node scripts/smoke-econ-app.mjs            بررسی کن
//   node scripts/smoke-econ-app.mjs --shots DIR  عکس هم بگیر (برای چشم)

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "econ-app.html");

const shotsAt = process.argv.indexOf("--shots");
const SHOTS = shotsAt !== -1 ? process.argv[shotsAt + 1] : null;

// ─── دادهٔ ساختگی ───────────────────────────────────────────────────
//
// لحظه هم قفل می‌شود. بدونِ آن، تست در یک عصرِ شنبه رفتارِ آخر هفته را
// می‌دید و ادعاهایش بی‌دلیل می‌شکستند - همان اشتباهی که یک بار در
// sender.test.mjs افتاد و ماه‌ها قرمز ماند.
const FAKE_NOW = "2026-09-01T13:45:00Z"; // سه‌شنبه، وسطِ سشنِ لندن

const PAYLOAD = {
  success: true,
  today: "2026-09-01",
  horizon_end: "2026-09-15",
  server_now: FAKE_NOW,
  events: [
    {
      event_id: "E1", date: "2026-09-01", time_tehran: "17:30",
      at: "2026-09-01T14:00:00Z", en: "Core CPI m/m", short: "CPI",
      title: "شاخص قیمت مصرف‌کننده", currency: "USD", importance: "high",
      forecast: "3.1%", previous: "3.0%", actual: "", status: "scheduled",
      read: null, history: [],
    },
    {
      event_id: "E2", date: "2026-09-01", time_tehran: "16:00",
      at: "2026-09-01T12:30:00Z", en: "Unemployment Claims", short: "Claims",
      title: "مدعیان بیکاری", currency: "USD", importance: "medium",
      forecast: "228K", previous: "231K", actual: "219K", status: "released",
      read: { higher: false, good: true },
      history: [{ date: "2026-08-25", actual: "231K", forecast: "230K", value: 231, beat: true }],
    },
    {
      event_id: "E3", date: "2026-09-03", time_tehran: "16:00",
      at: "2026-09-03T12:30:00Z", en: "Non-Farm Employment Change", short: "NFP",
      title: "اشتغال غیرکشاورزی", currency: "USD", importance: "high",
      forecast: "180K", previous: "175K", actual: "", status: "scheduled",
      read: null, history: [],
    },
  ],
  holidays: [],
};

// تلگرام. اپ بدونِ initData خودش را قفل می‌کند و صفحه‌ی «از داخل ربات
// باز کنید» را نشان می‌دهد - یعنی بدونِ این استاب، تست هیچ‌وقت به خودِ
// اپ نمی‌رسد و همیشه سبز می‌ماند بی‌آنکه چیزی را سنجیده باشد.
const TG_STUB = `
window.Telegram = {
  WebApp: {
    initData: "smoke=1",
    initDataUnsafe: { user: { id: 1, first_name: "تست" } },
    colorScheme: "light",
    themeParams: {},
    ready: function () {},
    expand: function () {},
    close: function () {},
    HapticFeedback: { impactOccurred: function () {}, notificationOccurred: function () {} },
    MainButton: { show: function () {}, hide: function () {}, setText: function () {}, onClick: function () {} },
    BackButton: { show: function () {}, hide: function () {}, onClick: function () {} },
    onEvent: function () {}, offEvent: function () {},
    openLink: function () {}, openTelegramLink: function () {},
  },
};
`;

const CLOCK_STUB = `(function () {
  var F = new Date(${JSON.stringify(FAKE_NOW)}).getTime(), R = Date;
  function D() { return arguments.length ? new R(...arguments) : new R(F); }
  D.now = function () { return F; };
  D.parse = R.parse; D.UTC = R.UTC; D.prototype = R.prototype;
  globalThis.Date = D;
})();`;

// ─── ادعاها ─────────────────────────────────────────────────────────

// هر تب یک نشانه دارد که باید *دیده* شود.
//
// بدونِ این، ادعای «تب خالی نیست» پوک بود: innerText روی عنصری که رندر
// نمی‌شود به textContent برمی‌گردد، پس فهرستِ پنهانِ اخبار در تبِ
// تنظیمات هم متن داشت و بررسی سبز می‌ماند بی‌آنکه چیزی از تنظیمات رندر
// شده باشد.
const TABS = [
  { id: "#tabMarkets", name: "سشن‌ها", must: ".sb" },
  { id: "#tabNews", name: "اخبار", must: "#list" },
  { id: "#tabSettings", name: "تنظیمات", must: "#levelCard" },
];

// زیرِ این عدد یعنی تب عملاً خالی است. عمداً پایین گرفته شده تا فقط
// «هیچی رندر نشد» را بگیرد، نه تغییرِ محتوا را.
const MIN_TEXT = 80;

const problems = [];
function fail(msg) { problems.push(msg); }

async function run() {
  if (!existsSync(APP)) {
    fail("econ-app.html نیست - اول «node scripts/build-econ-app.mjs» را اجرا کنید");
    return;
  }

  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    fail("playwright-core نصب نیست");
    return;
  }

  const exe = process.env.PLAYWRIGHT_CHROMIUM || "/opt/pw-browsers/chromium";
  const browser = await chromium.launch(
    existsSync(exe) ? { executablePath: exe } : {}
  );

  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 1400 },
      colorScheme: theme,
      locale: "fa-IR",
    });
    const page = await ctx.newPage();

    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e && e.message ? e.message : e)));
    page.on("console", (m) => {
      // شکستِ شبکه‌ی فونت در محیطِ بسته اجتناب‌ناپذیر است و ربطی به اپ
      // ندارد؛ هر خطای دیگری شمرده می‌شود.
      if (m.type() === "error" && !/net::ERR|Failed to load resource/.test(m.text())) {
        errors.push(m.text());
      }
    });

    await page.addInitScript(TG_STUB.replace('colorScheme: "light"', 'colorScheme: "' + theme + '"'));
    await page.addInitScript(CLOCK_STUB);
    // ترتیب مهم است و برعکسِ چیزی است که به‌نظر می‌رسد: پلی‌رایت مسیرها
    // را از آخر به اول امتحان می‌کند، پس عامِ «هر چیزِ دیگر» باید *اول*
    // ثبت شود تا خاصِ miniapp رویش بنشیند. اولین بار برعکس نوشتمش و
    // پاسخِ خالی جای دادهٔ واقعی می‌نشست - یعنی تست، نه اپ، خراب بود.
    await page.route("**/econ/**", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: '{"success":true}' })
    );
    await page.route("**/econ/miniapp*", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(PAYLOAD),
      })
    );

    await page.goto(pathToFileURL(APP).href, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    for (const tab of TABS) {
      const el = await page.$(tab.id);
      if (!el) {
        fail(theme + " · دکمه‌ی تبِ «" + tab.name + "» (" + tab.id + ") در صفحه نیست");
        continue;
      }
      await el.click();
      await page.waitForTimeout(700);

      const seen = await page.evaluate((sel) => {
        const doc = document.documentElement;
        const node = document.querySelector(sel);
        return {
          // innerText روی body فقط چیزی را می‌شمارد که واقعاً رندر شده،
          // پس زیردرخت‌های پنهان در این عدد نیستند.
          text: document.body.innerText.trim().length,
          shown: !!node && node.offsetParent !== null && node.innerText.trim().length > 0,
          overflow: doc.scrollWidth - doc.clientWidth,
          gate: !!document.body.innerText.match(/از داخل ربات تلگرام باز/),
        };
      }, tab.must);

      if (seen.gate) fail(theme + " · اپ پشتِ دروازه‌ی تلگرام مانده - استابِ initData کار نکرد");
      if (seen.text < MIN_TEXT) {
        fail(theme + " · تبِ «" + tab.name + "» عملاً خالی است (" + seen.text + " نویسه)");
      }
      if (!seen.shown) {
        fail(theme + " · تبِ «" + tab.name + "»: «" + tab.must + "» دیده نمی‌شود");
      }
      if (seen.overflow > 0) {
        fail(theme + " · تبِ «" + tab.name + "» افقی اسکرول می‌خورد (" + seen.overflow + "px)");
      }

      if (SHOTS) {
        await page.screenshot({
          path: join(SHOTS, theme + "-" + tab.id.slice(1) + ".png"),
          fullPage: true,
        });
      }
    }

    if (errors.length) {
      fail(theme + " · خطای اجرا در صفحه:\n    " + errors.slice(0, 5).join("\n    "));
    }
    await ctx.close();
  }

  await browser.close();
}

await run();

if (problems.length) {
  console.error("✖ " + problems.join("\n✖ "));
  process.exit(1);
}
console.log("✔ مینی‌اپ در هر دو تم بالا می‌آید - سه تب، بدونِ خطا و بدونِ اسکرولِ افقی");
