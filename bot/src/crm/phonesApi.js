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

function csvCell(value) {
  const s = String(value === null || value === undefined ? "" : value);
  // شماره‌ها با صفر شروع می‌شوند و اکسل صفرِ اول را می‌خورد اگر سلول را
  // عدد ببیند. نقل‌قول تنهایی جلویش را نمی‌گیرد، ولی چون همه‌ی سلول‌ها
  // نقل‌قول‌دار می‌روند دست‌کم جداکننده و خط تازه امن است؛ برای شماره
  // پایین‌تر یک ستون متنی صریح هم هست.
  return '"' + s.replace(/"/g, '""') + '"';
}

function toCsv(rows) {
  const head = ["شماره موبایل", "نام", "نام کاربری", "منبع", "شناسه تلگرام", "تاریخ ثبت"];
  const lines = [head.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.phone,
        r.name || "",
        r.username ? "@" + r.username : "",
        (r.sources || []).join(" / "),
        r.telegram_user_id,
        r.created_at,
      ]
        .map(csvCell)
        .join(",")
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
