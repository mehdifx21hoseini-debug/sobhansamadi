// ساختِ جدول‌ها (DDL) - یک بار، نه در هر درخواست.
//
// ─── چرا ────────────────────────────────────────────────────────────
//
// هر بخش تابعِ ensure…Schema خودش را دارد که CREATE TABLE IF NOT EXISTS و
// ALTER TABLE ADD COLUMN اجرا می‌کند. بیشترشان حافظه نداشتند و در هر
// صدا زدن دوباره اجرا می‌شدند: کرانِ پنج‌دقیقه‌ای در یک ایزوله‌ی تازه ۷۱
// کوئری می‌زد که حدودِ ۳۵تایش همین DDL بود (اندازه‌گیریِ ۱۱ نوامبر با
// test/freePlanBudget.harness.mjs).
//
// پلنِ رایگانِ کلادفلر برای هر اجرای ورکر ۵۰ کوئریِ D1 و حدودِ ۱۰
// میلی‌ثانیه CPU می‌دهد. DDLِ تکراری هر دو را می‌خورد و هیچ چیزی
// برنمی‌گرداند - جدول‌ها از ماه‌ها پیش ساخته شده‌اند.
//
// ─── چطور ───────────────────────────────────────────────────────────
//
// ۱. هر طرح با defineSchema ثبت می‌شود: نام، متنِ DDLش، و تابعی که
//    می‌سازدش. نسخه‌ی کلِ طرح، هشِ همه‌ی این متن‌هاست - پس هر تغییری در
//    هر DDL، بی‌آنکه کسی یادش باشد عددی را بالا ببرد، نسخه را عوض می‌کند.
// ۲. bot_config.schema_version می‌گوید آخرین بار کدام نسخه کامل ساخته
//    شده. اگر با نسخه‌ی همین کد یکی باشد، هیچ ensureی هیچ DDLی اجرا
//    نمی‌کند - فقط یک خواندنِ یک‌ردیفی برای هر ایزوله.
// ۳. اگر یکی نباشد (کدِ تازه با جدول یا ستونِ تازه)، هر ensure مثلِ قبل
//    کارِ خودش را می‌کند - ولی فقط یک بار در هر ایزوله - و کرانِ ده‌دقیقه‌ای
//    همه را یک‌جا می‌سازد و نسخه را می‌نویسد.
//
// حافظه به ازای خودِ env.DB نگه داشته می‌شود، نه سراسری: تست‌ها هر بار
// دیتابیسِ تازه می‌سازند و باید جدول‌هایشان ساخته شود.

const registry = new Map();
const readyByDb = new WeakMap();
const gateByDb = new WeakMap();

export const SCHEMA_KEY = "schema_version";

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

let versionMemo = null;
let versionCount = -1;

/** نسخه‌ی کلِ طرح: هشِ نام و DDLِ همه‌ی طرح‌های ثبت‌شده. */
export function schemaVersion() {
  if (versionMemo && versionCount === registry.size) return versionMemo;
  const names = [...registry.keys()].sort();
  const text = names.map((n) => n + "\n" + registry.get(n).sig).join("\n\n");
  versionMemo = registry.size + "-" + fnv1a(text);
  versionCount = registry.size;
  return versionMemo;
}

function readySet(env) {
  let s = readyByDb.get(env.DB);
  if (!s) {
    s = new Set();
    readyByDb.set(env.DB, s);
  }
  return s;
}

/** آیا آخرین ساختِ کامل با همین نسخه بوده؟ یک خواندن برای هر دیتابیس/ایزوله. */
export function schemaCurrent(env) {
  if (!env || !env.DB) return Promise.resolve(false);
  let p = gateByDb.get(env.DB);
  if (!p) {
    // هر خطایی - جدولِ نبوده، یا دیتابیسِ ساختگیِ تستی که first ندارد -
    // یعنی «معلوم نیست»، و آن وقت DDL مثلِ قبل اجرا می‌شود.
    p = Promise.resolve()
      .then(() => env.DB.prepare("SELECT value FROM bot_config WHERE key = ?").bind(SCHEMA_KEY).first())
      .then((row) => !!row && row.value === schemaVersion())
      .catch(() => false);
    gateByDb.set(env.DB, p);
  }
  return p;
}

/**
 * یک طرح را ثبت می‌کند و ensureِ حافظه‌دارش را برمی‌گرداند.
 *
 * @param {string} name نامِ یکتا
 * @param {string|string[]} ddl متنِ DDL - فقط برای ساختنِ نسخه
 * @param {(env) => Promise<void>} create همان کارِ قبلیِ ensure
 */
export function defineSchema(name, ddl, create) {
  const sig = Array.isArray(ddl) ? ddl.join(";\n") : String(ddl);
  // هزینه‌ی تقریبی به کوئری: یکی برای هر دستور. برای اینکه ساختِ همه با
  // هم از سقفِ ۵۰ کوئریِ هر اجرا رد نشود (ensureAllSchemas).
  const cost = Array.isArray(ddl) ? ddl.length : 1;
  registry.set(name, { sig, create, cost });
  versionMemo = null;
  const inflight = new WeakMap();
  return async function ensure(env) {
    const done = readySet(env);
    if (done.has(name)) return;
    if (await schemaCurrent(env)) {
      done.add(name);
      return;
    }
    let p = inflight.get(env.DB);
    if (!p) {
      p = (async () => {
        await create(env);
        done.add(name);
      })().finally(() => inflight.delete(env.DB));
      inflight.set(env.DB, p);
    }
    return p;
  };
}

export const SCHEMA_PROGRESS_KEY = "schema_progress";

/** سقفِ کوئری برای یک بارِ ensureAllSchemas؛ بقیه‌اش اجرای بعد. */
const BUILD_BUDGET = 30;

/**
 * همه‌ی طرح‌ها را می‌سازد و، اگر همه موفق بودند، نسخه را ثبت می‌کند.
 * فقط وقتی کاری می‌کند که نسخه‌ی ثبت‌شده با این کد یکی نباشد.
 *
 * چند تکه، نه یک‌جا: همه با هم حدودِ ۵۵ کوئری است و پلنِ رایگان در هر
 * اجرا ۵۰ تا می‌دهد. پیشرفت در bot_config.schema_progress می‌ماند، پس
 * کرانِ ده‌دقیقه‌ایِ بعدی - حتی روی ایزوله‌ی دیگری - از همان‌جا ادامه
 * می‌دهد. (env.DB.batch یک کوئری حساب می‌شود، پس هزینه‌ی واقعی کمتر از
 * این تخمین است.)
 *
 * @returns {{current: true}|{built: number, version: string}|{partial: number, left: number}}
 */
export async function ensureAllSchemas(env, { force = false, budget = BUILD_BUDGET } = {}) {
  if (!force && (await schemaCurrent(env))) return { current: true };
  const version = schemaVersion();
  const done = readySet(env);
  const upsert = (key, value) =>
    env.DB.prepare(
      `INSERT INTO bot_config (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
      .bind(key, value, new Date().toISOString())
      .run();

  // جدولِ تنظیمات خودش پیش از همه، چون پیشرفت همان‌جا نوشته می‌شود.
  const first = registry.get("bot_config");
  if (first) {
    await first.create(env);
    done.add("bot_config");
  }
  let built = new Set();
  if (!force) {
    try {
      const row = await env.DB.prepare("SELECT value FROM bot_config WHERE key = ?").bind(SCHEMA_PROGRESS_KEY).first();
      const p = row && row.value ? JSON.parse(row.value) : null;
      if (p && p.v === version && Array.isArray(p.done)) built = new Set(p.done);
    } catch {
      /* از اول */
    }
  }
  built.add("bot_config");
  let spent = 3;
  for (const [name, { create, cost }] of registry) {
    if (built.has(name)) continue;
    // دست‌کم یکی در هر بار، حتی اگر تخمینش از بودجه بیشتر باشد (crm با
    // batch در عمل خیلی کمتر از تعدادِ دستورهایش کوئری می‌زند).
    if (!force && spent > 3 && spent + cost > budget) {
      await upsert(SCHEMA_PROGRESS_KEY, JSON.stringify({ v: version, done: [...built] }));
      return { partial: built.size, left: registry.size - built.size };
    }
    await create(env);
    done.add(name);
    built.add(name);
    spent += cost;
  }
  await upsert(SCHEMA_KEY, version);
  gateByDb.set(env.DB, Promise.resolve(true));
  return { built: registry.size, version };
}

/**
 * ستون‌هایی که هنوز نیستند - با یک کوئری به‌جای یک ALTER برای هر ستون.
 *
 * ALTER TABLE … ADD COLUMN برای ستونی که هست خطا می‌دهد و هر کدام یک
 * کوئریِ جداست؛ با ده ستون یعنی ده کوئری که همه شکست می‌خورند. اینجا
 * اول فهرستِ ستون‌های موجود خوانده می‌شود و فقط کمبودها اضافه می‌شوند.
 * اگر خواندنِ فهرست نشد، همان راهِ قبلی: همه را امتحان کن و «ستونِ
 * تکراری» را نادیده بگیر.
 *
 * دستورها به همان ترتیب اجرا می‌شوند؛ هر چیزی جز ALTER (مثلاً ایندکسی که
 * روی ستونِ تازه ساخته می‌شود) همیشه اجرا می‌شود.
 *
 * @param {string[]} stmts دستورهای ALTER TABLE <t> ADD COLUMN <c> … و هر DDLِ دیگر
 * @param {(err, sql) => void} [onError] برای خطاهایی جز «ستونِ تکراری»؛
 *   بی‌آن خطا بالا می‌رود.
 */
export async function addMissingColumns(env, stmts, onError) {
  const cols = new Map();
  const columnsOf = async (table) => {
    if (cols.has(table)) return cols.get(table);
    let have = null;
    try {
      const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
      const list = (results || []).map((r) => String(r.name).toLowerCase());
      // جدولی که نیست فهرستِ خالی می‌دهد؛ آنجا همان ALTER باید خطایش را بدهد.
      have = list.length ? new Set(list) : null;
    } catch {
      have = null;
    }
    cols.set(table, have);
    return have;
  };
  for (const sql of stmts) {
    const m = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/i.exec(sql);
    if (m) {
      const have = await columnsOf(m[1]);
      if (have && have.has(m[2].toLowerCase())) continue;
    }
    try {
      await env.DB.prepare(sql).run();
      if (m && cols.get(m[1])) cols.get(m[1]).add(m[2].toLowerCase());
    } catch (err) {
      if (/duplicate column/i.test(String((err && err.message) || err))) continue;
      if (onError) onError(err, sql);
      else throw err;
    }
  }
}

/** برای تست‌ها. */
export function registeredSchemas() {
  return [...registry.keys()];
}
