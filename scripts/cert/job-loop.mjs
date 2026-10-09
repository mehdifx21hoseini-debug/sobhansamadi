// حلقه‌ی ورک‌فلو: درخواست‌های منتظر را از ورکر می‌گیرد، رندر می‌کند، پس می‌دهد.
//
// نامِ دانشجو هرگز چاپ نمی‌شود. لاگِ این ریپو عمومی است و ورک‌فلو هم
// ورودی ندارد - نام فقط از راهِ ورکر (با کلیدِ مدیر) می‌آید و فقط به
// رندرر می‌رسد. در لاگ فقط شناسه‌ی کوتاهِ درخواست و حجمِ فایل است.
//
// فایل‌های خصوصی (قالب و فونت‌ها) هم از ورکر می‌آیند، نه از ریپو: چرایش
// بالای bot/src/certificate/service.js نوشته شده.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openRenderer, CertError } from "./render.mjs";

const BASE = process.env.BASE;
const KEY = process.env.ADMIN_KEY;
// یک دسته تا ۳۰ نام است و دو دسته می‌توانند پشتِ سرِ هم بیایند؛ هر گواهی حدودِ
// چهار ثانیه (رندر + آپلود) است، پس ۶۰ تا حدودِ چهار دقیقه است.
const MAX_JOBS = 60;

if (!BASE || !KEY) {
  console.error("::error::BASE یا ADMIN_KEY تنظیم نشده");
  process.exit(1);
}

const layout = JSON.parse(fs.readFileSync(new URL("./layout.json", import.meta.url), "utf8"));

async function call(method, pathAndQuery, { body, headers = {}, raw = false, timeoutMs = 120000 } = {}) {
  const res = await fetch(BASE + pathAndQuery, {
    method,
    headers: { "x-admin-key": KEY, ...headers },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (raw) return res;
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function downloadAssets(dir) {
  const files = {};
  for (const [slot, file] of [["template", "template.png"], ["name_font", "name.ttf"], ["label_font", "label.ttf"]]) {
    const res = await call("GET", "/admin/cert-asset?slot=" + slot, { raw: true });
    if (!res.ok) throw new CertError("template", "فایلِ «" + slot + "» از ورکر نیامد: " + res.status);
    const p = path.join(dir, file);
    fs.writeFileSync(p, Buffer.from(await res.arrayBuffer()));
    files[slot] = p;
  }
  return files;
}

async function fail(id, code) {
  try {
    await call("POST", "/admin/cert-fail?id=" + encodeURIComponent(id) + "&code=" + encodeURIComponent(code));
  } catch (err) {
    // فقط نوعِ خطا، نه متنش: لاگ عمومی است.
    console.error("اعلامِ شکست هم نرسید:", err && err.name);
  }
}

async function upload(id, png, fit) {
  // تکرار فقط برای قطعیِ شبکه است. پاسخِ ۴۰۹ یعنی بار اول رسیده بود و
  // ورکر عکسِ دوم نمی‌فرستد؛ پاسخِ ۵۰۲ یعنی تلگرام نپذیرفت و درخواست
  // همان‌جا شکست‌خورده اعلام شده - تکرارش فایده‌ای ندارد.
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await call("POST", "/admin/cert-done?id=" + encodeURIComponent(id) + "&fit=" + fit, {
        body: png,
        headers: { "content-type": "image/png" },
        timeoutMs: 180000,
      });
      return r.status;
    } catch (err) {
      lastErr = err;
      await new Promise((k) => setTimeout(k, 3000));
    }
  }
  throw lastErr;
}

async function main() {
  let renderer = null;
  let dir = null;
  let done = 0;
  try {
    for (let n = 0; n < MAX_JOBS; n++) {
      const claim = await call("POST", "/admin/cert-next");
      if (claim.status !== 200 || !claim.json) {
        console.error("::error::گرفتنِ درخواست شکست خورد: " + claim.status);
        process.exitCode = 1;
        break;
      }
      const job = claim.json.job;
      if (!job) {
        console.log("درخواستِ منتظری نمانده.");
        break;
      }
      console.log("درخواست " + job.id + " برداشته شد.");

      try {
        if (!renderer) {
          dir = fs.mkdtempSync(path.join(os.tmpdir(), "cert-"));
          const f = await downloadAssets(dir);
          renderer = await openRenderer({
            templatePath: f.template,
            nameFontPath: f.name_font,
            labelFontPath: f.label_font,
            layout,
          });
        }
        const t0 = Date.now();
        const { png, fit } = await renderer.render(job.name, job.gender);
        const status = await upload(job.id, png, fit);
        console.log(
          "درخواست " + job.id + ": " + Math.round(png.length / 1024) + " کیلوبایت، " +
            (Date.now() - t0) + " میلی‌ثانیه، fit=" + fit + "، پاسخِ ورکر " + status
        );
        if (status === 200 || status === 409) done++;
        // ۵۰۲ و بقیه را خودِ ورکر شکست‌خورده اعلام کرده؛ اینجا کاری نمی‌ماند.
      } catch (err) {
        const code = err instanceof CertError ? err.code : "render";
        // متنِ خطا چاپ نمی‌شود: ممکن است نام را داشته باشد.
        console.error("درخواست " + job.id + " شکست خورد (" + code + ").");
        await fail(job.id, code);
        process.exitCode = 1;
      }
    }
  } finally {
    if (renderer) await renderer.close().catch(() => {});
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log("✅ تمام: " + done + " گواهی فرستاده شد.");
}

main().catch((err) => {
  console.error("::error::حلقه‌ی گواهی از کار افتاد: " + (err && err.code ? err.code : "unknown"));
  process.exit(1);
});
