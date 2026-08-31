// مسیریابِ API پنل CRM روی ورکر.
//
// جای‌گزینِ وبهوک‌های WF-15. هر مرحله از انتقال، چند مسیر به این فایل
// اضافه می‌کند؛ فعلاً فقط احراز هویت.
//
// مسیرها زیر /crm/ می‌آیند، دقیقاً با همان نام‌هایی که n8n داشت. صفحه‌ها
// فقط باید API_BASE را عوض کنند، نه اینکه هر فراخوانی بازنویسی شود - و
// در دوره‌ی موازی همین یعنی می‌شود با یک متغیر بین دو پیاده‌سازی جابه‌جا
// شد و خروجی‌شان را مقایسه کرد.

import {
  login, requireSession, forgotPassword, resetPassword, changePassword,
  updateDisplayName, updateUsername, updateAvatar, pruneSessions, revokeSessions,
} from "./auth.js";
import { ensureCrmSchema } from "./schema.js";

// صفحه‌ها روی GitHub Pages میزبانی می‌شوند و ورکر جای دیگری است، پس هر
// پاسخ باید سرآیندهای CORS داشته باشد - از جمله پاسخ‌های خطا، وگرنه
// مرورگر پیامِ خطا را هم به صفحه نمی‌دهد و کاربر «یک مشکلی پیش آمد»
// خالی می‌بیند.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

async function readBody(request) {
  try {
    return (await request.json()) || {};
  } catch {
    return {};
  }
}

const unauthorized = () => json({ success: false, error: "unauthorized" }, 401);

// مسیرهایی که زیر /crm/ هستند ولی مالِ این مسیریاب نیستند.
//
// /crm/phones از قبل روی ورکر بود و منبع اصلی‌اش همین D1 است، نه n8n -
// شماره‌ها را خودِ ربات می‌گیرد. احراز هویتش هم فرق دارد: چون دانلود CSV
// با <a download> انجام می‌شود و مرورگر رویش هدر نمی‌گذارد، توکن را از
// کوئری هم می‌پذیرد. اگر این مسیریاب آن را می‌بلعید، صفحه‌ی شماره‌ها
// بی‌صدا ۵۰۱ می‌گرفت.
const NOT_OURS = ["/crm/phones"];

/**
 * درخواست را می‌گیرد و اگر مسیرش مالِ CRM است جواب می‌دهد، وگرنه null -
 * تا ورکر بقیه‌ی مسیرهایش را ادامه بدهد.
 *
 * @returns {Promise<Response|null>}
 */
export async function handleCrmApi(request, url, env) {
  if (!url.pathname.startsWith("/crm/")) return null;
  if (NOT_OURS.some((p) => url.pathname === p || url.pathname.startsWith(p + "/"))) return null;

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  await ensureCrmSchema(env);
  const path = url.pathname;

  // ─── مسیرهای بدون نشست ─────────────────────────────────────────────
  // فقط همین سه‌تا. هر چیز دیگری نشست می‌خواهد.

  if (path === "/crm/auth/login" && request.method === "POST") {
    const b = await readBody(request);
    const res = await login(env, b.username, b.password);
    if (!res.ok) return json({ success: false }, 401);
    // شکلِ پاسخ عمداً همان n8n است تا صفحه‌ی ورود دست نخورد.
    return json({
      success: true,
      token: res.session.token,
      expires_at: res.session.expires_at,
      username: res.user.username,
      display_name: res.user.display_name,
      role: res.user.role,
      avatar: res.user.avatar,
    });
  }

  if (path === "/crm/auth/forgot-password" && request.method === "POST") {
    const b = await readBody(request);
    const res = await forgotPassword(env, b.username);
    return json({ success: true, message: res.message });
  }

  if (path === "/crm/auth/reset-password" && request.method === "POST") {
    const b = await readBody(request);
    const res = await resetPassword(env, b.username, b.code, b.new_password);
    return res.ok ? json({ success: true }) : json({ success: false, error: res.error }, 400);
  }

  // ─── از اینجا به بعد، نشست لازم است ────────────────────────────────
  const session = await requireSession(env, request);
  if (!session) return unauthorized();

  if (path === "/crm/auth/change-password" && request.method === "POST") {
    const b = await readBody(request);
    const res = await changePassword(env, session.username, b.current_password, b.new_password);
    return res.ok ? json({ success: true }) : json({ success: false, error: res.error }, 400);
  }

  if (path === "/crm/auth/update-name" && request.method === "POST") {
    const b = await readBody(request);
    await updateDisplayName(env, session.username, b.display_name || b.name);
    return json({ success: true });
  }

  if (path === "/crm/auth/update-username" && request.method === "POST") {
    const b = await readBody(request);
    const res = await updateUsername(env, session.username, b.new_username, b.password);
    return res.ok
      ? json({ success: true, username: res.username })
      : json({ success: false, error: res.error }, 400);
  }

  if (path === "/crm/auth/update-avatar" && request.method === "POST") {
    const b = await readBody(request);
    await updateAvatar(env, session.username, b.avatar);
    return json({ success: true });
  }

  // خروج - در n8n وجود نداشت و دکمه‌ی خروج فقط توکن را از مرورگر پاک
  // می‌کرد. یعنی توکن تا انقضایش زنده می‌ماند و اگر جایی لو رفته بود،
  // «خروج» هیچ کاری نمی‌کرد.
  if (path === "/crm/auth/logout" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM crm_session WHERE token = ?").bind(session.token).run();
    return json({ success: true });
  }

  // خروج از همه‌ی دستگاه‌ها.
  if (path === "/crm/auth/logout-all" && request.method === "POST") {
    const revoked = await revokeSessions(env, session.username);
    return json({ success: true, revoked });
  }

  if (path === "/crm/auth/me" && request.method === "GET") {
    // زباله‌روبی را به همین مسیر چسبانده‌ایم: هر بار که صفحه‌ای بالا
    // می‌آید، چند ردیفِ منقضی هم پاک می‌شود. بدون یک زمان‌بندِ جداگانه.
    await pruneSessions(env).catch(() => {});
    return json({ success: true, username: session.username, role: session.role, display_name: session.display_name });
  }

  // مسیر CRM است ولی هنوز منتقل نشده. ۵۰۱ عمدی است و نه ۴۰۴: صفحه باید
  // بتواند «هنوز پیاده نشده» را از «وجود ندارد» جدا کند.
  return json({ success: false, error: "not implemented yet", path }, 501);
}
