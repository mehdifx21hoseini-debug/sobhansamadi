// گواهی: هرچه بینِ صف، تلگرام و ورک‌فلو می‌گذرد.
//
// ─── چرا رندر در ورکر نیست ───────────────────────────────────────
//
// رسمِ متنِ فارسی با فونتِ سفارشی یک موتورِ رندرِ چندمگابایتی و چند
// ده میلی‌ثانیه CPU می‌خواهد. پلنِ رایگانِ ورکر ۳ مگابایت حجمِ کد و ۱۰
// میلی‌ثانیه CPU دارد. پس رندر در GitHub Actions انجام می‌شود، همان‌جا
// که درِین پیام‌ها هم هست، و ورکر فقط صف را نگه می‌دارد و عکس را به
// تلگرام می‌رساند.
//
// ─── چرا قالب و فونت‌ها در ریپو نیستند ───────────────────────────
//
// ریپو عمومی است. قالبِ بی‌نامِ باکیفیت، امضا و فونت‌ها کنارِ هم یعنی
// هرکس می‌تواند «گواهیِ آکادمی» به نامِ هرکسی بسازد. فونتِ Yekan Bakh
// هم مجوزِ بازتوزیع ندارد (متعلق به Fontiran است).
//
// پس سه فایل را خودِ مدیر برای ربات می‌فرستد و تلگرام نگهشان می‌دارد؛
// ورکر فقط file_id را ذخیره می‌کند و هنگامِ رندر آن‌ها را از تلگرام
// می‌کشد و به ورک‌فلو می‌دهد. نه راز تازه‌ای لازم است نه چیزی در ریپو
// می‌ماند، و مدیر هر وقت خواست با فرستادنِ دوباره‌ی فایل عوضش می‌کند.

import { readConfig, writeConfig } from "../content/channel.js";
import { dispatchWorkflow } from "../ops/dispatch.js";
import { finishJob, getJob, sweep, countActive, failAllRendering } from "./store.js";

export const WORKFLOW = "cert-render.yml";
export const PENDING_FLAG = "cert_pending";

export const GENDER_LABEL = { f: "سرکار خانم", m: "جناب آقای" };

// ─── فایل‌های خصوصی ──────────────────────────────────────────────

export const SLOTS = {
  template: { key: "cert_asset_template", title: "قالب گواهی", hint: "template.png" },
  name_font: { key: "cert_asset_name_font", title: "فونتِ اسم", hint: "YekanBakh-ExtraBlack.ttf" },
  label_font: {
    key: "cert_asset_label_font",
    title: "فونتِ «جناب آقای / سرکار خانم»",
    hint: "YekanBakh-Light.ttf",
  },
};

// سقفِ دانلودِ ربات از تلگرام ۲۰ مگابایت است. قالب ~۴ مگابایت است.
export const ASSET_MAX_BYTES = 18 * 1024 * 1024;

/** نامِ فایل → کدام جایگاه. null یعنی این فایل مالِ گواهی نیست. */
export function slotForFilename(fileName) {
  const f = String(fileName || "").toLowerCase();
  if (/^template[\w .()-]*\.png$/.test(f)) return "template";
  if (/\.(ttf|otf)$/.test(f)) {
    if (/extra[-_ ]?black/.test(f)) return "name_font";
    if (/light/.test(f)) return "label_font";
  }
  return null;
}

export async function saveAsset(env, slot, doc, now = new Date()) {
  const rec = {
    file_id: doc.file_id,
    size: doc.file_size || 0,
    name: doc.file_name || "",
    at: now.toISOString(),
  };
  await writeConfig(env, SLOTS[slot].key, JSON.stringify(rec));
  return rec;
}

export async function readAsset(env, slot) {
  const raw = await readConfig(env, SLOTS[slot].key).catch(() => "");
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw);
    return rec && rec.file_id ? rec : null;
  } catch {
    return null;
  }
}

/** کدام فایل‌ها هنوز نیامده‌اند. خالی یعنی آماده‌ایم. */
export async function missingAssets(env) {
  const out = [];
  for (const slot of Object.keys(SLOTS)) {
    if (!(await readAsset(env, slot))) out.push(slot);
  }
  return out;
}

const TG = (env, method) => "https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method;

async function tgJson(env, method, payload, timeoutMs = 15000) {
  const res = await fetch(TG(env, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(payload),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: !!(res.ok && body && body.ok), status: res.status, body };
}

/**
 * یک فایلِ خصوصی را از تلگرام می‌کشد و همان‌طور که می‌آید برمی‌گرداند.
 * بدنه بافر نمی‌شود: ورکر فقط لوله است و CPU‌ای خرج نمی‌کند.
 */
export async function streamAsset(env, slot) {
  if (!SLOTS[slot]) return { status: 400, error: "slot" };
  const rec = await readAsset(env, slot);
  if (!rec) return { status: 404, error: "not_uploaded" };
  const meta = await tgJson(env, "getFile", { file_id: rec.file_id });
  const path = meta.ok && meta.body.result && meta.body.result.file_path;
  if (!path) return { status: 502, error: "getFile" };
  const res = await fetch("https://api.telegram.org/file/bot" + env.BOT_TOKEN + "/" + path, {
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok || !res.body) return { status: 502, error: "download" };
  const headers = { "content-type": "application/octet-stream", "cache-control": "no-store" };
  const len = res.headers.get("content-length");
  if (len) headers["content-length"] = len;
  return { status: 200, body: res.body, headers };
}

// ─── پیام به مدیر ────────────────────────────────────────────────

export const REASONS = {
  dispatch: "راه‌اندازیِ رندر در گیت‌هاب ممکن نشد.",
  no_runner: "رندر در شش دقیقه شروع نشد.",
  timeout: "رندر بیش از شش دقیقه طول کشید.",
  template: "قالب یا فونت‌ها مشکل دارند. با /certassets بررسی کنید.",
  render: "خطا در رندرِ عکس.",
  send: "ارسالِ عکس به تلگرام نشد.",
  other: "خطای ناشناخته.",
};

/** پیامِ وضعیت را عوض می‌کند؛ اگر نشد، پیامِ تازه می‌فرستد. بی‌صدا شکست می‌خورد. */
export async function notify(env, job, text) {
  if (!job || !job.chat_id) return;
  try {
    if (job.message_id) {
      const r = await tgJson(env, "editMessageText", {
        chat_id: job.chat_id,
        message_id: job.message_id,
        text,
        reply_markup: { inline_keyboard: [] },
      });
      if (r.ok) return;
    }
    await tgJson(env, "sendMessage", { chat_id: job.chat_id, text });
  } catch {
    // مدیر دست‌کم از راهِ نرسیدنِ عکس می‌فهمد؛ اطلاع‌رسانی نباید چیزی را بشکند.
  }
}

export function failureText(job, code) {
  return (
    "❌ ساخت گواهی برای «" + job.name + "» انجام نشد.\n" +
    (REASONS[code] || REASONS.other) + "\n\n" +
    "دوباره امتحان کنید: /cert " + job.name
  );
}

// ─── گذارها ──────────────────────────────────────────────────────

export async function failJob(env, id, code) {
  const safe = REASONS[code] ? code : "other";
  const job = await getJob(env, id);
  if (!job) return false;
  if (!(await finishJob(env, id, "failed", safe))) return false;
  await notify(env, job, failureText(job, safe));
  return true;
}

/** پس از زدنِ دکمه: علامتِ «در انتظار» و روشن کردنِ ورک‌فلو. */
export async function startRender(env, job) {
  await writeConfig(env, PENDING_FLAG, "1");
  const r = await dispatchWorkflow(env, WORKFLOW);
  if (!r.ok) {
    await failJob(env, job.id, "dispatch");
    return { ok: false, detail: r.skipped || String(r.status || "") };
  }
  return { ok: true };
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const MAX_PNG_BYTES = 30 * 1024 * 1024;

export function looksLikePng(bytes) {
  const u = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
  return u.length === 8 && PNG_MAGIC.every((b, i) => u[i] === b);
}

const FIT_NOTE = {
  shrunk: "\n(نام بلند بود؛ اندازه‌ی فونت کمی کوچک شد.)",
  overflow: "\n⚠️ نام خیلی بلند است و حتی با کوچک‌ترین اندازه جا نمی‌شود؛ عکس را ببینید.",
};

/**
 * عکسِ رندرشده را به مدیر می‌رساند.
 *
 * @returns {Promise<{status: number, error?: string}>}
 *   409 یعنی این درخواست دیگر منتظرِ عکس نیست (قبلاً فرستاده شده یا
 *   شکست‌خورده اعلام شده) - پس تکرارِ آپلودِ ورک‌فلو هیچ‌وقت عکسِ دوم
 *   نمی‌فرستد.
 */
export async function completeJob(env, id, bytes, fit = "ok") {
  const job = await getJob(env, id);
  if (!job) return { status: 404, error: "no_job" };
  if (job.status !== "rendering") return { status: 409, error: "not_rendering" };
  if (!bytes || bytes.byteLength === 0) return { status: 400, error: "empty" };
  if (bytes.byteLength > MAX_PNG_BYTES) return { status: 413, error: "too_big" };
  if (!looksLikePng(bytes)) return { status: 400, error: "not_png" };

  const label = GENDER_LABEL[job.gender] || "";
  const caption = "🎓 گواهی — " + label + " " + job.name + (FIT_NOTE[fit] || "");

  // فایل (document)، نه عکس: تلگرام عکس را فشرده می‌کند و کیفیتِ ۳۵۸۴ پیکسلی
  // از بین می‌رفت.
  const form = new FormData();
  form.append("chat_id", job.chat_id);
  form.append("caption", caption);
  form.append("document", new Blob([bytes], { type: "image/png" }), "certificate.png");

  let sent = false;
  try {
    const res = await fetch(TG(env, "sendDocument"), {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(90000),
    });
    sent = res.ok;
  } catch {
    sent = false;
  }

  if (!sent) {
    await failJob(env, id, "send");
    return { status: 502, error: "telegram" };
  }
  await finishJob(env, id, "done");
  await notify(env, job, "✅ گواهیِ «" + job.name + "» ارسال شد.");
  return { status: 200 };
}

// ─── گیرکردن ─────────────────────────────────────────────────────

export async function sweepAndNotify(env, now = Date.now()) {
  const { stale, purged } = await sweep(env, now);
  for (const job of stale) await notify(env, job, failureText(job, job.error));
  return { failed: stale.length, purged };
}

/**
 * برای کرانِ پنج‌دقیقه‌ای: فقط وقتی کاری در جریان است چیزی می‌خواند.
 * در روزِ عادی یک خواندنِ یک‌ردیفی از bot_config است و بس.
 */
export async function sweepIfPending(env, now = Date.now()) {
  const flag = await readConfig(env, PENDING_FLAG).catch(() => "");
  if (!flag) return { skipped: true };
  const r = await sweepAndNotify(env, now);
  if ((await countActive(env)) === 0) await writeConfig(env, PENDING_FLAG, "");
  return r;
}

/** پایانِ اجرای ورک‌فلو: هرچه نیمه‌کاره مانده شکست‌خورده است و مدیر باید بداند. */
export async function failLeftovers(env) {
  const rows = await failAllRendering(env);
  for (const job of rows) await notify(env, job, failureText(job, "render"));
  return rows.length;
}
