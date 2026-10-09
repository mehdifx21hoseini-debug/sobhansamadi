// صفِ ساختِ گواهی.
//
// چرخه‌ی عمر یک درخواست:
//
//   draft          مدیر دستور را زده، دکمه‌ی جنسیت را هنوز نزده
//   awaiting_name  جنسیت انتخاب شد؛ ربات منتظرِ نامی است که مدیر تایپ می‌کند
//                  (فقط وقتی دستور بی‌نام زده شده؛ با «/cert نام» این مرحله نیست)
//   queued         نام و جنسیت هر دو آمد؛ منتظرِ ورک‌فلوی رندر
//   rendering  ورک‌فلو برش داشته
//   done       فرستاده شد
//   failed     به هر دلیل نشد - مدیر خبردار می‌شود
//   cancelled  مدیر لغو کرد
//
// هر گذار یک UPDATE شرطی است (`WHERE status = ...`) و موفقیتش از
// `changes` خوانده می‌شود. به همین دلیل دو بار زدنِ یک دکمه، یا دو
// ورک‌فلوی هم‌زمان، هرگز یک درخواست را دو بار برنمی‌دارند - همان
// الگوی اتمیکی که پیام‌های روزانه دارند.
//
// نام دانشجو داده‌ی شخصی است: فقط اینجا و فقط تا سی روز می‌ماند، و در
// هیچ لاگی چاپ نمی‌شود. ریپو عمومی است و ورودیِ ورک‌فلو در تاریخچه
// می‌ماند، پس نام از راهِ ورودی هم نمی‌رود - ورک‌فلو آن را از ورکر می‌گیرد.

export const DRAFT_TTL_MS = 15 * 60 * 1000;
// اگر ورک‌فلو در این مدت شروع نکرد یا تمام نکرد، درخواست شکست‌خورده
// حساب می‌شود تا مدیر برای همیشه منتظر نماند.
export const STALE_MS = 6 * 60 * 1000;
export const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
// سقفِ درخواست‌های هم‌زمان. مانعِ اشتباهِ تکراری است، نه محدودیتِ واقعی.
export const MAX_ACTIVE = 6;

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
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_cert_jobs_status ON cert_jobs(status, updated_at)`,
];

let ready = false;
export async function ensureCertSchema(env) {
  if (ready) return;
  for (const sql of DDL) await env.DB.prepare(sql).run();
  ready = true;
}
// برای تست: هر تست دیتابیسِ تازه می‌خواهد.
export function resetCertSchemaMemo() {
  ready = false;
}

const iso = (ms) => new Date(ms).toISOString();
const changed = (res) => (res && res.meta ? res.meta.changes || 0 : 0) > 0;

/** شناسه‌ی کوتاه: داخلِ callback_data می‌نشیند که سقفش ۶۴ بایت است. */
export function newJobId() {
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

export async function createDraft(env, ownerId, name, now = Date.now()) {
  await ensureCertSchema(env);
  const id = newJobId();
  const t = iso(now);
  await env.DB
    .prepare(
      `INSERT INTO cert_jobs (id, owner_id, name, status, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?)`
    )
    .bind(id, String(ownerId), name, t, t)
    .run();
  return id;
}

export async function getJob(env, id) {
  await ensureCertSchema(env);
  return await env.DB.prepare(`SELECT * FROM cert_jobs WHERE id = ?`).bind(String(id)).first();
}

/**
 * دکمه‌ی جنسیت زده شد: پیش‌نویس → در صف (اگر نام از قبل هست) یا → منتظرِ
 * نام (اگر نیست). اتمیک؛ وضعیتِ نهایی را `job.status` می‌گوید.
 *
 * @returns {Promise<{ok: true, job: object} | {ok: false, why: "gone"|"expired"|"owner"}>}
 */
export async function takeDraft(env, { id, ownerId, gender, chatId, messageId, now = Date.now() }) {
  await ensureCertSchema(env);
  const res = await env.DB
    .prepare(
      `UPDATE cert_jobs
          SET status = CASE WHEN name = '' THEN 'awaiting_name' ELSE 'queued' END,
              gender = ?, chat_id = ?, message_id = ?, updated_at = ?
        WHERE id = ? AND owner_id = ? AND status = 'draft' AND created_at >= ?`
    )
    .bind(
      gender,
      String(chatId),
      messageId == null ? null : Number(messageId),
      iso(now),
      String(id),
      String(ownerId),
      iso(now - DRAFT_TTL_MS)
    )
    .run();
  const job = await getJob(env, id);
  if (changed(res)) return { ok: true, job };
  // چرا نشد؟ سه حالت است و پیامِ مدیر برای هرکدام فرق دارد.
  if (!job) return { ok: false, why: "gone" };
  if (job.owner_id !== String(ownerId)) return { ok: false, why: "owner" };
  if (job.status === "draft") return { ok: false, why: "expired" };
  return { ok: false, why: "gone" };
}

/**
 * نام رسید: منتظرِ نام → در صف. اتمیک، و فقط از awaiting_name - پس دو
 * پیامِ پشتِ سرِ هم یا یک پیامِ دیررس هرگز نامِ درخواست را عوض نمی‌کند.
 * مهلت از لحظه‌ی انتخابِ جنسیت حساب می‌شود (updated_at).
 *
 * @returns {Promise<{ok: true, job: object} | {ok: false, why: "gone"|"expired"}>}
 */
export async function submitName(env, { id, ownerId, name, now = Date.now() }) {
  await ensureCertSchema(env);
  const res = await env.DB
    .prepare(
      `UPDATE cert_jobs SET status = 'queued', name = ?, updated_at = ?
        WHERE id = ? AND owner_id = ? AND status = 'awaiting_name' AND updated_at >= ?`
    )
    .bind(name, iso(now), String(id), String(ownerId), iso(now - DRAFT_TTL_MS))
    .run();
  const job = await getJob(env, id);
  if (changed(res)) return { ok: true, job };
  if (job && job.owner_id === String(ownerId) && job.status === "awaiting_name") {
    return { ok: false, why: "expired" };
  }
  return { ok: false, why: "gone" };
}

export async function cancelDraft(env, id, ownerId, now = Date.now()) {
  await ensureCertSchema(env);
  const res = await env.DB
    .prepare(
      `UPDATE cert_jobs SET status = 'cancelled', updated_at = ?
        WHERE id = ? AND owner_id = ? AND status IN ('draft','awaiting_name')`
    )
    .bind(iso(now), String(id), String(ownerId))
    .run();
  return changed(res);
}

/**
 * ورک‌فلو یک درخواستِ منتظر برمی‌دارد. دو مرحله‌ای عمداً: اول خواندنِ
 * قدیمی‌ترین، بعد UPDATE شرطی. اگر دو ورک‌فلو هم‌زمان همان را ببینند،
 * فقط یکی `changes` می‌گیرد و دیگری دوباره تلاش می‌کند.
 */
export async function claimNext(env, now = Date.now()) {
  await ensureCertSchema(env);
  for (let i = 0; i < 4; i++) {
    const next = await env.DB
      .prepare(`SELECT id FROM cert_jobs WHERE status = 'queued' ORDER BY updated_at LIMIT 1`)
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
 * پایانِ کار. «done» فقط از rendering ممکن است؛ شکست از هر دو.
 * برمی‌گرداند آیا واقعاً گذار انجام شد - برای اینکه یک ورک‌فلوی دیررسیده
 * نتواند درخواستی را که قبلاً شکست‌خورده اعلام شده «انجام‌شده» کند.
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
 * درخواست‌های گیرکرده را شکست‌خورده اعلام می‌کند، و داده‌ی کهنه را پاک.
 * @returns {Promise<{stale: object[], purged: number}>}
 */
export async function sweep(env, now = Date.now()) {
  await ensureCertSchema(env);
  const cutoff = iso(now - STALE_MS);
  const { results } = await env.DB
    .prepare(
      `SELECT * FROM cert_jobs
        WHERE status IN ('queued','rendering') AND updated_at < ? LIMIT 20`
    )
    .bind(cutoff)
    .all();
  const stale = [];
  for (const row of results || []) {
    const code = row.status === "queued" ? "no_runner" : "timeout";
    if (await finishJob(env, row.id, "failed", code, now)) stale.push({ ...row, error: code });
  }
  const purge = await env.DB
    .prepare(
      `DELETE FROM cert_jobs
        WHERE (status IN ('done','failed','cancelled') AND updated_at < ?)
           OR (status IN ('draft','awaiting_name') AND updated_at < ?)`
    )
    // پیش‌نویسی که از ربع ساعت گذشته دیگر به کار نمی‌آید؛ نامش را بیش از
    // یک روز نگه نمی‌داریم.
    .bind(iso(now - KEEP_MS), iso(now - 24 * 60 * 60 * 1000))
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
    .prepare(`SELECT * FROM cert_jobs WHERE status = 'rendering' LIMIT 20`)
    .all();
  const out = [];
  for (const row of results || []) {
    if (await finishJob(env, row.id, "failed", "render", now)) out.push({ ...row, error: "render" });
  }
  return out;
}
