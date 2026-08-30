import { webhookCallback } from "grammy";
import { createBot } from "./bot.js";
import { syncFromN8n, readSyncState } from "./econ/store.js";
import { drainLeadOutbox } from "./crmSync.js";
import { handleMiniapp } from "./econ/miniapp.js";
import { PUBLIC_COMMANDS } from "./commands/registry.js";
import { handleAiApi, corsPreflight } from "./admin/aiApi.js";
import { isValidCrmSession } from "./admin/crmAuth.js";
import { handleMentoringIntake } from "./intake/mentoringForm.js";
import { syncCrmMirror } from "./crm/mirror.js";
import { handleMirrorApi, mirrorPreflight } from "./crm/api.js";

// grammy طبیعتاً روی اولین استفاده از بات یک درخواست getMe به تلگرام
// می‌زند تا اطلاعات خود بات را بگیرد. چون این Worker برای هر پیام یک
// نمونه‌ی تازه از Bot می‌سازد (روی Cloudflare Workers نمی‌شود حالت
// سراسری بین درخواست‌ها به‌طور مطمئن نگه داشت)، این یعنی یک رفت‌وبرگشت
// اضافه‌ی غیرضروری به تلگرام روی هر تک پیام - که با انباشته شدن روی
// هم (چک عضویت + نوشتن در D1 + چند پیام پشت‌سرهم) می‌تواند به تایم‌اوت
// سمت کلاینت تلگرام برای answerCallbackQuery نزدیک شود. اطلاعات بات
// ثابت است، پس یک‌بار می‌گیریم و به تمام نمونه‌های بعدی تزریق می‌کنیم -
// در حافظه‌ی این isolate تا وقتی گرمه.
let cachedBotInfo = null;

// فهرست دستورها فقط یک‌بار روی هر isolate سرد ثبت می‌شود.
//
// بدون این، کاربر وقتی / را تایپ می‌کند هیچ پیشنهادی نمی‌بیند و دکمه‌ی
// منوی تلگرام خالی است - برای رباتی که قرار است عمومی شود، یعنی نیمی از
// کاربران هرگز /help را پیدا نمی‌کنند. تلگرام این فراخوانی را idempotent
// می‌داند، پس تکرارش روی isolateهای بعدی ضرری ندارد.
let commandsRegistered = false;

// نشانه‌ی نسخه. اگر /health چیز دیگری برگرداند، یعنی کدِ روی هوا قدیمی
// است و مشکل از تنظیمات نیست - از دیپلوی.
const BUILD = "econ+outbox+miniapp+faq+public+kb-11-numbered";

// تلگرام پست‌های کانال را فقط وقتی می‌فرستد که allowed_updates وبهوک
// آن‌ها را شامل شود.
//
// اگر وبهوک زمانی با فهرست محدودی ثبت شده باشد - مثلاً فقط message و
// callback_query، که در نصب‌های n8n رایج است - پست‌های کانال سمت تلگرام
// دور ریخته می‌شوند و هرگز به ورکر نمی‌رسند. از بیرون این دقیقاً شبیه
// «ربات کار نمی‌کند» است: نه خطایی، نه لاگی، هیچ.
//
// فهرست خالی یعنی «همه‌ی انواع پیش‌فرض» که channel_post را شامل می‌شود،
// پس فقط فهرست‌های صریحِ ناقص اصلاح می‌شوند.
//
// هر دو نوع لازم‌اند، نه فقط اولی: حذف محتوا با ویرایش کپشن همان پست
// انجام می‌شود و ویرایش، edited_channel_post است. نسخه‌ی قبلی این تابع
// به‌محض دیدن channel_post برمی‌گشت و edited_channel_post هرگز اضافه
// نمی‌شد - ویرایش‌ها بی‌صدا سمت تلگرام دور ریخته می‌شدند.
export const REQUIRED_UPDATES = ["channel_post", "edited_channel_post"];

async function ensureChannelPostsAllowed(bot) {
  const info = await bot.api.getWebhookInfo();
  const allowed = info && info.allowed_updates;
  if (!Array.isArray(allowed) || allowed.length === 0) return;
  const missing = REQUIRED_UPDATES.filter((t) => !allowed.includes(t));
  if (missing.length === 0) return;
  if (!info.url) return;

  const next = [...new Set([...allowed, ...REQUIRED_UPDATES])];
  // همان آدرس قبلی دوباره ثبت می‌شود و فقط فهرست گسترده می‌شود.
  // drop_pending_updates عمداً false است تا پیامی در صف از بین نرود.
  await bot.api.setWebhook(info.url, { allowed_updates: next, drop_pending_updates: false });
  console.log("allowed_updates اصلاح شد:", JSON.stringify(next));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // بدون این، پاسخ می‌تواند کش شود و ساعت‌ها همان خطای قدیمی را نشان
      // بدهد در حالی که مشکل حل شده - دقیقاً چیزی که تشخیص را گمراه می‌کند.
      "Cache-Control": "no-store, max-age=0",
      // صفحه‌ی CRM روی دامنه‌ی دیگری است. بدون این هدر روی پاسخِ ۴۰۱ هم،
      // مرورگر متن خطا را دور می‌ریزد و صفحه فقط «خطای شبکه» می‌بیند -
      // یعنی «کلید غلط است» و «ورکر خوابیده» از هم جدا نمی‌شوند.
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function handleAdmin(request, url, env) {
  // صفحه‌ی هوش مصنوعی CRM رمز جدا نمی‌خواهد.
  //
  // مدیر یک‌بار وارد CRM شده و توکن دارد؛ همان توکن را می‌فرستد و ورکر
  // از n8n می‌پرسد معتبر است یا نه. کلید مدیر همچنان کار می‌کند و
  // پایین‌تر بررسی می‌شود - هم برای مسیرهای تشخیصی، هم به‌عنوان راه
  // ورود وقتی n8n خوابیده و توکن قابل بررسی نیست.
  if (url.pathname.startsWith("/admin/ai/")) {
    const auth = request.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
    if (token && (await isValidCrmSession(env, token))) {
      return handleAiApi(request, url, env);
    }
  }

  // ADMIN_KEY کلید مخصوص همین مسیرهای تشخیصی است و اگر نبود، به کلید
  // تقویم برمی‌گردد.
  //
  // چرا جدا: ECON_EXPORT_KEY یک راز مشترک با n8n است. برای عوض کردنش
  // باید هر دو طرف هم‌زمان به‌روز شوند، وگرنه همگام‌سازی تقویم می‌شکند -
  // یعنی برای «می‌خواهم یک مسیر تشخیصی را باز کنم» باید یک سیستم زنده را
  // دست‌کاری کرد. ADMIN_KEY هیچ طرف دیگری ندارد، پس هر وقت لازم شد
  // بی‌خطر عوض می‌شود.
  const expected = env.ADMIN_KEY || env.ECON_EXPORT_KEY;

  if (!expected) {
    // نامِ متغیرها را برمی‌گرداند، نه مقدارشان. دلیلش این است که «اسم را
    // غلط نوشته‌ای»، «فاصله‌ی اضافه چسبیده» و «اصلاً اضافه نشده» از بیرون
    // یک شکل دارند و بدون دیدن فهرست واقعی نمی‌شود از هم جدایشان کرد.
    // JSON.stringify روی نام‌ها اجرا می‌شود تا فاصله یا کاراکتر نامرئی
    // داخل اسم هم دیده شود.
    const names = Object.keys(env).sort();
    return json(
      {
        ok: false,
        build: BUILD,
        error: "هیچ‌کدام از ADMIN_KEY و ECON_EXPORT_KEY تنظیم نشده‌اند",
        hint: "این‌ها متغیرهایی هستند که ورکر واقعاً می‌بیند - اگر نامی در فهرست نیست یعنی در بخش Runtime ذخیره نشده",
        bindings_present: names.map((n) => JSON.stringify(n)),
        count: names.length,
      },
      503
    );
  }
  // کلید هم از هدر پذیرفته می‌شود هم از کوئری. دلیلش این نیست که راحت‌تر
  // است: اگر کلید کاراکتر + داشته باشد، در رشته‌ی کوئری به فاصله تبدیل
  // می‌شود و بدون اینکه کسی بفهمد چرا، ۴۰۱ می‌گیرد. هدر این تله را ندارد.
  const provided = request.headers.get("x-admin-key") || url.searchParams.get("key") || "";

  if (provided !== expected) {
    // «کلید غلط»، «فاصله‌ی اضافه‌ی کپی‌شده» و «+ که در URL خراب شد» از
    // بیرون یک شکل دارند. این سه نشانه آن‌ها را از هم جدا می‌کنند بدون
    // اینکه خود کلید یا مقدارش جایی برود.
    return json(
      {
        ok: false,
        error: "unauthorized",
        hint: "کلید ارسالی با کلید ورکر یکی نیست",
        diagnostics: {
          provided_length: provided.length,
          length_matches: provided.length === String(expected).length,
          matches_if_trimmed: provided.trim() === String(expected).trim(),
          // اگر این true باشد یعنی + در URL به فاصله تبدیل شده؛ همان کلید
          // را در هدر x-admin-key بفرستید یا + را %2B بنویسید.
          matches_if_plus_restored:
            provided.replace(/ /g, "+") === String(expected),
          sent_via: request.headers.get("x-admin-key") ? "header" : "query",
          // کدام کلید ملاک است - تا معلوم باشد کجا باید ست شود.
          checking_against: env.ADMIN_KEY ? "ADMIN_KEY" : "ECON_EXPORT_KEY",
        },
      },
      401
    );
  }

  if (url.pathname.startsWith("/admin/ai/")) {
    return handleAiApi(request, url, env);
  }

  if (url.pathname === "/admin/sync") {
    try {
      const result = await syncFromN8n(env);
      return json({ ok: true, build: BUILD, synced: result });
    } catch (err) {
      return json({ ok: false, build: BUILD, error: String(err && err.message) }, 502);
    }
  }

  // آیا فید ForexFactory اصلاً عدد «واقعی» دارد؟
  //
  // ستون «واقعی» در جدول تقویم همیشه خالی است. طبق کامنت نود Preserve
  // Released Actuals، این فید هرگز actual نمی‌آورد و اعداد فقط از وبهوک
  // econ/actuals می‌آیند - ولی هیچ‌چیز آن وبهوک را صدا نمی‌زند. کدام
  // درست است، از بیرون قابل حدس نیست و حدس زدنش یعنی ساختن یک
  // زیرساخت کامل برای مشکلی که شاید وجود نداشته باشد.
  //
  // پس به‌جای حدس، از خودِ ورکر می‌پرسیم. فقط می‌خواند و می‌شمارد.
  if (url.pathname === "/admin/ff-probe") {
    try {
      const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return json({ ok: false, error: "فید پاسخ نداد: " + res.status }, 502);
      const feed = await res.json();
      const rows = Array.isArray(feed) ? feed : [];
      const usd = rows.filter((e) => e && (e.country === "USD" || e.country === "All"));
      const withActual = usd.filter((e) => String(e.actual == null ? "" : e.actual).trim());
      const past = usd.filter((e) => e.date && new Date(e.date) < new Date());

      return json({
        ok: true,
        build: BUILD,
        total: rows.length,
        usd_or_global: usd.length,
        // رویدادهایی که زمانشان گذشته: این‌ها باید actual داشته باشند.
        // اگر گذشته زیاد باشد و actual صفر، یعنی فید واقعاً نمی‌آورد.
        already_past: past.length,
        with_actual: withActual.length,
        // نام فیلدها را نشان می‌دهد تا اگر actual اسم دیگری دارد لو برود.
        sample_keys: usd.length ? Object.keys(usd[0]) : [],
        sample_past: past.slice(0, 5).map((e) => ({
          date: e.date,
          title: e.title,
          forecast: e.forecast,
          previous: e.previous,
          actual: e.actual,
        })),
      });
    } catch (err) {
      return json({ ok: false, error: String(err && err.message) }, 502);
    }
  }

  // status: هرگز مقدار متغیرها را برنمی‌گرداند، فقط بودن یا نبودنشان.
  const env_set = {
    ECON_EXPORT_URL: !!env.ECON_EXPORT_URL,
    ECON_EXPLAIN_URL: !!env.ECON_EXPLAIN_URL,
    ECON_MINIAPP_URL: !!env.ECON_MINIAPP_URL,
    ECON_EXPORT_KEY: !!env.ECON_EXPORT_KEY,
    ADMIN_KEY: !!env.ADMIN_KEY,
    CRM_LEAD_INTAKE_URL: !!env.CRM_LEAD_INTAKE_URL,
    CRM_LEAD_INTAKE_KEY: !!env.CRM_LEAD_INTAKE_KEY,
    GEMINI_API_KEY: !!env.GEMINI_API_KEY,
    CONTENT_CHANNEL_ID: !!env.CONTENT_CHANNEL_ID,
    CONTENT_CHANNEL_USERNAME: !!env.CONTENT_CHANNEL_USERNAME,
    DB: !!env.DB,
  };

  async function count(sql) {
    try {
      const row = await env.DB.prepare(sql).first();
      return row ? Object.values(row)[0] : null;
    } catch (err) {
      return "no table";
    }
  }

  return json({
    ok: true,
    build: BUILD,
    env_set,
    last_sync: await readSyncState(env),
    mirrored: {
      events: await count("SELECT COUNT(*) FROM econ_events"),
      labels: await count("SELECT COUNT(*) FROM econ_labels"),
      holidays: await count("SELECT COUNT(*) FROM econ_holidays"),
      ai_cache: await count("SELECT COUNT(*) FROM econ_ai_cache"),
      ai_kb: await count("SELECT COUNT(*) FROM ai_kb"),
      content_files: await count("SELECT COUNT(*) FROM content_library"),
      content_texts: await count("SELECT COUNT(*) FROM text_content"),
    },
    lead_outbox_pending: await count("SELECT COUNT(*) FROM lead_outbox"),
  });
}

export default {
  async fetch(request, env) {
    if (!env.BOT_TOKEN) {
      return new Response("BOT_TOKEN تنظیم نشده است (به‌عنوان secret در Cloudflare ست کنید)", {
        status: 500,
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok " + BUILD);
    }

    // مسیرهای تشخیص. وقتی چیزی کار نمی‌کند، بدون این‌ها باید بین «کد
    // دیپلوی نشده»، «متغیر ست نشده»، «Cron اجرا نمی‌شود» و «n8n جواب
    // نمی‌دهد» حدس زد. این‌ها همان چهار حالت را از هم جدا می‌کنند.
    if (url.pathname === "/admin/status" || url.pathname === "/admin/sync" || url.pathname === "/admin/ff-probe") {
      return handleAdmin(request, url, env);
    }

    // صفحه‌ی «هوش مصنوعی» در CRM. روی دامنه‌ی دیگری است، پس مرورگر اول
    // یک درخواست OPTIONS می‌فرستد - و آن درخواست هدر کلید را ندارد،
    // چون مرورگر عمداً نمی‌فرستدش. پس باید پیش از احراز هویت جواب بگیرد،
    // وگرنه هر درخواستی از صفحه پشت یک ۴۰۱ گیر می‌کند که در کنسول حتی
    // معلوم نیست از کجاست.
    if (url.pathname.startsWith("/admin/ai/")) {
      if (request.method === "OPTIONS") return corsPreflight();
      return handleAdmin(request, url, env);
    }

    // آینه‌ی خواندنی CRM. صفحه فقط وقتی سراغش می‌آید که n8n جواب نداده
    // باشد، پس در حالت سالم هیچ باری اینجا نمی‌آید.
    if (url.pathname.startsWith("/crm-mirror/")) {
      if (request.method === "OPTIONS") return mirrorPreflight();
      const auth = request.headers.get("authorization") || "";
      const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
      if (!token || !(await isValidCrmSession(env, token))) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      return handleMirrorApi(request, url, env);
    }

    // فرم منتورینگ سایت.
    //
    // پیش از این مستقیم به n8n می‌زد و هر رد شدن یعنی یک مشتریِ
    // از‌دست‌رفته، چون وردپرس تلاش مجدد ندارد. حالا ورکر می‌گیرد، همان
    // لحظه در D1 می‌نویسد، و رساندنش به CRM کار صندوق خروجی است.
    if (url.pathname === "/intake/mentoring") {
      return handleMentoringIntake(request, env);
    }

    // مینی‌اپ تقویم. تا پیش از این مستقیم به n8n می‌زد و با هر قطعی آن
    // هاست، همه‌ی تب‌های تقویم خالی می‌شدند در حالی که خود ربات - که از
    // آینه‌ی D1 می‌خواند - سالم بود. حالا هر دو از یک منبع می‌خوانند.
    if (url.pathname === "/econ/miniapp") {
      return handleMiniapp(request, env);
    }

    // مسیر webhook شامل خود توکن است تا کسی نتواند بدون دانستن توکن
    // درخواست جعلی به این آدرس بفرستد.
    if (url.pathname === `/webhook/${env.BOT_TOKEN}`) {
      // تلگرام آپدیت‌ها را برای هر بات پشت‌سرهم می‌فرستد و اگر پاسخ ۲۰۰
      // نگیرد، همان آپدیت را دوباره و دوباره می‌فرستد. یعنی یک آپدیتِ
      // مسموم که همیشه خطا می‌دهد، صف را کامل می‌بندد و هیچ پیام دیگری
      // از هیچ کاربری پردازش نمی‌شود - رباتی که کاملاً مرده به نظر
      // می‌رسد، به‌خاطر یک پیام.
      //
      // پس هر خطای پیش‌بینی‌نشده اینجا گرفته می‌شود و باز ۲۰۰ برمی‌گردد:
      // آن یک آپدیت از دست می‌رود، ولی بقیه راه می‌افتند. خطا در لاگ
      // می‌ماند تا علتش پیدا شود.
      //
      // مهم: این حفاظ کلِ شاخه را می‌گیرد، نه فقط پردازش آپدیت را.
      // نسخه‌ی قبلی فقط دور webhookCallback بود و bot.init() بیرونش
      // می‌ماند - یک getMe که به تلگرام نمی‌رسید، ورکر را ۵۰۰ می‌کرد و
      // همان صف را می‌بست که این حفاظ قرار بود باز نگه دارد.
      try {
        const bot = createBot(env.BOT_TOKEN, env, cachedBotInfo, BUILD);
        if (!cachedBotInfo) {
          await bot.init();
          cachedBotInfo = bot.botInfo;
        }
        // شکستش نباید جلوی پردازش پیام را بگیرد: یک فهرست دستور،
        // به‌اندازه‌ی پاسخ ندادن به کاربر مهم نیست.
        if (!commandsRegistered) {
          commandsRegistered = true;
          await bot.api
            .setMyCommands(PUBLIC_COMMANDS)
            .catch((err) => console.error("ثبت فهرست دستورها شکست خورد:", err && err.message));
          await ensureChannelPostsAllowed(bot).catch((err) =>
            console.error("بررسی allowed_updates شکست خورد:", err && err.message)
          );
        }
        return await webhookCallback(bot, "cloudflare-mod")(request);
      } catch (err) {
        console.error("پردازش آپدیت شکست خورد:", err && (err.stack || err.message));
        return new Response("ok", { status: 200 });
      }
    }

    return new Response("not found", { status: 404 });
  },

  // زمان‌بند آینه‌ی تقویم. اگر n8n قطع باشد این اجرا شکست می‌خورد و
  // آینه‌ی قبلی دست‌نخورده می‌ماند، پس تقویم همچنان جواب می‌دهد - فقط با
  // داده‌ی اجرای موفق قبلی. خطا را بالا نمی‌دهیم تا یک قطعی موقت n8n به
  // خطای مکرر در لاگ ورکر تبدیل نشود؛ ثبتش برای تشخیص کافی است.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      syncFromN8n(env)
        .then((n) => console.log("همگام‌سازی تقویم:", JSON.stringify(n)))
        .catch((err) => console.error("همگام‌سازی تقویم شکست خورد:", err && err.message))
    );

    // تلاش دوباره برای لیدهایی که موقع ثبت نتوانستند به CRM برسند. این
    // چیزی است که قطعی n8n را از «مشتری از دست رفت» به «مشتری چند دقیقه
    // دیرتر در CRM ظاهر شد» تبدیل می‌کند.
    ctx.waitUntil(
      drainLeadOutbox(env)
        .then((n) => {
          if (n && !n.skipped && (n.sent || n.failed)) {
            console.log("ارسال لیدهای معلق:", JSON.stringify(n));
          }
        })
        .catch((err) => console.error("ارسال لیدهای معلق شکست خورد:", err && err.message))
    );

    // آینه‌ی CRM. اگر n8n خواب باشد این هم شکست می‌خورد - که اشکالی
    // ندارد: آینه‌ی قبلی سر جایش می‌ماند و همان است که صفحه را زنده
    // نگه می‌دارد.
    ctx.waitUntil(
      syncCrmMirror(env)
        .then((n) => {
          if (n && !n.skipped) console.log("آینه‌ی CRM:", JSON.stringify(n.written));
        })
        .catch((err) => console.error("آینه‌ی CRM همگام نشد:", err && err.message))
    );
  },
};
