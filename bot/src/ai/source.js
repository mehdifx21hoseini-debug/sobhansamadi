// پایگاه دانش، بدون n8n.
//
// تا امروز جدول ai_kb از CRM پر می‌شد و ورکر فقط آینه‌اش را نگه می‌داشت.
// نتیجه این بود که با قطع شدن n8n، دستیار هوش مصنوعی هم خاموش می‌ماند -
// نه به‌خاطر کد، که کامل بود، بلکه چون هیچ داده‌ای نداشت.
//
// حالا داده از سه منبع می‌آید:
//
//   ۱ - seed.js: پایگاه دانش کامل آکادمی، کنار کد.
//   ۲ - متن بخش‌ها: آنچه آکادمی از /edit می‌نویسد. جواب «دوره‌ها چیست»
//       و «بروکر کدام است» همان‌جاست و همیشه تازه‌ترین نسخه است.
//   ۳ - /kbadd: پرسش و پاسخ‌هایی که مدیر در لحظه اضافه می‌کند.
//
// هر سه در kb_source می‌نشینند و از آنجا با بردارهایشان به ai_kb می‌روند.
// وقتی n8n برگردد، همگام‌سازی از آن‌طرف همان ai_kb را می‌نویسد و چیزی
// نمی‌شکند.

import { SECTIONS, resolveSection } from "../content/sectionText.js";
import { embedBatch, EMBED_BATCH_MAX, EMBED_DIMS } from "./gemini.js";
import { ensureKbSchema, invalidateKbCache } from "./kb.js";
import { SEED } from "./seed.js";

const DDL = `CREATE TABLE IF NOT EXISTS kb_source (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   origin TEXT, category TEXT, question TEXT, answer TEXT,
   active INTEGER DEFAULT 1, updated_at TEXT)`;

// یکتا بودن روی origin: هر مدخل یک ردیف دارد و همگام‌سازی دوباره همان
// ردیف را به‌روز می‌کند، نه اینکه نسخه‌ی دومی بسازد.
const DDL_IDX = `CREATE UNIQUE INDEX IF NOT EXISTS kb_source_origin ON kb_source(origin)`;

// «این مدخل را آدم دست‌کاری کرده، دست نزن».
//
// بدون این، هر ویرایشی که از CRM روی یک مدخل seed یا یک متن بخش انجام
// می‌شد، با اولین همگام‌سازی بعدی بی‌صدا برمی‌گشت - بدترین نوع خرابی،
// چون کاربر تغییرش را می‌بیند، ذخیره می‌کند، و ساعت‌ها بعد بی‌دلیل
// ناپدید می‌شود. حذف هم همین‌طور: مدخل seedِ حذف‌شده دوباره سبز می‌شد.
const DDL_PINNED = `ALTER TABLE kb_source ADD COLUMN pinned INTEGER DEFAULT 0`;

export async function ensureSourceSchema(env) {
  await env.DB.prepare(DDL).run();
  await env.DB.prepare(DDL_IDX).run();
  try {
    await env.DB.prepare(DDL_PINNED).run();
  } catch (err) {
    // ستون از قبل هست - حالت عادی بعد از اولین اجرا.
    if (!/duplicate column/i.test(String(err && err.message))) throw err;
  }
}

// شناسه‌ی مدخل‌های seed از خود متن سوال ساخته می‌شود، نه از شماره‌ی
// سطر: اگر روزی ترتیب فایل عوض شود، شماره‌ها جابه‌جا می‌شدند و همه‌ی
// بردارها بی‌دلیل دوباره ساخته می‌شدند.
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function seedEntries() {
  return SEED.map((e) => ({
    origin: "seed:" + hash(e.question),
    category: e.category,
    question: e.question,
    answer: e.answer,
  }));
}

// متن بخش‌ها → پرسش و پاسخ.
//
// «سوال» اینجا عنوان بخش است، نه یک جمله‌ی پرسشی. رتبه‌بندی روی بردارِ
// کل متن انجام می‌شود و عنوان فقط برچسبی است که مدل در پرامپت می‌بیند.
async function sectionEntries(env) {
  const out = [];
  for (const [key, section] of Object.entries(SECTIONS)) {
    const { text } = await resolveSection(env, key).catch(() => ({ text: "" }));
    const answer = String(text || "").trim();
    // متن‌های خیلی کوتاه («یکی از گزینه‌ها را انتخاب کنید») دانش نیستند
    // و فقط نویز رتبه‌بندی‌اند.
    if (answer.length < 60) continue;
    out.push({
      origin: "section:" + key,
      category: "بخش‌های ربات",
      question: section.label.replace(/^[^\p{L}\p{N}]+/u, "").trim(),
      answer,
    });
  }
  return out;
}

// D1 روی هر batch سقف دارد و ۲۲۳ دستور در یک فراخوانی، آن را می‌شکند.
const DB_CHUNK = 40;

// نوشتن بردارها استثناست: هر بردار ۷۶۸ عددِ اعشاری است، یعنی حدود ۱۵
// کیلوبایت متن. چهل‌تا در یک batch نزدیک به یک مگابایت درخواست می‌شود و
// D1 پسش می‌زند - محدودیت اینجا حجم است نه تعداد.
const DB_CHUNK_HEAVY = 10;

async function runChunked(env, statements, size = DB_CHUNK) {
  for (let i = 0; i < statements.length; i += size) {
    await env.DB.batch(statements.slice(i, i + size));
  }
}

/**
 * seed و بخش‌ها را در kb_source می‌نشاند.
 *
 * ردیف‌های دستیِ /kbadd دست نمی‌خورند، و بردارِ مدخلی که متنش عوض نشده
 * هم دور ریخته نمی‌شود - وگرنه هر همگام‌سازی، همه‌ی ۲۲۳ بردار را دوباره
 * می‌ساخت.
 */
async function syncSources(env) {
  const entries = [...seedEntries(), ...(await sectionEntries(env))];
  const now = new Date().toISOString();

  await runChunked(
    env,
    entries.map((e) =>
      env.DB
        .prepare(
          `INSERT INTO kb_source (origin, category, question, answer, active, updated_at)
             VALUES (?, ?, ?, ?, 1, ?)
             ON CONFLICT(origin) DO UPDATE SET
               category = excluded.category, question = excluded.question,
               answer = excluded.answer, active = 1,
               updated_at = excluded.updated_at
             WHERE kb_source.pinned = 0`
        )
        .bind(e.origin, e.category, e.question, e.answer, now)
    )
  );
  return entries.length;
}

export async function listSource(env) {
  await ensureSourceSchema(env);
  const { results } = await env.DB
    .prepare(
      `SELECT id, origin, category, question, answer FROM kb_source
         WHERE active = 1 ORDER BY id`
    )
    .all();
  return results || [];
}

export async function addSourceEntry(env, question, answer, category) {
  await ensureSourceSchema(env);
  const now = new Date().toISOString();
  const res = await env.DB
    .prepare(
      `INSERT INTO kb_source (origin, category, question, answer, active, updated_at)
         VALUES (?, ?, ?, ?, 1, ?)`
    )
    .bind(
      "manual:" + now + ":" + Math.random().toString(36).slice(2, 8),
      category || "دستی",
      question,
      answer,
      now
    )
    .run();
  return res.meta ? res.meta.last_row_id : 0;
}

/**
 * همان فهرست، ولی برای صفحه‌ی CRM: با جستجو، صفحه‌بندی، و اینکه هر مدخل
 * از کجا آمده و چند بار به کار آمده.
 *
 * منشأ برای کاربر معنا دارد: مدخلی که از متن بخش‌ها می‌آید، تا وقتی
 * دست‌نخورده است با /edit در تلگرام عوض می‌شود؛ ویرایشش از اینجا آن
 * پیوند را می‌بُرد و رابط باید این را بگوید.
 */
export async function listSourceForAdmin(env, opts = {}) {
  await ensureSourceSchema(env);
  await ensureKbSchema(env);

  const where = ["s.active = 1"];
  const args = [];
  if (opts.q) {
    where.push("(s.question LIKE ? ESCAPE '\\' OR s.answer LIKE ? ESCAPE '\\')");
    const like = "%" + String(opts.q).replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    args.push(like, like);
  }
  if (opts.category) {
    where.push("s.category = ?");
    args.push(opts.category);
  }
  if (opts.origin === "manual") where.push("s.origin LIKE 'manual:%'");
  else if (opts.origin === "section") where.push("s.origin LIKE 'section:%'");
  else if (opts.origin === "seed") where.push("s.origin LIKE 'seed:%'");

  const clause = " WHERE " + where.join(" AND ");
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const offset = Math.max(Number(opts.offset) || 0, 0);

  const total = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM kb_source s${clause}`)
    .bind(...args)
    .first();

  const { results } = await env.DB
    .prepare(
      `SELECT s.id, s.origin, s.category, s.question, s.answer, s.updated_at, s.pinned,
              COALESCE(u.usage_count, 0) AS usage_count, u.last_used_at,
              CASE WHEN k.embedding IS NULL THEN 0 ELSE 1 END AS has_vector
         FROM kb_source s
         LEFT JOIN ai_kb_usage u ON u.kb_id = s.id
         LEFT JOIN ai_kb k ON k.id = s.id
         ${clause} ORDER BY s.id LIMIT ? OFFSET ?`
    )
    .bind(...args, limit, offset)
    .all();

  const { results: categories } = await env.DB
    .prepare(
      `SELECT category, COUNT(*) AS n FROM kb_source WHERE active = 1
         GROUP BY category ORDER BY n DESC`
    )
    .all();

  return {
    total: (total && total.n) || 0,
    categories: categories || [],
    rows: (results || []).map((r) => ({
      id: r.id,
      // منشأ کامل شامل hash است و به درد رابط نمی‌خورد؛ فقط نوعش لازم است.
      source: String(r.origin || "").split(":")[0],
      // pinned یعنی این متن را آدم نوشته و همگام‌سازی رویش نمی‌نویسد.
      pinned: r.pinned === 1,
      category: r.category,
      question: r.question,
      answer: r.answer,
      usage_count: r.usage_count,
      last_used_at: r.last_used_at,
      has_vector: r.has_vector === 1,
      updated_at: r.updated_at,
    })),
  };
}

/**
 * ویرایش یک مدخل از CRM.
 *
 * هر مدخلی قابل ویرایش است - حتی مدخل‌های seed و متن بخش‌ها - ولی
 * ویرایش، مدخل را pinned می‌کند تا همگام‌سازی بعدی رویش ننویسد. یعنی
 * حرف آخر با آدم است، نه با فایل.
 *
 * @returns {Promise<{changed:number, reason?:string}>}
 */
export async function updateSourceEntry(env, id, { category, question, answer }) {
  await ensureSourceSchema(env);
  const res = await env.DB
    .prepare(
      `UPDATE kb_source SET category = ?, question = ?, answer = ?, pinned = 1,
              updated_at = ? WHERE id = ? AND active = 1`
    )
    .bind(category || "دستی", question, answer, new Date().toISOString(), Number(id))
    .run();
  const changed = res.meta ? res.meta.changes || 0 : 0;
  return changed > 0 ? { changed } : { changed: 0, reason: "not_found" };
}

/**
 * جای‌گزینی کل پایگاه دانش با یک فهرست - همان ویرایشگر «متن کامل» CRM.
 *
 * تطبیق با متن سوال انجام می‌شود، نه با شماره: ویرایشگر متنی شماره ندارد
 * و اگر بر اساس ترتیب تطبیق می‌شد، اضافه کردن یک مدخل در وسط، همه‌ی
 * مدخل‌های بعدی را جابه‌جا می‌کرد و بی‌صدا متن‌ها را روی هم می‌ریخت.
 *
 * هر چیزی که از این مسیر می‌گذرد pinned می‌شود - چه ویرایش، چه حذف.
 * یعنی بعد از یک بار ویرایش متنی، آن مدخل‌ها دیگر از seed یا متن بخش‌ها
 * به‌روز نمی‌شوند و حرف آخر با همین متن است. این عمدی است: «کل پایگاه
 * دانش را با این متن جای‌گزین کن» معنای دیگری ندارد.
 *
 * @returns {Promise<{added:number, updated:number, removed:number}>}
 */
export async function bulkReplaceSource(env, entries) {
  await ensureSourceSchema(env);
  const now = new Date().toISOString();
  const key = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

  const existing = await listSource(env);
  const byQuestion = new Map();
  for (const r of existing) if (!byQuestion.has(key(r.question))) byQuestion.set(key(r.question), r);

  const statements = [];
  const seen = new Set();
  let added = 0;
  let updated = 0;

  for (const e of entries) {
    const question = String(e.question || "").trim();
    const answer = String(e.answer || "").trim();
    if (!question) continue;
    const k = key(question);
    const match = seen.has(k) ? null : byQuestion.get(k);
    seen.add(k);

    if (match) {
      updated++;
      statements.push(
        env.DB
          .prepare(
            `UPDATE kb_source SET category = ?, question = ?, answer = ?, active = 1,
                    pinned = 1, updated_at = ? WHERE id = ?`
          )
          .bind(e.category || match.category || "دستی", question, answer, now, match.id)
      );
    } else {
      added++;
      statements.push(
        env.DB
          .prepare(
            `INSERT INTO kb_source (origin, category, question, answer, active, pinned, updated_at)
               VALUES (?, ?, ?, ?, 1, 1, ?)`
          )
          .bind(
            "manual:" + now + ":" + Math.random().toString(36).slice(2, 10),
            e.category || "دستی",
            question,
            answer,
            now
          )
      );
    }
  }

  const removedRows = existing.filter((r) => !seen.has(key(r.question)));
  for (const r of removedRows) {
    statements.push(
      env.DB.prepare(`UPDATE kb_source SET active = 0, pinned = 1 WHERE id = ?`).bind(r.id)
    );
  }

  await runChunked(env, statements);
  return { added, updated, removed: removedRows.length };
}

/**
 * برگرداندن یک مدخل به حالت اولیه‌اش.
 *
 * pinned را برمی‌دارد؛ متن واقعی در همگام‌سازی بعدی از منبع اصلی
 * (seed یا متن بخش) دوباره نوشته می‌شود. برای مدخل دستی معنایی ندارد
 * چون منبع اصلی‌ای وجود ندارد که به آن برگردد.
 */
export async function unpinSourceEntry(env, id) {
  await ensureSourceSchema(env);
  const res = await env.DB
    .prepare(`UPDATE kb_source SET pinned = 0, active = 1 WHERE id = ?`)
    .bind(Number(id))
    .run();
  return res.meta ? res.meta.changes || 0 : 0;
}

/**
 * برداشتن یک مدخل.
 *
 * pinned هم می‌شود، وگرنه مدخل seedِ حذف‌شده با همگام‌سازی بعدی دوباره
 * سبز می‌شد و به نظر می‌رسید حذف اصلاً کار نمی‌کند.
 */
export async function removeSourceEntry(env, id) {
  await ensureSourceSchema(env);
  const res = await env.DB
    .prepare(`UPDATE kb_source SET active = 0, pinned = 1 WHERE id = ? AND active = 1`)
    .bind(Number(id))
    .run();
  return res.meta ? res.meta.changes || 0 : 0;
}

/**
 * kb_source → ai_kb، بدون دست زدن به بردارهایی که از قبل درست‌اند.
 *
 * بردار فقط وقتی دور ریخته می‌شود که متن مدخل عوض شده باشد. بدون این
 * شرط، هر همگام‌سازی دوباره برای همه‌ی مدخل‌ها بردار می‌ساخت - هم کند،
 * هم بی‌دلیل پرهزینه.
 */
async function mirrorToKb(env) {
  const rows = await listSource(env);

  await runChunked(
    env,
    rows.map((r) =>
      env.DB
        .prepare(
          `INSERT INTO ai_kb (id, category, question, answer, embedding, active)
             VALUES (?, ?, ?, ?, NULL, 1)
             ON CONFLICT(id) DO UPDATE SET
               category = excluded.category, question = excluded.question,
               answer = excluded.answer, active = 1,
               embedding = CASE
                 WHEN ai_kb.question = excluded.question AND ai_kb.answer = excluded.answer
                 THEN ai_kb.embedding ELSE NULL END`
        )
        .bind(r.id, r.category, r.question, r.answer)
    )
  );

  // مدخل‌هایی که از kb_source رفته‌اند (با /kbdel) نباید در ai_kb بمانند.
  //
  // با زیرکوئری، نه با فهرست شناسه‌ها: D1 سقف ۱۰۰ پارامتر در هر کوئری
  // دارد و ۲۵۰ شناسه‌ی جداگانه، کل همگام‌سازی را با خطا می‌خواباند.
  // زیرکوئری صفر پارامتر دارد، پس هر تعداد مدخل هم که باشد کار می‌کند.
  await env.DB
    .prepare(`DELETE FROM ai_kb WHERE id NOT IN (SELECT id FROM kb_source WHERE active = 1)`)
    .run();

  return rows.length;
}

/**
 * بردارهایی که با ابعاد دیگری ساخته شده‌اند را دور می‌ریزد.
 *
 * لازم است چون بردار قدیمی هیچ نشانه‌ای از خراب بودن ندارد: کسینوسِ دو
 * بردار با طول متفاوت صفر برمی‌گردد، یعنی آن مدخل بی‌صدا از رتبه‌بندی
 * معنایی حذف می‌شود بدون اینکه خطایی جایی ثبت شود. با NULL شدن، همان
 * همگام‌سازی دوباره می‌سازدشان.
 */
async function dropStaleVectors(env) {
  const sql = `UPDATE ai_kb SET embedding = NULL
                 WHERE embedding IS NOT NULL AND json_array_length(embedding) != ?`;
  try {
    const res = await env.DB.prepare(sql).bind(EMBED_DIMS).run();
    return res.meta ? res.meta.changes || 0 : 0;
  } catch (err) {
    // اگر توابع JSON در دسترس نبودند، محتاطانه همه را دور می‌ریزیم:
    // ساختن دوباره‌ی همه‌ی بردارها پنج درخواست است، ولی ماندنِ یک بردار
    // با ابعاد اشتباه یعنی رتبه‌بندیِ خراب تا ابد.
    console.error("سنجش ابعاد بردار ممکن نشد، همه دوباره ساخته می‌شوند:", err && err.message);
    const res = await env.DB.prepare(`UPDATE ai_kb SET embedding = NULL`).run();
    return res.meta ? res.meta.changes || 0 : 0;
  }
}

async function pendingRows(env) {
  const { results } = await env.DB
    .prepare(`SELECT id, question, answer FROM ai_kb WHERE embedding IS NULL AND active = 1`)
    .all();
  return results || [];
}

/**
 * بردار مدخل‌هایی که ندارند.
 *
 * دسته‌ای، نه یکی‌یکی: ۲۲۳ درخواست بیرونی در یک اجرا از سقف Cloudflare
 * Workers رد می‌شود، ولی همان کار با دسته‌های ۵۰تایی پنج درخواست است.
 *
 * شکست یک دسته کل کار را متوقف نمی‌کند: بقیه ادامه می‌دهند و مدخل‌های
 * بی‌بردار در همگام‌سازی بعدی دوباره تلاش می‌شوند - چون هنوز NULL‌اند.
 */
async function embedPending(env) {
  const rows = await pendingRows(env);
  let done = 0;

  for (let i = 0; i < rows.length; i += EMBED_BATCH_MAX) {
    const chunk = rows.slice(i, i + EMBED_BATCH_MAX);
    let vectors;
    try {
      vectors = await embedBatch(env, chunk.map((r) => r.question + "\n" + r.answer));
    } catch (err) {
      console.error("ساخت دسته‌ی بردار شکست خورد:", err && err.message);
      continue;
    }

    const updates = [];
    chunk.forEach((r, j) => {
      const vec = vectors[j];
      if (!Array.isArray(vec) || vec.length === 0) return;
      updates.push(
        env.DB.prepare(`UPDATE ai_kb SET embedding = ? WHERE id = ?`).bind(JSON.stringify(vec), r.id)
      );
    });
    await runChunked(env, updates, DB_CHUNK_HEAVY);
    done += updates.length;
  }

  return done;
}

/**
 * همگام‌سازی کامل. یک‌بار زدنش کافی است.
 * @returns {{sources:number, mirrored:number, embedded:number, pending:number}}
 */
export async function syncAndRebuild(env) {
  // نام هر مرحله در خطا می‌آید. بدون این، «همگام‌سازی شکست خورد» می‌تواند
  // پنج چیز متفاوت باشد و از بیرون همه یک شکل‌اند.
  let stage = "ساخت جدول‌ها";
  try {
    await ensureSourceSchema(env);
    await ensureKbSchema(env);

    stage = "نوشتن منابع";
    const sources = await syncSources(env);

    stage = "کپی به پایگاه دانش";
    const mirrored = await mirrorToKb(env);

    stage = "پاک‌سازی بردارهای قدیمی";
    const stale = await dropStaleVectors(env);

    stage = "ساخت بردارها";
    const embedded = await embedPending(env);

    stage = "شمارش نهایی";
    const pending = (await pendingRows(env)).length;

    // هر isolate کش خودش را دارد؛ این فقط همینجا را تازه می‌کند و بقیه
    // با پایان عمر کش هم‌تراز می‌شوند.
    invalidateKbCache();

    return { sources, mirrored, embedded, pending, stale };
  } catch (err) {
    const e = new Error("در مرحله‌ی «" + stage + "»: " + (err && err.message));
    e.cause = err;
    throw e;
  }
}
