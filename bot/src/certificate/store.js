// صفِ ساختِ گواهی.
//
// هر پیامی که مدیر می‌فرستد یک «دسته» (batch) است: یک نام یا چند ده نام،
// با جنسیتی که خودش نوشته. هر نام یک ردیف است و ردیف‌ها به ترتیبِ لیست
// ساخته و فرستاده می‌شوند.
//
// چرخه‌ی عمرِ هر ردیف:
//
//   queued     در صف؛ منتظرِ ورک‌فلوی رندر
//   rendering  ورک‌فلو برش داشته
//   done       فرستاده شد
//   failed     به هر دلیل نشد
//   cancelled  مدیر پیش از رندرش «لغوِ باقی‌مانده» را زد
//
// هر گذار یک UPDATE شرطی است (`WHERE status = ...`) و موفقیتش از
// `changes` خوانده می‌شود. به همین دلیل دو ورک‌فلوی هم‌زمان هرگز یک ردیف
// را دو بار برنمی‌دارند، و ورک‌فلوی دیررسیده نمی‌تواند ردیفِ شکست‌خورده را
// «انجام‌شده» کند.
//
// ترتیب: ورک‌فلو با `ORDER BY rowid` برمی‌دارد، یعنی دقیقاً به ترتیبِ درج.
// created_at برای این کافی نبود: همه‌ی ردیف‌های یک دسته در یک میلی‌ثانیه
// ساخته می‌شوند و ترتیبشان نامعلوم می‌شد.
//
// نام دانشجو داده‌ی شخصی است: فقط اینجا و فقط تا سی روز می‌ماند، و در
// هیچ لاگی چاپ نمی‌شود. ریپو عمومی است و ورودیِ ورک‌فلو در تاریخچه
// می‌ماند، پس نام از راهِ ورودی هم نمی‌رود - ورک‌فلو آن را از ورکر می‌گیرد.

// اگر ورک‌فلو در این مدت شروع نکرد یا یک ردیف را تمام نکرد، شکست‌خورده
// حساب می‌شود تا مدیر برای همیشه منتظر نماند.
export const STALE_MS = 6 * 60 * 1000;
export const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
// سقفِ ردیف‌های هم‌زمان در جریان: دو دسته‌ی کامل. مانعِ اشتباه است، نه
// محدودیتِ واقعی.
export const MAX_ACTIVE = 60;

const DDL = [
  `CREATE TABLE IF NOT EXISTS cert_jobs (
     id TEXT PRIMARY KEY,
     owner_id TEXT NOT NULL,
     name TEXT NOT NULL,
     gender TEXT,
     status TEXT NOT NULL,
     chat_id TEXT,
     message_id INTEGER,
     error TEXT,
     batch_id TEXT,
     batch_pos INTEGER,
     batch_total INTEGER,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_cert_jobs_status ON cert_jobs(status, updated_at)`,
];

// جدول در نسخه‌ی قبلی بدونِ این ستون‌ها ساخته شده بود. SQLite «اضافه کن اگر
// نیست» ندارد، پس خطای «ستونِ تکراری» بلعیده می‌شود - تنها خطایی که اینجا
// انتظارش را داریم. ستون‌ها باید پیش از ایندکسِ دسته بیایند.
const MIGRATE = [
  `ALTER TABLE cert_jobs ADD COLUMN batch_id TEXT`,
  `ALTER TABLE cert_jobs ADD COLUMN batch_pos INTEGER`,
  `ALTER TABLE cert_jobs ADD COLUMN batch_total INTEGER`,
];
const INDEXES = [`CREATE INDEX IF NOT EXISTS idx_cert_jobs_batch ON cert_jobs(batch_id)`];

let ready = false;
export async function ensureCertSchema(env) {
  if (ready) return;
  for (const sql of DDL) await env.DB.prepare(sql).run();
  for (const sql of MIGRATE) {
    try {
      await env.DB.prepare(sql).run();
    } catch (err) {
      if (!/duplicate column/i.test(String(err && err.message))) throw err;
    }
  }
  for (const sql of INDEXES) await env.DB.prepare(sql).run();
  ready = true;
}
// برای تست: هر تست دیتابیسِ تازه می‌خواهد.
export function resetCertSchemaMemo() {
  ready = false;
}

const iso = (ms) => new Date(ms).toISOString();
const changed = (res) => (res && res.meta ? res.meta.changes || 0 : 0) > 0;

/** شناسه‌ی کوتاه: داخلِ callback_data می‌نشیند که سقفش ۶۴ بایت است. */
export function newId() {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function countActive(env) {
  await ensureCertSchema(env);
  const row = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM cert_jobs WHERE status IN ('queued','rendering')`)
    .first();
  return (row && row.n) || 0;
}

export async function getJob(env, id) {
  await ensureCertSchema(env);
  return await env.DB.prepare(`SELECT * FROM cert_jobs WHERE id = ?`).bind(String(id)).first();
}

/**
 * یک دسته را یک‌جا و اتمیک به صف می‌برد: یا همه‌ی ردیف‌ها می‌نشینند یا هیچ‌کدام.
 *
 * @param {{ownerId: string|number, chatId: string|number, messageId: number|null,
 *          items: Array<{name: string, gender: "m"|"f"}>, now?: number}} p
 * @returns {Promise<{batchId: string, ids: string[]}>}
 */
export async function enqueueBatch(env, { ownerId, chatId, messageId, items, now = Date.now() }) {
  await ensureCertSchema(env);
  const batchId = newId();
  const t = iso(now);
  const ids = items.map(() => newId());
  const stmts = items.map((it, i) =>
    env.DB
      .prepare(
        `INSERT INTO cert_jobs
           (id, owner_id, name, gender, status, chat_id, message_id,
            batch_id, batch_pos, batch_total, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        ids[i],
        String(ownerId),
        it.name,
        it.gender,
        String(chatId),
        messageId == null ? null : Number(messageId),
        batchId,
        i + 1,
        items.length,
        t,
        t
      )
  );
  await env.DB.batch(stmts);
  return { batchId, ids };
}

/**
 * ورک‌فلو یک ردیفِ منتظر برمی‌دارد - قدیمی‌ترین به ترتیبِ درج. دو مرحله‌ای
 * عمداً: اول خواندن، بعد UPDATE شرطی. اگر دو ورک‌فلو هم‌زمان همان را ببینند،
 * فقط یکی `changes` می‌گیرد و دیگری ردیفِ بعدی را امتحان می‌کند.
 */
export async function claimNext(env, now = Date.now()) {
  await ensureCertSchema(env);
  for (let i = 0; i < 4; i++) {
    const next = await env.DB
      .prepare(`SELECT id FROM cert_jobs WHERE status = 'queued' ORDER BY rowid LIMIT 1`)
      .first();
    if (!next) return null;
    const res = await env.DB
      .prepare(
        `UPDATE cert_jobs SET status = 'rendering', updated_at = ?
          WHERE id = ? AND status = 'queued'`
      )
      .bind(iso(now), next.id)
      .run();
    if (changed(res)) return await getJob(env, next.id);
  }
  return null;
}

/**
 * پایانِ کارِ یک ردیف. «done» فقط از rendering ممکن است؛ شکست از هر دو.
 * برمی‌گرداند آیا واقعاً گذار انجام شد.
 */
export async function finishJob(env, id, status, error = null, now = Date.now()) {
  await ensureCertSchema(env);
  const from = status === "done" ? `('rendering')` : `('queued','rendering')`;
  const res = await env.DB
    .prepare(
      `UPDATE cert_jobs SET status = ?, error = ?, updated_at = ?
        WHERE id = ? AND status IN ` + from
    )
    .bind(status, error, iso(now), String(id))
    .run();
  return changed(res);
}

/**
 * «لغوِ باقی‌مانده»: ردیف‌هایی که هنوز رندرشان شروع نشده لغو می‌شوند. آنچه
 * همین حالا در حال رندر است تمام می‌شود - نیمه‌کاره‌اش نمی‌کنیم.
 * فقط مالکِ دسته.
 */
export async function cancelBatch(env, batchId, ownerId, now = Date.now()) {
  await ensureCertSchema(env);
  const res = await env.DB
    .prepare(
      `UPDATE cert_jobs SET status = 'cancelled', updated_at = ?
        WHERE batch_id = ? AND owner_id = ? AND status = 'queued'`
    )
    .bind(iso(now), String(batchId), String(ownerId))
    .run();
  return res && res.meta ? res.meta.changes || 0 : 0;
}

/**
 * وضعیتِ یک دسته، برای پیامِ پیشرفت.
 * @returns {Promise<{total: number, counts: Record<string, number>, failed: Array<{name: string, error: string}>,
 *                    chat_id: string|null, message_id: number|null, owner_id: string|null} | null>}
 */
export async function batchStats(env, batchId) {
  await ensureCertSchema(env);
  const { results } = await env.DB
    .prepare(
      `SELECT id, name, status, error, chat_id, message_id, owner_id, batch_pos
         FROM cert_jobs WHERE batch_id = ? ORDER BY rowid`
    )
    .bind(String(batchId))
    .all();
  const rows = results || [];
  if (rows.length === 0) return null;
  const counts = { queued: 0, rendering: 0, done: 0, failed: 0, cancelled: 0 };
  const failed = [];
  for (const r of rows) {
    counts[r.status] = (counts[r.status] || 0) + 1;
    if (r.status === "failed") failed.push({ name: r.name, error: r.error || "other", pos: r.batch_pos });
  }
  return {
    total: rows.length,
    counts,
    failed,
    chat_id: rows[0].chat_id,
    message_id: rows[0].message_id,
    owner_id: rows[0].owner_id,
  };
}

/**
 * ردیف‌های گیرکرده را شکست‌خورده اعلام می‌کند، و داده‌ی کهنه را پاک.
 * @returns {Promise<{stale: object[], purged: number}>}
 */
export async function sweep(env, now = Date.now()) {
  await ensureCertSchema(env);
  const cutoff = iso(now - STALE_MS);
  const { results } = await env.DB
    .prepare(
      `SELECT * FROM cert_jobs
        WHERE status IN ('queued','rendering') AND updated_at < ? LIMIT 100`
    )
    .bind(cutoff)
    .all();
  const stale = [];
  for (const row of results || []) {
    const code = row.status === "queued" ? "no_runner" : "timeout";
    if (await finishJob(env, row.id, "failed", code, now)) stale.push({ ...row, error: code });
  }
  const purge = await env.DB
    .prepare(`DELETE FROM cert_jobs WHERE status IN ('done','failed','cancelled') AND updated_at < ?`)
    .bind(iso(now - KEEP_MS))
    .run();
  return { stale, purged: purge && purge.meta ? purge.meta.changes || 0 : 0 };
}

/**
 * هر چه در حالتِ «در حال رندر» مانده را شکست‌خورده اعلام می‌کند.
 *
 * فقط پس از پایانِ اجرای ورک‌فلو صدا زده می‌شود. چون ورک‌فلو یک
 * concurrency group دارد، هیچ اجرای دیگری هم‌زمان با آن نیست؛ پس هر چه
 * هنوز rendering است مالِ همین اجرای مرده است.
 */
export async function failAllRendering(env, now = Date.now()) {
  await ensureCertSchema(env);
  const { results } = await env.DB
    .prepare(`SELECT * FROM cert_jobs WHERE status = 'rendering' LIMIT 100`)
    .all();
  const out = [];
  for (const row of results || []) {
    if (await finishJob(env, row.id, "failed", "render", now)) out.push({ ...row, error: "render" });
  }
  return out;
}

/** همه‌ی ردیف‌های منتظرِ یک دسته را شکست‌خورده می‌کند (مثلاً ورک‌فلو راه نیفتاد). */
export async function failBatch(env, batchId, code, now = Date.now()) {
  await ensureCertSchema(env);
  const res = await env.DB
    .prepare(
      `UPDATE cert_jobs SET status = 'failed', error = ?, updated_at = ?
        WHERE batch_id = ? AND status IN ('queued','rendering')`
    )
    .bind(code, iso(now), String(batchId))
    .run();
  return res && res.meta ? res.meta.changes || 0 : 0;
}
