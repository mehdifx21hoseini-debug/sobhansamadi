// مسیرهای «هوش مصنوعی» برای صفحه‌ی CRM.
//
// چرا روی ورکر و نه روی n8n مثل بقیه‌ی صفحه‌های CRM: داده‌اش اینجاست.
// پایگاه دانش، بردارها و دفترچه‌ی پاسخ‌ها همه در D1 نشسته‌اند و بردن
// آن‌ها به n8n یعنی همان وابستگی‌ای که قرار بود کم شود - و صفحه‌ای که
// دقیقاً وقتی لازم است (وقتی دستیار درست جواب نمی‌دهد) از کار بیفتد.
//
// احراز هویت با همان توکنی است که مدیر موقع ورود به CRM گرفته: صفحه
// آن را در هدر Authorization می‌فرستد و ورکر از n8n می‌پرسد معتبر است
// یا نه (bot/src/admin/crmAuth.js). پس رمز دومی در کار نیست.
//
// کلیدی هم در این فایل‌ها نوشته نمی‌شود و نباید بشود: میزبانی CRM
// ایستاست، یعنی هر چه در js/ بنویسیم با View Source خوانده می‌شود.

import { aiStats, listLog } from "../ai/log.js";
import {
  listSourceForAdmin,
  addSourceEntry,
  updateSourceEntry,
  unpinSourceEntry,
  bulkReplaceSource,
  removeSourceEntry,
  syncAndRebuild,
} from "../ai/source.js";
import { suggestEntry } from "../ai/curator.js";

// صفحه‌ی CRM روی دامنه‌ی دیگری میزبانی می‌شود، پس بدون CORS مرورگر
// پاسخ را دور می‌ریزد. مرزِ امنیت اینجا CORS نیست، کلید است: مرورگرِ یک
// سایت دیگر می‌تواند درخواست بفرستد ولی کلید ندارد و ۴۰۱ می‌گیرد.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-key, Authorization",
  "Access-Control-Max-Age": "86400",
};

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS });
}

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

async function body(request) {
  try {
    return (await request.json()) || {};
  } catch {
    return {};
  }
}

/**
 * مسیریابی زیر /admin/ai/. احراز هویت پیش از این انجام شده.
 *
 * @param {Request} request
 * @param {URL} url
 * @param {object} env
 * @returns {Promise<Response|null>} null یعنی این مسیر اینجا نیست.
 */
export async function handleAiApi(request, url, env) {
  const path = url.pathname.replace(/^\/admin\/ai\/?/, "");
  const q = url.searchParams;

  try {
    // همه‌ی چیزی که سرِ صفحه لازم است، در یک درخواست: کارت‌های آمار،
    // دلیل ارجاع‌ها، و دو فهرست کوتاه. سه درخواست جداگانه فقط صفحه را
    // پله‌پله و ناهماهنگ نشان می‌داد.
    if (path === "overview") {
      const [stats, kb] = await Promise.all([
        aiStats(env),
        listSourceForAdmin(env, { limit: 1 }),
      ]);
      return reply({
        ok: true,
        stats,
        kb: { total: kb.total, categories: kb.categories },
      });
    }

    if (path === "log") {
      const data = await listLog(env, {
        filter: q.get("filter") || "all",
        q: q.get("q") || "",
        limit: q.get("limit"),
        offset: q.get("offset"),
      });
      return reply({ ok: true, ...data });
    }

    if (path === "kb" && request.method === "GET") {
      const data = await listSourceForAdmin(env, {
        q: q.get("q") || "",
        category: q.get("category") || "",
        origin: q.get("origin") || "",
        limit: q.get("limit"),
        offset: q.get("offset"),
      });
      return reply({ ok: true, ...data });
    }

    if (path === "kb" && request.method === "POST") {
      const b = await body(request);
      const question = String(b.question || "").trim();
      const answer = String(b.answer || "").trim();
      if (!question || !answer) {
        return reply({ ok: false, error: "سوال و پاسخ هر دو لازم‌اند" }, 400);
      }
      const id = await addSourceEntry(env, question, answer, b.category);
      return reply({ ok: true, id });
    }

    if (path === "kb/update") {
      const b = await body(request);
      const question = String(b.question || "").trim();
      const answer = String(b.answer || "").trim();
      if (!question || !answer) {
        return reply({ ok: false, error: "سوال و پاسخ هر دو لازم‌اند" }, 400);
      }
      const res = await updateSourceEntry(env, b.id, {
        category: b.category,
        question,
        answer,
      });
      if (res.reason === "not_found") {
        return reply({ ok: false, error: "مدخلی با این شماره پیدا نشد" }, 404);
      }
      return reply({ ok: true, changed: res.changed });
    }

    if (path === "kb/unpin") {
      const b = await body(request);
      const changed = await unpinSourceEntry(env, b.id);
      return reply({ ok: true, changed });
    }

    if (path === "kb/delete") {
      const b = await body(request);
      const removed = await removeSourceEntry(env, b.id);
      return reply({ ok: true, removed });
    }

    if (path === "kb/bulk") {
      const b = await body(request);
      if (!Array.isArray(b.entries) || b.entries.length === 0) {
        return reply({ ok: false, error: "فهرست مدخل‌ها خالی است" }, 400);
      }
      const res = await bulkReplaceSource(env, b.entries);
      return reply({ ok: true, ...res });
    }

    if (path === "suggest") {
      const b = await body(request);
      const text = String(b.text || "").trim();
      if (text.length < 20) {
        return reply({ ok: false, error: "متن خیلی کوتاه است" }, 400);
      }
      // دسته‌های موجود همراه متن می‌روند تا مدل در همان‌ها بماند.
      const { categories } = await listSourceForAdmin(env, { limit: 1 });
      const suggestion = await suggestEntry(
        env,
        text,
        categories.map((c) => c.category).filter(Boolean)
      );
      return reply({ ok: true, suggestion });
    }

    if (path === "sync") {
      const result = await syncAndRebuild(env);
      return reply({ ok: true, ...result });
    }

    return reply({ ok: false, error: "مسیر ناشناخته: " + path }, 404);
  } catch (err) {
    console.error("خطای مسیر هوش مصنوعی:", url.pathname, err && (err.stack || err.message));
    return reply({ ok: false, error: String(err && err.message) }, 500);
  }
}
