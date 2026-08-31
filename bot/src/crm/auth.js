// احراز هویت CRM، روی ورکر.
//
// جای‌گزینِ هفت اندپوینت n8n: ورود، فراموشی رمز، بازنشانی، تغییر رمز،
// تغییر نام، تغییر نام کاربری، تغییر آواتار.
//
// ─── سازگاری با رمزهای موجود ────────────────────────────────────────
// همان الگوریتمِ n8n: SHA-256 هگزِ (رمز + نمک). عمداً عوض نشد. اگر
// الگوریتم را «بهتر» می‌کردم، رمزِ همه‌ی حساب‌های موجود در لحظه‌ی سوییچ
// باطل می‌شد و مهاجرت به یک قفلِ در بسته تبدیل می‌شد. سخت‌تر کردنِ هش
// کارِ درستی است، ولی کارِ جداگانه‌ای است - با مسیرِ ارتقای تدریجی، نه
// وسط یک انتقال.
//
// ─── شکافی که اینجا بسته می‌شود ─────────────────────────────────────
// در نسخه‌ی n8n، اعتبارسنجی نشست فقط تاریخ انقضا را می‌سنجید. یعنی
// غیرفعال کردن یک حساب، نشستِ بازش را نمی‌بست و تا دوازده ساعت دسترسی
// باز می‌ماند. اینجا requireSession خودِ حساب را هم می‌خواند و فعال
// بودنش را می‌سنجد - پس غیرفعال کردن، در همان لحظه اثر می‌کند.

import { ensureCrmSchema } from "./schema.js";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RESET_TTL_MS = 10 * 60 * 1000;
const MIN_PASSWORD = 6;

// ─── رمزنگاری ────────────────────────────────────────────────────────

function toHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return toHex(a.buffer);
}

/** SHA-256 هگز از «رمز + نمک» - دقیقاً همان چیزی که نود Crypto می‌ساخت. */
export async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(String(password || "") + String(salt || ""));
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

/** نمکِ تازه. سی‌ودو کاراکتر هگز، هم‌اندازه‌ی نمک‌های موجود. */
export function newSalt() {
  return randomHex(16);
}

/**
 * مقایسه‌ی هش‌ها در زمانِ ثابت.
 *
 * مقایسه‌ی معمولیِ رشته‌ها به‌محض اولین کاراکترِ متفاوت برمی‌گردد، و آن
 * اختلافِ زمانی - هرچند ریز - قابل اندازه‌گیری است. n8n با === مقایسه
 * می‌کرد؛ اینجا لازم نبود همان اشتباه تکرار شود.
 */
export function safeEqual(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// ─── کمک‌های جدول ────────────────────────────────────────────────────

// «فعال» سخت‌گیرانه و بسته‌شکست: هر چیزی جز یک آریِ صریح یعنی نه.
function isActive(v) {
  return v === 1 || v === true || v === "1" || v === "true";
}

async function getAdmin(env, username) {
  const u = String(username || "").trim();
  if (!u) return null;
  return env.DB.prepare("SELECT * FROM crm_admin WHERE username = ?").bind(u).first();
}

function publicAdmin(row) {
  return {
    username: row.username,
    display_name: row.display_name || "",
    role: row.role || "admin",
    avatar: row.avatar || "",
  };
}

// ─── نشست ────────────────────────────────────────────────────────────

export function bearerFrom(request) {
  const h = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  return h.replace(/^Bearer\s+/i, "").trim();
}

async function issueSession(env, row) {
  const token = randomHex(32);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO crm_session (token, username, role, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(token, row.username, row.role || "admin", new Date(now + SESSION_TTL_MS).toISOString(), new Date(now).toISOString())
    .run();
  return { token, expires_at: new Date(now + SESSION_TTL_MS).toISOString() };
}

/**
 * نشست را می‌سنجد و صاحبش را برمی‌گرداند.
 *
 * دو شرط، نه یکی: توکن منقضی نشده باشد، و حسابِ صاحبش هنوز فعال باشد.
 * شرط دوم همان چیزی است که نسخه‌ی n8n نداشت.
 *
 * @returns {Promise<{username:string, role:string, display_name:string}|null>}
 */
export async function requireSession(env, request) {
  const token = bearerFrom(request);
  if (!token) return null;

  const row = await env.DB
    .prepare(
      `SELECT s.token, s.expires_at, a.username, a.role, a.display_name, a.active, a.avatar
         FROM crm_session s JOIN crm_admin a ON a.username = s.username
        WHERE s.token = ?`
    )
    .bind(token)
    .first();

  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  if (!isActive(row.active)) return null;

  return { username: row.username, role: row.role || "admin", display_name: row.display_name || "", token };
}

/** همه‌ی نشست‌های یک کاربر را می‌بندد. */
export async function revokeSessions(env, username) {
  const res = await env.DB.prepare("DELETE FROM crm_session WHERE username = ?").bind(username).run();
  return res && res.meta ? res.meta.changes || 0 : 0;
}

/** نشست‌های منقضی. زباله‌روبیِ ساده، تا جدول بی‌نهایت رشد نکند. */
export async function pruneSessions(env) {
  const res = await env.DB
    .prepare("DELETE FROM crm_session WHERE expires_at <= ?")
    .bind(new Date().toISOString())
    .run();
  return res && res.meta ? res.meta.changes || 0 : 0;
}

// ─── ورود ────────────────────────────────────────────────────────────

/**
 * @returns {Promise<{ok:true, session:object, user:object}|{ok:false}>}
 *
 * هیچ‌وقت نمی‌گوید کدام‌یک اشتباه بود - نام کاربری، رمز، یا غیرفعال
 * بودن. همه یک جواب می‌گیرند.
 */
export async function login(env, username, password, ip = "") {
  await ensureCrmSchema(env);

  const gate = await throttleCheck(env, username, ip);
  if (gate.locked) return { ok: false, locked: true, retry_after_s: gate.retry_after_s };

  const row = await getAdmin(env, username);
  if (!row) return failLogin(env, username, ip);
  if (!isActive(row.active)) return failLogin(env, username, ip);
  // بدون هش، هیچ راهی برای ورود نیست. مسیرِ «رمزِ متنِ ساده» که در n8n
  // بود اینجا اصلاً وجود ندارد؛ ستونش هم منتقل نشد.
  if (!row.password_hash || !row.password_salt) return failLogin(env, username, ip);

  const computed = await hashPassword(password, row.password_salt);
  if (!safeEqual(computed, row.password_hash)) return failLogin(env, username, ip);

  await clearAttempts(env, username, ip);
  const session = await issueSession(env, row);
  return { ok: true, session, user: publicAdmin(row) };
}

// ─── محدودکردن تلاشِ ورود ────────────────────────────────────────────
//
// هش ما SHA-256 است - عمداً، چون باید با رمزهای موجود سازگار می‌ماند -
// و SHA-256 سریع است. یعنی تنها چیزی که بین یک مهاجم و چهار حسابِ این
// پنل ایستاده، سرعتِ درخواست است. این بخش همان را می‌گیرد.
//
// کلید، «کاربر + IP» است نه فقط کاربر. دلیلش مهم است: اگر فقط روی نام
// کاربری قفل می‌کردیم، هر کسی می‌توانست با چند رمزِ غلط، حسابِ یک مشاور
// را عمداً قفل کند. با این کلید، قفل روی همان کسی می‌افتد که تلاش
// می‌کند، نه روی صاحب حساب.
//
// یک سقفِ دوم هم روی خودِ IP هست، برای وقتی که مهاجم به‌جای یک حساب،
// چند حساب را با یک رمز امتحان می‌کند - که از دید کلیدِ اول اصلاً تلاشِ
// تکراری نیست.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_USER_IP = 8;
const MAX_PER_IP = 30;

export function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    ""
  ).split(",")[0].trim();
}

const userKey = (u, ip) => "u:" + String(u || "").trim().toLowerCase() + "|" + ip;
const ipKey = (ip) => "ip:" + ip;

async function bump(env, key, limit, now) {
  const row = await env.DB
    .prepare("SELECT fails, window_start FROM crm_login_attempt WHERE key = ?")
    .bind(key)
    .first();

  // پنجره که گذشت، شمارش از نو. یک تلاشِ غلط سه ساعت پیش، نشانه‌ی حمله
  // نیست و نباید روی کاربرِ امروز اثر بگذارد.
  const fresh = row && now - new Date(row.window_start).getTime() < WINDOW_MS;
  const fails = (fresh ? row.fails : 0) + 1;
  const start = fresh ? row.window_start : new Date(now).toISOString();

  await env.DB
    .prepare(
      `INSERT INTO crm_login_attempt (key, fails, window_start) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET fails = excluded.fails, window_start = excluded.window_start`
    )
    .bind(key, fails, start)
    .run();

  return fails >= limit ? WINDOW_MS - (now - new Date(start).getTime()) : 0;
}

async function isLocked(env, key, limit, now) {
  const row = await env.DB
    .prepare("SELECT fails, window_start FROM crm_login_attempt WHERE key = ?")
    .bind(key)
    .first();
  if (!row) return 0;
  const elapsed = now - new Date(row.window_start).getTime();
  if (elapsed >= WINDOW_MS) return 0;
  return row.fails >= limit ? WINDOW_MS - elapsed : 0;
}

/** @returns {Promise<{locked:boolean, retry_after_s?:number}>} */
export async function throttleCheck(env, username, ip) {
  if (!ip) return { locked: false }; // بدون IP، قفلِ اشتباه بدتر از نبودنش است
  const now = Date.now();
  const wait = Math.max(
    await isLocked(env, userKey(username, ip), MAX_PER_USER_IP, now),
    await isLocked(env, ipKey(ip), MAX_PER_IP, now)
  );
  return wait > 0 ? { locked: true, retry_after_s: Math.ceil(wait / 1000) } : { locked: false };
}

async function failLogin(env, username, ip) {
  if (ip) {
    const now = Date.now();
    await bump(env, userKey(username, ip), MAX_PER_USER_IP, now).catch(() => {});
    await bump(env, ipKey(ip), MAX_PER_IP, now).catch(() => {});
  }
  // پاسخ همان «نشد» است، بدون اینکه بگوید چند تلاش مانده - شمردنِ
  // تلاش‌ها هم خودش یک نشتِ اطلاعات است.
  return { ok: false };
}

async function clearAttempts(env, username, ip) {
  if (!ip) return;
  await env.DB
    .prepare("DELETE FROM crm_login_attempt WHERE key = ?")
    .bind(userKey(username, ip))
    .run()
    .catch(() => {});
}

// ─── فراموشی و بازنشانی رمز ──────────────────────────────────────────

const API = (env, method) => "https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method;

async function sendTelegram(env, chatId, text) {
  try {
    const res = await fetch(API(env, "sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * کد بازیابی می‌سازد و به تلگرام صاحب حساب می‌فرستد.
 *
 * پاسخ همیشه یکسان است، چه حساب باشد چه نباشد - وگرنه این اندپوینت به
 * یک ابزارِ «کدام نام‌های کاربری وجود دارند» تبدیل می‌شود.
 */
export async function forgotPassword(env, username) {
  await ensureCrmSchema(env);
  const row = await getAdmin(env, username);

  if (row && isActive(row.active) && row.telegram_chat_id) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + RESET_TTL_MS).toISOString();
    await env.DB
      .prepare("UPDATE crm_admin SET reset_code = ?, reset_expires = ? WHERE username = ?")
      .bind(code, expires, row.username)
      .run();
    await sendTelegram(
      env,
      row.telegram_chat_id,
      "کد بازیابی رمز عبور CRM آکادمی سبحان صمدی:\n\n" + code +
        "\n\nاین کد تا ۱۰ دقیقه معتبر است. اگر این درخواست را شما نفرستاده‌اید، نادیده بگیرید."
    );
  }

  return { ok: true, message: "اگر این نام کاربری معتبر باشد، کد بازیابی از طریق تلگرام برای شما ارسال شد." };
}

async function setPassword(env, username, newPassword) {
  const salt = newSalt();
  const hash = await hashPassword(newPassword, salt);
  await env.DB
    .prepare(
      `UPDATE crm_admin SET password_hash = ?, password_salt = ?, reset_code = '',
              reset_expires = '', updated_at = ? WHERE username = ?`
    )
    .bind(hash, salt, new Date().toISOString(), username)
    .run();
}

export async function resetPassword(env, username, code, newPassword) {
  await ensureCrmSchema(env);

  if (!newPassword || String(newPassword).length < MIN_PASSWORD) {
    return { ok: false, error: "رمز جدید باید حداقل ۶ کاراکتر باشد." };
  }

  const row = await getAdmin(env, username);
  const bad = { ok: false, error: "کد بازیابی معتبر نیست. دوباره درخواست کد کنید." };

  // «حساب غیرفعال است» همان پیامِ «کد نامعتبر» را می‌گیرد: نباید لو برود
  // که این نام کاربری وجود دارد ولی خاموش است.
  if (!row || !isActive(row.active)) return bad;
  if (!row.reset_code || !row.reset_expires) return bad;
  if (!safeEqual(row.reset_code, String(code || "").trim())) {
    return { ok: false, error: "کد بازیابی اشتباه است." };
  }
  if (new Date(row.reset_expires).getTime() <= Date.now()) {
    return { ok: false, error: "کد بازیابی منقضی شده است. دوباره درخواست کد کنید." };
  }

  await setPassword(env, row.username, newPassword);
  // رمز که عوض شد، نشست‌های قبلی باید بمیرند. اگر کسی رمز را به این دلیل
  // عوض می‌کند که فکر می‌کند لو رفته، نشستِ بازِ آن نفر باید همان لحظه
  // بسته شود - نه دوازده ساعت بعد.
  const revoked = await revokeSessions(env, row.username);
  return { ok: true, revoked };
}

export async function changePassword(env, username, currentPassword, newPassword) {
  if (!newPassword || String(newPassword).length < MIN_PASSWORD) {
    return { ok: false, error: "رمز جدید باید حداقل ۶ کاراکتر باشد." };
  }
  const row = await getAdmin(env, username);
  if (!row || !row.password_hash) return { ok: false, error: "رمز فعلی اشتباه است." };

  const computed = await hashPassword(currentPassword, row.password_salt);
  if (!safeEqual(computed, row.password_hash)) {
    return { ok: false, error: "رمز فعلی اشتباه است." };
  }

  await setPassword(env, row.username, newPassword);
  // نشستِ خودِ کاربر هم بسته می‌شود و دوباره وارد می‌شود. یک بار زحمت،
  // در برابر اینکه یک نشستِ دزدیده‌شده از تغییر رمز جان سالم به در ببرد.
  const revoked = await revokeSessions(env, row.username);
  return { ok: true, revoked };
}

// ─── ویرایش پروفایل ──────────────────────────────────────────────────

export async function updateDisplayName(env, username, name) {
  await env.DB
    .prepare("UPDATE crm_admin SET display_name = ?, updated_at = ? WHERE username = ?")
    .bind(String(name || "").trim(), new Date().toISOString(), username)
    .run();
  return { ok: true };
}

export async function updateAvatar(env, username, avatar) {
  await env.DB
    .prepare("UPDATE crm_admin SET avatar = ?, updated_at = ? WHERE username = ?")
    .bind(String(avatar || ""), new Date().toISOString(), username)
    .run();
  return { ok: true };
}

/**
 * تغییر نام کاربری.
 *
 * نام کاربری کلیدِ اصلی است و جاهای دیگر (تماس‌ها، تخصیص لید، لاگ) به آن
 * ارجاع می‌دهند. پس صرفِ عوض کردنِ یک ردیف کافی نیست - ارجاع‌ها هم باید
 * دنبالش بروند، وگرنه تاریخچه‌ی آن شخص بی‌صاحب می‌شود.
 */
export async function updateUsername(env, oldName, newNameRaw, password) {
  const newName = String(newNameRaw || "").trim();
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(newName)) {
    return { ok: false, error: "نام کاربری باید ۳ تا ۳۲ کاراکتر و فقط شامل حروف انگلیسی، عدد، نقطه، خط تیره و زیرخط باشد." };
  }

  const row = await getAdmin(env, oldName);
  if (!row || !row.password_hash) return { ok: false, error: "رمز عبور اشتباه است." };
  const computed = await hashPassword(password, row.password_salt);
  if (!safeEqual(computed, row.password_hash)) {
    return { ok: false, error: "رمز عبور اشتباه است." };
  }

  const taken = await getAdmin(env, newName);
  if (taken) return { ok: false, error: "این نام کاربری قبلاً گرفته شده است." };

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE crm_admin SET username = ?, updated_at = ? WHERE username = ?").bind(newName, now, oldName),
    env.DB.prepare("UPDATE crm_session SET username = ? WHERE username = ?").bind(newName, oldName),
    env.DB.prepare("UPDATE crm_calls SET admin_username = ? WHERE admin_username = ?").bind(newName, oldName),
    env.DB.prepare("UPDATE crm_leads SET assigned_to = ? WHERE assigned_to = ?").bind(newName, oldName),
    env.DB.prepare("UPDATE crm_activity_log SET actor = ? WHERE actor = ?").bind(newName, oldName),
    env.DB.prepare("UPDATE crm_support_tickets SET assigned_to = ? WHERE assigned_to = ?").bind(newName, oldName),
    env.DB.prepare("UPDATE crm_admin_action_log SET admin_username = ? WHERE admin_username = ?").bind(newName, oldName),
    env.DB.prepare("UPDATE crm_rr_state SET last_assigned_username = ? WHERE last_assigned_username = ?").bind(newName, oldName),
  ]);

  return { ok: true, username: newName };
}
