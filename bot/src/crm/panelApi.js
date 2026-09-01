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
  login, clientIp, requireSession, forgotPassword, resetPassword, changePassword,
  updateDisplayName, updateUsername, updateAvatar, pruneSessions, revokeSessions,
} from "./auth.js";
import { ensureCrmSchema } from "./schema.js";
import * as R from "./reads.js";
import * as W from "./writes.js";
import * as DASH from "./dashboards.js";

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
    const res = await login(env, b.username, b.password, clientIp(request));
    if (res.locked) {
      // ۴۲۹ و نه ۴۰۱: صفحه باید بتواند «رمز غلط» را از «فعلاً صبر کن»
      // جدا کند، وگرنه کاربری که رمزش درست است هم فکر می‌کند اشتباه
      // می‌زند و همان‌طور ادامه می‌دهد.
      return json(
        {
          success: false,
          error: "تلاش‌های ناموفق زیاد بود. لطفاً " +
            Math.ceil((res.retry_after_s || 60) / 60) + " دقیقه دیگر دوباره امتحان کنید.",
          retry_after_s: res.retry_after_s,
        },
        429
      );
    }
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

  // ─── خواندنی‌ها ────────────────────────────────────────────────────
  // شکل پاسخ عمداً آرایه‌ی خام است، نه {success, data}. توضیحش در
  // reads.js است؛ خلاصه‌اش: صفحه‌ها همین را انتظار دارند.
  if (request.method === "GET") {
    const LISTS = {
      "/crm/leads": R.listLeads,
      "/crm/calls": R.listCalls,
      "/crm/products": R.listProducts,
      "/crm/consultants": R.listConsultants,
      "/crm/admins": R.listAdmins,
      "/crm/mentoring-requests": R.listMentoring,
      "/crm/support-tickets": R.listTickets,
      "/crm/errors": R.listErrors,
      "/crm/broadcasts": R.listBroadcasts,
      "/crm/content-texts": R.listContentTexts,
      "/crm/content-files": R.listContentFiles,
      "/crm/econ-subscribers": R.listEconSubscribers,
    };
    if (LISTS[path]) return json(await LISTS[path](env));

    if (path === "/crm/lead/activity") {
      return json(await R.leadActivity(env, url.searchParams.get("id")));
    }
    if (path === "/crm/support-ticket") {
      return json(await R.ticketDetail(env, url.searchParams.get("id")));
    }
    if (path === "/crm/followups/today") {
      return json(await R.followupsToday(env));
    }
    if (path === "/crm/lead") {
      return json(await R.leadDetail(env, url.searchParams.get("id")));
    }
    if (path === "/crm/admin-dashboard") {
      return json(await R.adminDashboard(env, url.searchParams.get("range")));
    }

    const DASHBOARDS = {
      "/crm/dashboard/sales-kpi": DASH.salesKpi,
      "/crm/dashboard/consultant-performance": DASH.consultantPerformance,
      "/crm/dashboard/funnel": DASH.funnel,
      "/crm/dashboard/source-performance": DASH.sourcePerformance,
    };
    if (DASHBOARDS[path]) {
      // جدول عملکرد مشاوران را مشاورها نمی‌بینند - همان قاعده‌ای که n8n
      // داشت. کسی که خودش در جدول است نباید عملکرد بقیه را ببیند.
      if (path.endsWith("consultant-performance") && session.role === "consultant") {
        return unauthorized();
      }
      return json(await DASHBOARDS[path](env));
    }
  }

  // ─── نوشتنی‌ها ─────────────────────────────────────────────────────
  if (request.method === "POST") {
    const b = await readBody(request);
    const who = session.username;

    // فرستنده‌ی تلگرام به writes تزریق می‌شود نه اینکه داخلش import شود:
    // این‌طور تست می‌تواند بدونِ شبکه اجرا شود و ببیند چه چیزی قرار بوده
    // فرستاده شود.
    // سه شکلِ ارسال، چون سه نیازِ متفاوت است: یکی فقط می‌خواهد بداند رفت
    // یا نه، یکی شناسه‌ی پیام را لازم دارد (برای اینکه بعداً بشود پاکش
    // کرد)، و یکی حذف می‌کند. همه تزریق می‌شوند تا تست بدون شبکه بتواند
    // ببیند چه چیزی قرار بوده فرستاده شود.
    const tg = async (method, payload) => {
      try {
        const r = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify(payload),
        });
        return await r.json();
      } catch {
        return { ok: false };
      }
    };

    const sendRaw = async (chatId, text) => {
      const out = await tg("sendMessage", { chat_id: String(chatId), text });
      return out && out.ok
        ? { ok: true, message_id: out.result && out.result.message_id }
        : { ok: false };
    };

    const deleteMsg = async (chatId, messageId) => {
      const out = await tg("deleteMessage", { chat_id: String(chatId), message_id: Number(messageId) });
      return !!(out && out.ok);
    };

    const send = async (chatId, text) => {
      try {
        const r = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendMessage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({ chat_id: chatId, text }),
        });
        return r.ok;
      } catch {
        return false;
      }
    };

    const WRITES = {
      "/crm/lead/status": () => W.setLeadStatus(env, b, who),
      "/crm/lead/note": () => W.addLeadNote(env, b, who),
      "/crm/lead/assign": () => W.assignLead(env, b, who),
      "/crm/lead/followup": () => W.setFollowup(env, b, who),
      "/crm/lead/source": () => W.setLeadSource(env, b, who),
      "/crm/lead/purchase": () => W.recordPurchase(env, b, who),
      "/crm/lead/create": () => W.createManualLead(env, b, who),
      "/crm/calls": () => W.recordCall(env, b, who),
      "/crm/support-ticket/status": () => W.setTicketStatus(env, b),
      "/crm/support-ticket/reply": () => W.replyTicket(env, b, who, send),
      "/crm/product/price": () => W.setProductPrice(env, b),
      "/crm/error/resolve": () => W.resolveError(env, b),
      "/crm/content-text/save": () => W.saveContentText(env, b),
      "/crm/content-file/save": () => W.saveContentFile(env, b),
      "/crm/econ-subscriber/unsubscribe": () => W.unsubscribeEcon(env, b),
      // این پنج تا در انتقال جا مانده بودند و تا خاموش شدنِ n8n بی‌صدا
      // به آنجا می‌رفتند.
      "/crm/lead/send-message": () => W.sendLeadMessage(env, b, who, send),
      "/crm/lead/reminder": () => W.setLeadReminder(env, b, who),
      "/crm/admin/save": () => W.saveAdminUser(env, b),
      "/crm/broadcast": () => W.sendBroadcast(env, b, who, sendRaw),
      "/crm/broadcast/delete": () => W.deleteBroadcast(env, b, deleteMsg),
    };

    if (WRITES[path]) {
      const res = await WRITES[path]();
      if (!res.ok) return json({ success: false, error: res.error }, 400);
      const { ok, ...rest } = res;
      return json({ success: true, ...rest });
    }
  }

  // مسیر CRM است ولی هنوز منتقل نشده. ۵۰۱ عمدی است و نه ۴۰۴: صفحه باید
  // بتواند «هنوز پیاده نشده» را از «وجود ندارد» جدا کند.
  return json({ success: false, error: "not implemented yet", path }, 501);
}
