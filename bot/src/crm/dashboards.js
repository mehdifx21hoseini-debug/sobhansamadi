// چهار محاسبه‌ی داشبورد.
//
// هر کدام دو تکه است: یک تابع خالص که فقط داده می‌گیرد و عدد می‌دهد، و
// یک تابع که از D1 می‌خواند و آن را صدا می‌زند. دلیلش تست است - با
// «الان»ِ ثابت و ردیف‌های ساختگی می‌شود دقیقاً سنجید که چه چیزی شمرده
// می‌شود، بدون اینکه نتیجه به ساعتِ اجرا یا محتوای دیتابیس بند باشد.
//
// فرمول‌ها مو‌به‌مو از نودهای Compute در WF-15 برداشته شده‌اند. جایی که
// عددی به نظرم عجیب می‌آمد هم دست نزدم: در دوره‌ی موازی باید دو سمت یک
// عدد بدهند، وگرنه معلوم نمی‌شود تفاوت از باگ است یا از «بهبود».

const PAID = "paid";

function num(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/** درصد با یک رقم اعشار. */
function pctOf(n, total) {
  return total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
}

function dayBounds(nowMs) {
  const start = new Date(nowMs); start.setHours(0, 0, 0, 0);
  const end = new Date(nowMs); end.setHours(23, 59, 59, 999);
  return [start.getTime(), end.getTime()];
}

// ─── KPI فروش ────────────────────────────────────────────────────────

export function computeSalesKpi(leads, calls, orders, nowMs = Date.now()) {
  const [dayStart, dayEnd] = dayBounds(nowMs);
  const isToday = (iso) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= dayStart && t <= dayEnd;
  };

  const paidOrders = orders.filter((o) => o.payment_status === PAID);
  const paidToday = paidOrders.filter((o) => isToday(o.payment_date));
  const totalLeads = leads.length;
  const totalPurchases = paidOrders.length;

  return {
    leads_today: leads.filter((l) => isToday(l.created_at)).length,
    calls_today: calls.filter((c) => isToday(c.created_at)).length,
    overdue_followups: leads.filter(
      (l) => l.next_followup_at && new Date(l.next_followup_at).getTime() < nowMs
    ).length,
    purchases_today: paidToday.length,
    revenue_today: paidToday.reduce((s, o) => s + num(o.amount), 0),
    conversion_rate: pctOf(totalPurchases, totalLeads),
    total_leads: totalLeads,
    total_purchases: totalPurchases,
  };
}

// ─── عملکرد مشاوران ──────────────────────────────────────────────────

export function computeConsultantPerformance(consultants, leads, calls, orders) {
  const paid = orders.filter((o) => o.payment_status === PAID);
  const leadById = new Map(leads.map((l) => [l.lead_id, l]));

  const rows = consultants.map((c) => {
    const myOrders = paid.filter((o) => {
      const lead = leadById.get(o.lead_id);
      return lead && lead.assigned_to === c.username;
    });
    return {
      username: c.username,
      display_name: c.display_name || c.username,
      leads_assigned: leads.filter((l) => l.assigned_to === c.username).length,
      calls_made: calls.filter((cl) => cl.admin_username === c.username).length,
      purchases: myOrders.length,
      revenue: myOrders.reduce((s, o) => s + num(o.amount), 0),
    };
  });

  rows.sort((a, b) => b.revenue - a.revenue);
  return rows;
}

// ─── قیف فروش ────────────────────────────────────────────────────────

export function computeFunnel(leads, calls, orders) {
  const paid = orders.filter((o) => o.payment_status === PAID);

  // «تماس گرفته شده» از دو جا می‌آید: یا رکورد تماسی ثبت شده، یا شمارنده‌ی
  // contact_attempts بالا رفته. لیدهای قدیمی فقط دومی را دارند؛ بدون آن،
  // قیف کل تاریخچه‌ی پیش از جدولِ تماس‌ها را «تماس‌نگرفته» می‌شمرد.
  const contactedIds = new Set();
  for (const c of calls) if (c.lead_id) contactedIds.add(c.lead_id);
  for (const l of leads) if (num(l.contact_attempts) > 0) contactedIds.add(l.lead_id);

  const purchasedIds = new Set(paid.map((o) => o.lead_id));

  const totalLeads = leads.length;
  const contacted = leads.filter((l) => contactedIds.has(l.lead_id)).length;
  const interested = leads.filter(
    (l) => l.last_call_result === "علاقه‌مند" || l.quality === "hot"
  ).length;
  const purchased = leads.filter((l) => purchasedIds.has(l.lead_id)).length;

  return {
    new_leads: totalLeads,
    contacted,
    contacted_pct: pctOf(contacted, totalLeads),
    interested,
    interested_pct: pctOf(interested, totalLeads),
    purchased,
    purchased_pct: pctOf(purchased, totalLeads),
  };
}

// ─── عملکرد منابع جذب ────────────────────────────────────────────────

// ردیف‌هایی که پیش از ذخیره شدنِ منبع نوشته شده‌اند مقداری ندارند، ولی
// همه‌شان از ربات آمده‌اند - پس به آن نسبت داده می‌شوند، نه به «نامشخص».
const DEFAULT_SOURCE = "telegram_direct";

export function computeSourcePerformance(leads, orders) {
  const paid = orders.filter((o) => o.payment_status === PAID);
  const leadById = new Map(leads.map((l) => [l.lead_id, l]));
  const bySource = new Map();

  const bucket = (src) => {
    if (!bySource.has(src)) bySource.set(src, { source: src, leads: 0, purchases: 0, revenue: 0 });
    return bySource.get(src);
  };

  for (const l of leads) bucket(l.source || DEFAULT_SOURCE).leads += 1;
  for (const o of paid) {
    const lead = leadById.get(o.lead_id);
    const b = bucket((lead && lead.source) || DEFAULT_SOURCE);
    b.purchases += 1;
    b.revenue += num(o.amount);
  }

  return [...bySource.values()].sort((a, b) => b.leads - a.leads);
}

// ─── خواندن از D1 ────────────────────────────────────────────────────

async function all(env, sql) {
  const { results } = await env.DB.prepare(sql).all();
  return results || [];
}

// فقط ستون‌هایی که محاسبه لازم دارد. جدول لیدها بیست ستون دارد و
// notes می‌تواند کیلوبایت‌ها باشد؛ کشیدنِ همه‌اش برای شمردنِ چهار عدد،
// هزینه‌ای است که هر بار باز شدنِ داشبورد می‌پردازد.
const LEAD_COLS = "lead_id, created_at, next_followup_at, assigned_to, source, quality, last_call_result, contact_attempts";
const ORDER_COLS = "order_id, lead_id, amount, payment_status, payment_date";

export async function salesKpi(env) {
  const [leads, calls, orders] = await Promise.all([
    all(env, `SELECT ${LEAD_COLS} FROM crm_leads`),
    all(env, "SELECT call_id, created_at, admin_username FROM crm_calls"),
    all(env, `SELECT ${ORDER_COLS} FROM crm_orders`),
  ]);
  return computeSalesKpi(leads, calls, orders);
}

export async function consultantPerformance(env) {
  const [consultants, leads, calls, orders] = await Promise.all([
    all(env, "SELECT username, display_name FROM crm_admin WHERE active = 1"),
    all(env, `SELECT ${LEAD_COLS} FROM crm_leads`),
    all(env, "SELECT call_id, admin_username FROM crm_calls"),
    all(env, `SELECT ${ORDER_COLS} FROM crm_orders`),
  ]);
  return computeConsultantPerformance(consultants, leads, calls, orders);
}

export async function funnel(env) {
  const [leads, calls, orders] = await Promise.all([
    all(env, `SELECT ${LEAD_COLS} FROM crm_leads`),
    all(env, "SELECT call_id, lead_id FROM crm_calls"),
    all(env, `SELECT ${ORDER_COLS} FROM crm_orders`),
  ]);
  return computeFunnel(leads, calls, orders);
}

export async function sourcePerformance(env) {
  const [leads, orders] = await Promise.all([
    all(env, `SELECT ${LEAD_COLS} FROM crm_leads`),
    all(env, `SELECT ${ORDER_COLS} FROM crm_orders`),
  ]);
  return computeSourcePerformance(leads, orders);
}
