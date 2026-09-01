// دفترچه‌ی شماره‌ها برای CRM: یک فهرست و یک خروجی CSV.
//
// این داده در D1 ورکر است نه در n8n، پس برخلاف بقیه‌ی صفحه‌های CRM
// آینه‌ای در کار نیست - همین‌جا منبع اصلی است.
//
// احراز هویت همان توکن ورود CRM است و پیش از رسیدن به اینجا بررسی
// می‌شود؛ فهرست شماره‌ی موبایل مشتری‌ها چیزی نیست که بدون آن باز شود.

import { listPhones, phoneStats } from "../phones.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

// اکسل فارسی بدون BOM، UTF-8 را به‌عنوان کد صفحه‌ی محلی می‌خواند و کل
// فایل را به هم می‌ریزد. این سه بایت تفاوت «فایل باز شد» و «فایل پر از
// علامت سوال است» را می‌سازد.
const BOM = "\uFEFF";

function csvCell(value, asText = false) {
  const s = String(value === null || value === undefined ? "" : value);
  // شماره با صفر شروع می‌شود و اکسل صفرِ اول را می‌خورد اگر سلول را عدد
  // ببیند - «09371234567» می‌شود «9371234567». نقل‌قول تنهایی جلویش را
  // نمی‌گیرد؛ فرمولِ ="..." می‌گیرد.
  if (asText && s) return '"=""' + s.replace(/"/g, '""') + '"""';
  return '"' + s.replace(/"/g, '""') + '"';
}

// همان ستون‌ها و همان ترتیبی که صفحه‌ی شماره‌ها بیرون می‌دهد، تا دو
// خروجیِ متفاوت از یک داده وجود نداشته باشد. شناسه اول می‌آید چون
// کلیدِ تطبیق با هر سامانه‌ی دیگری همان است.
function toCsv(rows) {
  const head = ["شناسه تلگرام", "شماره موبایل", "نام", "نام کاربری", "منبع", "تاریخ ثبت"];
  const lines = [head.map((h) => csvCell(h)).join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.telegram_user_id),
        csvCell(r.phone, true),
        csvCell(r.name || ""),
        csvCell(r.username ? "@" + r.username : ""),
        csvCell((r.sources || []).join(" / ")),
        csvCell(r.created_at),
      ].join(",")
    );
  }
  return BOM + lines.join("\r\n");
}

/**
 * مسیریابی زیر /crm/phones. احراز هویت پیش از این انجام شده.
 */
export async function handlePhonesApi(request, url, env) {
  const wantsCsv = url.pathname.endsWith(".csv") || url.searchParams.get("format") === "csv";

  let rows;
  try {
    rows = await listPhones(env, { limit: url.searchParams.get("limit") || 2000 });
  } catch (err) {
    console.error("خواندن دفترچه‌ی شماره‌ها شکست خورد:", err && err.message);
    return json({ ok: false, error: "خواندن شماره‌ها ممکن نشد" }, 500);
  }

  if (wantsCsv) {
    const today = new Date().toISOString().slice(0, 10);
    return new Response(toCsv(rows), {
      headers: {
        ...CORS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="phones-${today}.csv"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  }

  return json({ ok: true, stats: await phoneStats(env), rows });
}

export function phonesPreflight() {
  return new Response(null, { status: 204, headers: CORS });
}
