// مسیرهای خواندنیِ آینه، برای وقتی که n8n جواب نمی‌دهد.
//
// شکل پاسخ‌ها عمداً دقیقاً همان چیزی است که n8n می‌دهد - یک آرایه‌ی خام -
// تا صفحه‌ی CRM بتواند بدون هیچ تغییری در منطقش از این‌ها استفاده کند.
// هر تفاوتی در شکل، یعنی دو مسیر که باید هم‌گام بمانند.
//
// احراز هویت همان توکن ورود CRM است، مثل بخش هوش مصنوعی: کسی که به
// پنل دسترسی دارد، به آینه‌اش هم دارد - نه بیشتر.

import { readMirror, mirrorStatus } from "./mirror.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  // بدون این، مرورگر هدر زمان همگام‌سازی را از دید جاوااسکریپت پنهان
  // می‌کند - نه خطایی، نه هشداری، فقط یک مقدار خالی. یعنی صفحه هرگز
  // نمی‌فهمید داده‌ای که نشان می‌دهد کهنه است.
  "Access-Control-Expose-Headers": "X-Mirror-Synced-At",
  "Access-Control-Max-Age": "86400",
};

function reply(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      ...extra,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

// نگاشت مسیرهای صفحه به جدول‌های آینه.
//
// نام مسیرها همان نام مسیرهای n8n است تا در صفحه فقط آدرس پایه عوض شود،
// نه منطق. جایی که n8n یک زیرمجموعه می‌دهد (مشاورها)، فیلترش اینجا هم
// همان است.
const ROUTES = {
  leads: { table: "leads" },
  calls: { table: "calls" },
  orders: { table: "orders" },
  products: { table: "products" },
  admins: { table: "admins" },
  "mentoring-requests": { table: "mentoring_requests" },
  "support-tickets": { table: "support_tickets" },
  consultants: { table: "admins", filter: (r) => r.role === "consultant" },
};

/**
 * مسیریابی زیر /crm-mirror/. احراز هویت پیش از این انجام شده.
 */
export async function handleMirrorApi(request, url, env) {
  const path = url.pathname.replace(/^\/crm-mirror\/?/, "");

  if (path === "status") {
    return reply({ ok: true, tables: await mirrorStatus(env) });
  }

  const route = ROUTES[path];
  if (!route) return reply({ ok: false, error: "مسیر ناشناخته: " + path }, 404);

  const data = await readMirror(env, route.table);
  if (!data) {
    // «هنوز همگام نشده» با «خالی است» یکی نیست. اگر اینجا یک آرایه‌ی خالی
    // برمی‌گرداندیم، صفحه با اطمینان می‌نوشت «موردی نیست» - دقیقاً همان
    // دروغی که سر صفحه‌ی منتورینگ سه هفته گفته شد.
    return reply({ ok: false, error: "آینه هنوز همگام نشده است" }, 503);
  }

  const rows = route.filter ? data.rows.filter(route.filter) : data.rows;
  // زمان همگام‌سازی در هدر می‌رود، نه در بدنه: بدنه باید عیناً همان
  // آرایه‌ای باشد که صفحه از n8n می‌گیرد، وگرنه باید دو شکل را جدا
  // مدیریت کند.
  return reply(rows, 200, { "X-Mirror-Synced-At": data.synced_at });
}

export function mirrorPreflight() {
  return new Response(null, { status: 204, headers: CORS });
}
