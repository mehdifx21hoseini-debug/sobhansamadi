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

export function build() {
  const template = read(join(SRC, "index.html"));
  const css = read(join(SRC, "app.css"));
  const js = read(join(SRC, "app.js"));
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
  const kb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(1);
  console.log("✔ econ-app.html ساخته شد - " + kb + " کیلوبایت، نسخه " + version);
}
