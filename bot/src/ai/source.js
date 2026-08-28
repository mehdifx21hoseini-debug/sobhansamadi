// پایگاه دانش، بدون n8n.
//
// تا امروز جدول ai_kb از CRM پر می‌شد و ورکر فقط آینه‌اش را نگه می‌داشت.
// نتیجه این بود که با قطع شدن n8n، دستیار هوش مصنوعی هم خاموش می‌ماند -
// نه به‌خاطر کد، که کامل بود، بلکه چون هیچ داده‌ای نداشت.
//
// این فایل همان داده را از دو منبعی می‌سازد که خودِ ربات دارد:
//
//   ۱ - متن هر بخش. آکادمی این‌ها را نوشته و از /edit عوضشان می‌کند؛
//       همان‌ها جواب دقیق «دوره‌ها چیست»، «بروکر کدام است» و ده‌ها سوال
//       دیگرند.
//   ۲ - پرسش و پاسخ‌هایی که مدیر با /kbadd اضافه می‌کند - چیزهایی که در
//       هیچ متن بخشی نیستند: قیمت، شرایط، جزئیات.
//
// وقتی n8n برگردد، همگام‌سازی از آن‌طرف این را جای‌گزین می‌کند و هیچ‌چیز
// نمی‌شکند: هر دو در نهایت به همان ai_kb می‌نویسند.

import { SECTIONS, resolveSection } from "../content/sectionText.js";
import { embedQuestion } from "./gemini.js";
import { ensureKbSchema, replaceKb } from "./kb.js";

const DDL = `CREATE TABLE IF NOT EXISTS kb_source (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   origin TEXT, category TEXT, question TEXT, answer TEXT,
   active INTEGER DEFAULT 1, updated_at TEXT)`;

// یکتا بودن روی origin: هر بخش یک ردیف دارد و همگام‌سازی دوباره، همان
// ردیف را به‌روز می‌کند نه اینکه نسخه‌ی دومی بسازد.
const DDL_IDX = `CREATE UNIQUE INDEX IF NOT EXISTS kb_source_origin ON kb_source(origin)`;

export async function ensureSourceSchema(env) {
  await env.DB.prepare(DDL).run();
  await env.DB.prepare(DDL_IDX).run();
}

// متن بخش‌ها → پرسش و پاسخ.
//
// «سوال» اینجا عنوان بخش است، نه یک جمله‌ی پرسشی. رتبه‌بندی معنایی روی
// بردارِ متن انجام می‌شود و عنوان فقط برچسبی است که مدل در پرامپت
// می‌بیند - و «کتاب‌های روانشناسی» به‌اندازه‌ی «کتاب‌های روانشناسی
// چیست؟» به سوال کاربر نزدیک است.
async function sectionEntries(env) {
  const out = [];
  for (const [key, section] of Object.entries(SECTIONS)) {
    const { text } = await resolveSection(env, key).catch(() => ({ text: "" }));
    const answer = String(text || "").trim();
    // متن‌های خیلی کوتاه (مثل «یکی از گزینه‌ها را انتخاب کنید») چیزی به
    // دانش اضافه نمی‌کنند و فقط نویز رتبه‌بندی‌اند.
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

// بخش‌ها را در kb_source می‌نشاند. ردیف‌های دستیِ مدیر دست نمی‌خورند.
async function syncSections(env) {
  const entries = await sectionEntries(env);
  const now = new Date().toISOString();
  if (entries.length === 0) return 0;

  await env.DB.batch(
    entries.map((e) =>
      env.DB
        .prepare(
          `INSERT INTO kb_source (origin, category, question, answer, active, updated_at)
             VALUES (?, ?, ?, ?, 1, ?)
             ON CONFLICT(origin) DO UPDATE SET
               category = excluded.category, question = excluded.question,
               answer = excluded.answer, updated_at = excluded.updated_at`
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
 * ساختن ai_kb از kb_source.
 *
 * هر ردیف یک بردار لازم دارد و بردارها یکی‌یکی از Gemini گرفته می‌شوند.
 * برای چند ده ردیف این چند ثانیه است و فقط وقتی اجرا می‌شود که مدیر
 * دستور بدهد - نه در مسیر پاسخ به کاربر.
 *
 * ردیفی که بردارش نیامد کنار گذاشته نمی‌شود: بدون بردار وارد می‌شود و
 * رتبه‌بندی نادیده‌اش می‌گیرد، ولی اگر هیچ ردیفی به آستانه نرسد باز هم
 * در پرامپت دیده می‌شود. نبودنِ یک بردار نباید یک جواب را حذف کند.
 */
export async function rebuildKb(env) {
  await ensureKbSchema(env);
  const rows = await listSource(env);
  if (rows.length === 0) return { total: 0, embedded: 0 };

  let embedded = 0;
  const entries = [];
  for (const r of rows) {
    let embedding = null;
    try {
      const vec = await embedQuestion(env, r.question + "\n" + r.answer);
      if (Array.isArray(vec) && vec.length) {
        embedding = JSON.stringify(vec);
        embedded++;
      }
    } catch (err) {
      console.error("بردار مدخل ساخته نشد:", r.id, err && err.message);
    }
    entries.push({
      id: r.id,
      category: r.category,
      question: r.question,
      answer: r.answer,
      embedding,
      active: 1,
    });
  }

  await replaceKb(env, entries);
  return { total: entries.length, embedded };
}

export async function syncAndRebuild(env) {
  await ensureSourceSchema(env);
  const sections = await syncSections(env);
  const built = await rebuildKb(env);
  return { sections, ...built };
}
