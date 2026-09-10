// ساخت econ-app.html از روی منبع‌های src/econ-app/
//
// چرا اصلاً یک قدم ساخت؟ چون دو خواسته‌ی درست با هم می‌جنگیدند:
//
//   ۱. نگهداری: ۳۶۰۱ خط در یک فایل جایی است که اشتباه پنهان می‌شود.
//   ۲. سرعتِ باز شدن: مینی‌اپ باید با یک درخواست بالا بیاید، نه سه تا.
//
// این اسکریپت هر دو را می‌دهد: منبع سه فایلِ جداست، خروجی همان تک‌فایلِ
// قبلی. هیچ وابستگی‌ای هم لازم ندارد - فقط Node.
//
// و یک کار دوم که مهم‌تر است: نسخه‌ی کش را از روی محتوای خروجی حساب
// می‌کند. پیش از این «?v=29» دستی در bot/src/econ/index.js نوشته می‌شد و
// اگر یادمان می‌رفت جلو ببریمش، کاربر نسخه‌ی کهنه را می‌دید و هیچ خطایی
// هم جایی ثبت نمی‌شد. حالا عدد از خودِ فایل می‌آید، پس نمی‌تواند با آن
// اختلاف پیدا کند.
//
//   node scripts/build-econ-app.mjs           بساز و بنویس
//   node scripts/build-econ-app.mjs --check   فقط بررسی کن (برای CI)

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src", "econ-app");

const OUT_HTML = join(ROOT, "econ-app.html");
const OUT_VERSION = join(ROOT, "bot", "src", "econ", "appVersion.js");
// همان HTML، این‌بار به‌شکل یک ماژول تا داخل باندل ورکر برود و ورکر
// خودش مینی‌اپ را سرو کند. دلیلش در appHtml.js نوشته شده.
const OUT_APP_MODULE = join(ROOT, "bot", "src", "econ", "appHtml.js");

const CSS_MARK = "<!-- build:css -->";
const JS_MARK = "<!-- build:js -->";
const VERSION_MARK = "<!-- build:version -->";

function read(p) {
  return readFileSync(p, "utf8");
}

// نشانه‌گذار روی یک خطِ تنها می‌نشیند، پس کل آن خط - با تورفتگی‌اش -
// جای‌گزین می‌شود. این‌طور تورفتگیِ منبع دست‌نخورده به خروجی می‌رود و diff
// خروجی همان diff منبع می‌ماند.
function inject(template, mark, body, what) {
  const lines = template.split("\n");
  const at = lines.findIndex((l) => l.includes(mark));
  if (at === -1) throw new Error("نشانه‌گذار «" + mark + "» در قالب نیست - " + what + " جایی برای رفتن ندارد");
  if (lines.filter((l) => l.includes(mark)).length > 1) {
    throw new Error("نشانه‌گذار «" + mark + "» بیش از یک بار آمده");
  }
  lines.splice(at, 1, body.replace(/\n+$/, ""));
  return lines.join("\n");
}

// ده رقم hex از sha256. کوتاه است تا در لاگ و آدرس خوانا بماند، و به
// اندازه‌ی کافی بلند است که دو نسخه‌ی متفاوتِ این فایل به هم نخورند.
//
// از روی **منبع‌ها** حساب می‌شود نه خروجی، چون همین عدد داخل خروجی نوشته
// می‌شود: هش گرفتن از خروجی یعنی نوشتن عدد، عدد را عوض می‌کند.
export function versionOf(parts) {
  const h = createHash("sha256");
  for (const p of parts) h.update(p, "utf8");
  return h.digest("hex").slice(0, 10);
}

const MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/**
 * هر `url("assets/…")` را با یک data: URI جای‌گزین می‌کند.
 *
 * چرا لازم شد: آدرسِ نسبی وقتی درست بود که اپ روی GitHub Pages کنارِ
 * پوشه‌ی assets می‌نشست. حالا ورکر آن را از /econ/app می‌دهد و همان
 * آدرسِ نسبی به /econ/assets/… می‌رسد که وجود ندارد - یعنی بنر بی‌صدا
 * ناپدید می‌شد و در لاگِ ورکر هم چیزی پیدا نبود.
 *
 * درون‌ریزی به‌جای یک مسیرِ دوم در ورکر انتخاب شد چون اپ را واقعاً
 * تک‌فایل می‌کند: یک درخواست، بدون هیچ وابستگیِ بیرونی.
 */
function inlineAssets(css) {
  return css.replace(/url\((["']?)(assets\/[^"')]+)\1\)/g, (_all, _q, rel) => {
    const file = join(ROOT, rel);
    const ext = rel.slice(rel.lastIndexOf(".")).toLowerCase();
    const mime = MIME[ext];
    if (!mime) throw new Error("پسوندِ ناشناخته برای درون‌ریزی: " + rel);
    let bytes;
    try {
      bytes = readFileSync(file);
    } catch {
      // بی‌سر و صدا رد کردنش یعنی یک بنرِ نبود که فقط کاربر می‌بیند.
      throw new Error("فایل «" + rel + "» پیدا نشد - مینی‌اپ به آن ارجاع می‌دهد");
    }
    return 'url("data:' + mime + ";base64," + bytes.toString("base64") + '")';
  });
}

// ماژول‌های منطقِ خالص، به ترتیبی که چسبانده می‌شوند.
//
// فهرست عمداً دستی است نه glob: ترتیب اهمیت دارد - یک فایل می‌تواند به
// تابعِ فایلِ قبلی تکیه کند - و یک فهرستِ صریح در بازبینی دیده می‌شود،
// در حالی که glob بی‌صدا هر فایلِ تازه‌ای را وارد باندل می‌کند.
const LIBS = ["sessions.js"];

// «export» برای تست است، نه برای مرورگر.
//
// این فایل‌ها دو جا اجرا می‌شوند: در تست به‌عنوان ماژولِ واقعی import
// می‌شوند، و در اپ داخلِ یک <script> ساده می‌نشینند که ماژول نیست. پس
// موقعِ چسباندن فقط همان کلمه برداشته می‌شود و بقیه‌ی خط دست‌نخورده
// می‌ماند.
//
// عمداً فقط ابتدای خط تطبیق داده می‌شود: «export» وسطِ یک رشته یا
// توضیح نباید دست بخورد. `import` هم اجازه ندارد - ماژول‌های این پوشه
// باید مستقل باشند، و اگر روزی یکی به دیگری وابسته شد باید در LIBS
// جلوترش بیاید، نه اینکه import کند.
function stripModuleSyntax(code, name) {
  if (/^\s*import[\s{*]/m.test(code)) {
    throw new Error(
      "src/econ-app/lib/" + name + " دستور import دارد. " +
      "ماژول‌های این پوشه باید مستقل باشند؛ ترتیبشان را در LIBS تنظیم کنید."
    );
  }
  return code.replace(/^export\s+(?=(function|const|let|var|class)\s)/gm, "");
}

export function build() {
  const template = read(join(SRC, "index.html"));
  // پیش از حساب کردنِ نسخه درون‌ریزی می‌شود، تا عوض شدنِ خودِ تصویر هم
  // کشِ وب‌ویو را بشکند. اگر بعدش انجام می‌شد، بنرِ تازه پشتِ نسخه‌ی
  // قدیمی گیر می‌کرد.
  const css = inlineAssets(read(join(SRC, "app.css")));
  const libs = LIBS.map((name) => {
    const code = stripModuleSyntax(read(join(SRC, "lib", name)), name);
    return "// ── lib/" + name + " ──\n" + code;
  });
  const js = libs.concat(read(join(SRC, "app.js"))).join("\n");
  // نسخه از همه‌ی منبع‌ها حساب می‌شود، وگرنه عوض شدنِ یک lib کشِ وب‌ویو
  // را نمی‌شکست و کاربر اپِ کهنه می‌گرفت.
  const version = versionOf([template, css, js]);

  let html = inject(template, CSS_MARK, css, "CSS");
  html = inject(html, JS_MARK, js, "JS");
  // این یکی درجا جای‌گزین می‌شود نه خط‌به‌خط: وسط یک خط نشسته.
  if (!html.includes(VERSION_MARK)) {
    throw new Error("نشانه‌گذار «" + VERSION_MARK + "» در قالب نیست - شماره‌ی نسخه جایی برای رفتن ندارد");
  }
  html = html.replace(VERSION_MARK, version);
  return { html, version };
}

// HTML به‌شکل یک ماژول جاوااسکریپت، تا esbuildِ رنگلر آن را داخل باندل
// ورکر بگذارد.
//
// چرا JSON.stringify و نه template literal: این فایل ۱۴۶ کیلوبایت HTML
// دستِ آدم است و اگر روزی یک بک‌تیک یا «${» تویش بیاید، رشته‌ی قالبی
// بی‌صدا می‌شکند - و شکستنش وقت بیلد پیدا نمی‌شود، وقتِ اجرا پیدا
// می‌شود. JSON.stringify همه‌ی حالت‌ها را درست فرار می‌دهد و خروجی‌اش
// خودش جاوااسکریپتِ معتبر است.
function appModule(html) {
  return [
    "// این فایل ساخته می‌شود - دستی عوضش نکنید.",
    "//",
    "// همان econ-app.html است، بسته‌بندی‌شده تا ورکر بتواند خودش سرو",
    "// کند. پیش از این مینی‌اپ روی GitHub Pages بود و این یعنی آدرسش به",
    "// نامِ صاحبِ مخزن گره خورده بود: هر انتقالِ مالکیت، اپ را برای همه",
    "// می‌شکست. حالا از همان دامنه‌ای می‌آید که بقیه‌ی ربات می‌آید، پس",
    "// گیت‌هاب فقط جایی است که کد نگه داشته می‌شود، نه چیزی که کاربر به",
    "// آن وصل است.",
    "//",
    "// با «node scripts/build-econ-app.mjs» به‌روز می‌شود.",
    "export const ECON_APP_HTML = " + JSON.stringify(html) + ";",
    "",
  ].join("\n");
}

function versionModule(version) {
  return [
    "// این فایل ساخته می‌شود - دستی عوضش نکنید.",
    "//",
    "// مقدارش هشِ محتوای econ-app.html است و با",
    "// «node scripts/build-econ-app.mjs» به‌روز می‌شود. کارش شکستن کشِ",
    "// وب‌ویوی تلگرام است: تا وقتی فایل عوض نشود عدد ثابت می‌ماند، و لحظه‌ای",
    "// که عوض شد خودش جلو می‌رود.",
    "export const ECON_APP_VERSION = " + JSON.stringify(version) + ";",
    "",
  ].join("\n");
}

const check = process.argv.includes("--check");

const { html, version } = build();
const module_ = versionModule(version);
const appModule_ = appModule(html);

if (check) {
  const problems = [];
  let onDiskHtml = null;
  try {
    onDiskHtml = read(OUT_HTML);
  } catch {
    problems.push("econ-app.html نیست");
  }
  if (onDiskHtml !== null && onDiskHtml !== html) {
    problems.push("econ-app.html با منبع‌های src/econ-app/ یکی نیست");
  }
  let onDiskVersion = null;
  try {
    onDiskVersion = read(OUT_VERSION);
  } catch {
    problems.push("bot/src/econ/appVersion.js نیست");
  }
  if (onDiskVersion !== null && onDiskVersion !== module_) {
    problems.push("نسخه‌ی کش کهنه است - باید " + version + " باشد");
  }

  // این یکی چیزی است که کاربر واقعاً می‌بیند: ورکر از همین ماژول سرو
  // می‌کند. اگر عقب بماند، econ-app.html و نسخه‌ی کش هر دو درست‌اند و
  // باز هم اپِ کهنه بالا می‌آید - دقیقاً همان سکوتی که این جاب برای
  // شکستنش نوشته شده.
  let onDiskApp = null;
  try {
    onDiskApp = read(OUT_APP_MODULE);
  } catch {
    problems.push("bot/src/econ/appHtml.js نیست");
  }
  if (onDiskApp !== null && onDiskApp !== appModule_) {
    problems.push("bot/src/econ/appHtml.js با econ-app.html یکی نیست - ورکر اپِ کهنه سرو می‌کند");
  }

  if (problems.length) {
    console.error("✖ " + problems.join("\n✖ "));
    console.error("\nبرای درست شدن، این را اجرا کنید و نتیجه را کامیت کنید:");
    console.error("  node scripts/build-econ-app.mjs");
    process.exit(1);
  }
  console.log("✔ econ-app.html با منبع‌ها یکی است، نسخه " + version);
} else {
  writeFileSync(OUT_HTML, html);
  writeFileSync(OUT_VERSION, module_);
  writeFileSync(OUT_APP_MODULE, appModule_);
  const kb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(1);
  console.log("✔ econ-app.html ساخته شد - " + kb + " کیلوبایت، نسخه " + version);
}
