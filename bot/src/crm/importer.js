// انتقال یک‌باره‌ی جدول‌های CRM از n8n به D1.
//
// یک جدول در هر فراخوانی. دلیلش دو چیز است: پاسخ‌های چند مگابایتی (جدول
// مدیرها آواتار base64 دارد) در یک درخواست جا نمی‌شوند، و اگر وسط کار
// چیزی بشکند باید معلوم باشد کدام جدول تمام شده و کدام نه.
//
// همه‌ی مسیرها idempotent هستند - اجرای دوباره چیزی را دو برابر نمی‌کند.
// این مهم‌ترین ویژگیِ یک انتقال است: تا لحظه‌ی سوییچ باید بشود هر بار
// دوباره کشیدش تا داده‌ی تازه بیاید.

import { ensureCrmSchema } from "./schema.js";

const DEFAULT_URL = "https://96825.7host.cloud/webhook/crm/migrate-export";

// n8n به هر ردیف id/createdAt/updatedAt خودش را می‌چسباند. اینها مالِ
// خودِ Data Table هستند، نه داده‌ی ما، و نباید وارد شوند.
const N8N_META = new Set(["id", "createdAt", "updatedAt"]);

/**
 * نقشه‌ی انتقال.
 *
 * key: نام جدول در n8n (همان چیزی که WF-24 می‌شناسد)
 * table: جدول مقصد در D1
 * pk: کلید طبیعی، برای upsert. اگر null باشد یعنی جدول کلید طبیعی ندارد
 *     (لاگ‌های append-only با id خودکار) و به‌جای upsert، کل جدول پاک و
 *     دوباره پر می‌شود - که برای یک آینه‌ی در حال انتقال درست است، چون
 *     تا لحظه‌ی سوییچ مالکِ داده هنوز n8n است.
 * cols: ستون‌های مقصد. هر چیزی که در این فهرست نباشد دور ریخته می‌شود،
 *     پس ستونِ تازه‌ای که فردا در n8n اضافه شود بی‌صدا وارد نمی‌شود -
 *     یک خطای «ستون ناشناخته» بهتر از یک ستونِ گم‌شده است.
 * from: نگاشت نامِ متفاوت (مقصد ← مبدأ). فقط جایی که لازم است.
 */
export const PLAN = [
  {
    key: "leads", table: "crm_leads", pk: "lead_id",
    cols: ["lead_id", "telegram_user_id", "telegram_username", "full_name", "phone",
      "course", "request_type", "notes", "status", "contact_attempts", "created_at",
      "updated_at", "score", "priority", "assigned_to", "reminder_date", "source",
      "quality", "last_call_result", "next_followup_at"],
  },
  {
    key: "crm_admin", table: "crm_admin", pk: "username",
    cols: ["username", "display_name", "role", "active", "password_hash",
      "password_salt", "telegram_chat_id", "reset_code", "reset_expires", "avatar",
      "created_at", "updated_at"],
    defaults: { active: 0, role: "admin" },
    // این جدول در n8n created_at/updated_at ندارد؛ فقط createdAt/updatedAt
    // خودِ Data Table را دارد. آن‌ها را عمداً برمی‌داریم چون تاریخِ ساختِ
    // حساب، داده‌ی واقعی است نه فراداده.
    from: { created_at: "createdAt", updated_at: "updatedAt" },
  },
  {
    key: "crm_activity_log", table: "crm_activity_log", pk: null,
    cols: ["lead_id", "action", "detail", "actor", "created_at"],
  },
  {
    key: "calls", table: "crm_calls", pk: "call_id",
    cols: ["call_id", "lead_id", "admin_username", "result", "note", "next_step", "created_at"],
  },
  {
    key: "products", table: "crm_products", pk: "product_id",
    cols: ["product_id", "name", "price", "active", "created_at"],
    defaults: { active: 1 },
  },
  {
    key: "orders", table: "crm_orders", pk: "order_id",
    cols: ["order_id", "lead_id", "product_id", "amount", "payment_status",
      "payment_date", "transaction_id", "source", "created_at"],
  },
  {
    key: "support_tickets", table: "crm_support_tickets", pk: "ticket_id",
    cols: ["ticket_id", "telegram_user_id", "telegram_username", "first_name",
      "last_name", "request_type", "message", "reason", "status", "priority",
      "assigned_to", "photo_file_ids", "created_at", "updated_at"],
  },
  {
    key: "support_ticket_messages", table: "crm_ticket_messages", pk: null,
    cols: ["ticket_id", "direction", "message", "admin_name", "created_at"],
  },
  {
    key: "broadcasts", table: "crm_broadcasts", pk: "batch_id",
    cols: ["batch_id", "message", "audience", "sent_count", "deleted", "created_at"],
    defaults: { deleted: 0, sent_count: 0 },
  },
  {
    key: "broadcast_recipients", table: "crm_broadcast_recipients", pk: null,
    cols: ["batch_id", "chat_id", "message_id"],
  },
  {
    key: "mentoring_requests", table: "crm_mentoring_requests", pk: "request_id",
    cols: ["request_id", "lead_id", "created_at", "full_name", "phone",
      "telegram_id", "email", "consultation_goal", "answers_json", "raw_payload"],
  },
  {
    key: "error_log", table: "crm_error_log", pk: "log_id",
    cols: ["log_id", "workflow_name", "node_name", "error_message", "input_snapshot",
      "telegram_user_id", "retry_count", "resolved", "notes", "severity", "created_at"],
    defaults: { resolved: 0 },
    // error_log در n8n ستون created_at ندارد - زمانِ ردیف همان createdAt است.
    from: { created_at: "createdAt" },
  },
  {
    key: "admin_users", table: "crm_admin_users", pk: "telegram_id",
    cols: ["telegram_id", "name", "role", "active"],
    defaults: { active: 1 },
  },
  {
    key: "admin_action_log", table: "crm_admin_action_log", pk: null,
    cols: ["admin_telegram_id", "admin_username", "action_type", "lead_id", "details", "created_at"],
    from: { created_at: "createdAt" },
  },
  {
    key: "rr_assignment_state", table: "crm_rr_state", pk: "state_key",
    cols: ["state_key", "last_assigned_username"],
  },
  {
    key: "admin_reply_map", table: "crm_admin_reply_map", pk: "admin_message_id",
    cols: ["admin_message_id", "customer_telegram_user_id", "lead_id", "created_at"],
  },
];

/**
 * یک مقدار n8n را به چیزی که D1 می‌پذیرد تبدیل می‌کند.
 *
 * D1 فقط null، عدد، رشته و بلاب می‌گیرد. بولین‌های n8n باید ۰/۱ شوند و
 * آبجکت‌ها - که در ستون‌های JSON پیش می‌آید - رشته.
 */
export function coerce(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string") return v;
  return JSON.stringify(v);
}

/** یک ردیف خام n8n را به آرایه‌ی مقادیر مقصد تبدیل می‌کند. */
export function mapRow(spec, raw) {
  const from = spec.from || {};
  const defaults = spec.defaults || {};
  return spec.cols.map((col) => {
    const src = from[col] || col;
    // فقط وقتی به فراداده‌ی n8n می‌رسیم که خودمان صریح خواسته باشیم.
    if (N8N_META.has(src) && !from[col]) return null;
    const v = coerce(raw[src]);
    // DEFAULT در SQLite فقط وقتی کار می‌کند که ستون در INSERT نیامده
    // باشد؛ NULLِ صریح، NOT NULL را می‌شکند. n8n برای ستون‌های بولینی
    // که هیچ‌وقت ست نشده‌اند null می‌دهد، پس مقدار پیش‌فرض اینجا - سمت
    // داده - گذاشته می‌شود، نه با دست‌کاری طرح جدول.
    if (v === null && col in defaults) return defaults[col];
    return v;
  });
}

function upsertSql(spec) {
  const cols = spec.cols.join(", ");
  const marks = spec.cols.map(() => "?").join(", ");
  if (!spec.pk) return `INSERT INTO ${spec.table} (${cols}) VALUES (${marks})`;
  const set = spec.cols
    .filter((c) => c !== spec.pk)
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");
  return `INSERT INTO ${spec.table} (${cols}) VALUES (${marks})
          ON CONFLICT(${spec.pk}) DO UPDATE SET ${set}`;
}

// D1 سقفِ حجمِ درخواست دارد و یک batch از هزار ردیفِ چاق از آن رد می‌شود -
// همان تله‌ای که سرِ آینه‌ی CRM خوردیم. بیست‌وپنج، عددِ محافظه‌کارانه‌ای
// است که حتی با ردیف‌های آواتاردار هم جا می‌شود.
const CHUNK = 25;

async function fetchTable(env, key) {
  const res = await fetch(env.CRM_MIGRATE_URL || DEFAULT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({ key: env.ECON_EXPORT_KEY, table: key }),
  });
  if (!res.ok) throw new Error("پاسخ ناموفق از n8n برای «" + key + "»: " + res.status);
  const data = await res.json();
  if (!data || data.success !== true || !Array.isArray(data.rows)) {
    throw new Error("پاسخ نامعتبر برای «" + key + "»: " + (data && data.error ? data.error : "نامشخص"));
  }
  return data.rows;
}

/**
 * یک جدول را می‌کشد و در D1 می‌نشاند.
 * @returns {Promise<{table:string, fetched:number, written:number, skipped:number}>}
 */
export async function importTable(env, key) {
  const spec = PLAN.find((p) => p.key === key);
  if (!spec) throw new Error("جدول ناشناخته: " + key);

  await ensureCrmSchema(env);
  const rows = await fetchTable(env, key);

  // جدول‌های بی‌کلید کامل جای‌گزین می‌شوند، وگرنه اجرای دوم همه‌چیز را
  // دو برابر می‌کند. تا لحظه‌ی سوییچ مالکِ داده n8n است، پس جای‌گزینی
  // چیزی را از بین نمی‌برد.
  if (!spec.pk) await env.DB.prepare(`DELETE FROM ${spec.table}`).run();

  const sql = upsertSql(spec);
  let written = 0;
  let skipped = 0;
  let batch = [];

  for (const raw of rows) {
    // ردیفی که کلید طبیعی‌اش خالی است، ردیفِ داده نیست.
    if (spec.pk && !raw[spec.pk]) { skipped++; continue; }
    batch.push(env.DB.prepare(sql).bind(...mapRow(spec, raw)));
    if (batch.length >= CHUNK) {
      await env.DB.batch(batch);
      written += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    await env.DB.batch(batch);
    written += batch.length;
  }

  return { table: spec.table, fetched: rows.length, written, skipped };
}

/** همه‌ی جدول‌ها، به ترتیبِ نقشه. */
export async function importAll(env) {
  const out = [];
  for (const spec of PLAN) {
    try {
      out.push(await importTable(env, spec.key));
    } catch (err) {
      // یک جدولِ شکسته نباید بقیه را متوقف کند: گزارش می‌شود و کار ادامه
      // پیدا می‌کند، تا با یک اجرا بفهمیم کدام‌ها مشکل دارند نه یکی‌یکی.
      out.push({ table: spec.table, error: String(err && err.message) });
    }
  }
  return out;
}
