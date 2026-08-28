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
import { embedBatch, EMBED_BATCH_MAX } from "./gemini.js";
import { ensureKbSchema } from "./kb.js";
import { SEED } from "./seed.js";

const DDL = `CREATE TABLE IF NOT EXISTS kb_source (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   origin TEXT, category TEXT, question TEXT, answer TEXT,
   active INTEGER DEFAULT 1, updated_at TEXT)`;

// یکتا بودن روی origin: هر مدخل یک ردیف دارد و همگام‌سازی دوباره همان
// ردیف را به‌روز می‌کند، نه اینکه نسخه‌ی دومی بسازد.
const DDL_IDX = `CREATE UNIQUE INDEX IF NOT EXISTS kb_source_origin ON kb_source(origin)`;

export async function ensureSourceSchema(env) {
  await env.DB.prepare(DDL).run();
  await env.DB.prepare(DDL_IDX).run();
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

async function runChunked(env, statements) {
  for (let i = 0; i < statements.length; i += DB_CHUNK) {
    await env.DB.batch(statements.slice(i, i + DB_CHUNK));
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
               updated_at = excluded.updated_at`
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

export async function addSourceEntry(env, question, answer) {
  await ensureSourceSchema(env);
  const now = new Date().toISOString();
  const res = await env.DB
    .prepare(
      `INSERT INTO kb_source (origin, category, question, answer, active, updated_at)
         VALUES (?, 'دستی', ?, ?, 1, ?)`
    )
    .bind("manual:" + now + ":" + Math.random().toString(36).slice(2, 8), question, answer, now)
    .run();
  return res.meta ? res.meta.last_row_id : 0;
}

export async function removeSourceEntry(env, id) {
  await ensureSourceSchema(env);
  const res = await env.DB
    .prepare(`UPDATE kb_source SET active = 0 WHERE id = ? AND active = 1`)
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
  const ids = rows.map((r) => r.id);

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
  if (ids.length > 0) {
    await env.DB
      .prepare(`DELETE FROM ai_kb WHERE id NOT IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids)
      .run();
  } else {
    await env.DB.prepare(`DELETE FROM ai_kb`).run();
  }

  return rows.length;
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
    await runChunked(env, updates);
    done += updates.length;
  }

  return done;
}

/**
 * همگام‌سازی کامل. یک‌بار زدنش کافی است.
 * @returns {{sources:number, mirrored:number, embedded:number, pending:number}}
 */
export async function syncAndRebuild(env) {
  await ensureSourceSchema(env);
  await ensureKbSchema(env);

  const sources = await syncSources(env);
  const mirrored = await mirrorToKb(env);
  const embedded = await embedPending(env);
  const pending = (await pendingRows(env)).length;

  return { sources, mirrored, embedded, pending };
}
