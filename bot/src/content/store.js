// کتابخانه‌ی محتوا در D1.
//
// فایل‌ها هرگز در جایی آپلود نمی‌شوند: آکادمی آن‌ها را در یک کانال خصوصی
// پست می‌کند و ربات که ادمین همان کانال است، file_id تلگرام را برمی‌دارد.
// همان file_id بعداً برای فرستادن به کاربر کافی است، بدون دانلود و آپلود
// دوباره. این همان کاری است که WF-13 می‌کرد.

const DDL = [
  `CREATE TABLE IF NOT EXISTS content_library (
     content_id TEXT PRIMARY KEY, title TEXT, file_id TEXT, file_type TEXT,
     active INTEGER DEFAULT 1, hidden INTEGER DEFAULT 0, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS text_content (
     content_id TEXT PRIMARY KEY, body TEXT, photo_file_id TEXT,
     active INTEGER DEFAULT 1, updated_at TEXT)`,
];

// active و hidden دو چیز جدا هستند و عمداً در یک ستون جمع نشده‌اند:
//
//   active = 0  یعنی «حذف شده» - از فهرست مدیر هم می‌رود.
//   hidden = 1  یعنی «فعلاً نه» - مدیر می‌بیندش، کاربر نه.
//
// اگر یکی بودند، مخفی کردن یک ویس برای «هنوز آماده نیست» با حذفش یک
// شکل می‌شد و مدیر راهی نداشت پیدایش کند تا برش گرداند.
let schemaReady = false;

export async function ensureContentSchema(env) {
  if (schemaReady) return;
  await env.DB.batch(DDL.map((sql) => env.DB.prepare(sql)));
  // ستون hidden بعداً اضافه شد؛ جدول‌هایی که از قبل ساخته شده‌اند آن را
  // ندارند و CREATE TABLE IF NOT EXISTS هم چیزی به آن‌ها اضافه نمی‌کند.
  // خطای «ستون تکراری» یعنی کار از قبل انجام شده - همان چیزی که
  // می‌خواستیم.
  try {
    await env.DB.prepare(`ALTER TABLE content_library ADD COLUMN hidden INTEGER DEFAULT 0`).run();
  } catch (err) {
    if (!/duplicate column/i.test(String(err && err.message))) {
      console.error("افزودن ستون hidden:", err && err.message);
    }
  }
  schemaReady = true;
}

// upsert است نه insert: پست دوباره‌ی همان هشتگ در کانال یعنی «این را
// جای‌گزین کن» - مثلاً وقتی فایل اشتباهی رفته یا نسخه‌ی بهتری ساخته شده.
export async function upsertContent(env, { contentId, title, fileId, fileType }) {
  await ensureContentSchema(env);
  await env.DB
    .prepare(
      `INSERT INTO content_library (content_id, title, file_id, file_type, active, updated_at)
       VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(content_id) DO UPDATE SET
         title = excluded.title, file_id = excluded.file_id,
         file_type = excluded.file_type, active = 1, updated_at = excluded.updated_at`
    )
    .bind(contentId, title || null, fileId, fileType, new Date().toISOString())
    .run();
}

export async function upsertTextContent(env, { contentId, body, photoFileId }) {
  await ensureContentSchema(env);
  await env.DB
    .prepare(
      `INSERT INTO text_content (content_id, body, photo_file_id, active, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(content_id) DO UPDATE SET
         body = excluded.body,
         -- عکس قبلی نباید با یک پست متنیِ بدون عکس پاک شود.
         photo_file_id = COALESCE(NULLIF(excluded.photo_file_id, ''), text_content.photo_file_id),
         active = 1, updated_at = excluded.updated_at`
    )
    .bind(contentId, body || null, photoFileId || "", new Date().toISOString())
    .run();
}

// پیش از اولین پست کانال جدول وجود ندارد. این خطا نیست - یعنی «هنوز
// محتوایی نداریم» - و باید به همان مسیر «در حال آماده‌سازی» برگردد.
function emptyIfNoTable(err) {
  if (err && /no such table/i.test(String(err.message))) return true;
  throw err;
}

// در LIKE، زیرخط یعنی «هر کاراکتر». کدهای محتوا پر از زیرخط‌اند
// (BOOK_02_AUDIO)، پس بدون escape این الگو چیزهای دیگری را هم می‌گیرد.
function likePrefix(s) {
  return String(s).replace(/[\\%_]/g, (c) => "\\" + c);
}

export async function getContent(env, contentId, { includeHidden = false } = {}) {
  // ستون hidden ممکن است در جدولِ از قبل ساخته‌شده نباشد؛ بدون این
  // فراخوانی، کوئری زیر با «no such column» می‌شکند تا وقتی که یک پست
  // تازه از کانال برسد.
  await ensureContentSchema(env).catch(() => {});
  try {
    const row = await env.DB
      .prepare(
        `SELECT content_id, title, file_id, file_type, COALESCE(hidden, 0) AS hidden
           FROM content_library
           WHERE content_id = ? AND active = 1
             ${includeHidden ? "" : "AND COALESCE(hidden, 0) = 0"}`
      )
      .bind(contentId)
      .first();
    return row || null;
  } catch (err) {
    emptyIfNoTable(err);
    return null;
  }
}

// تور ایمنی برای کدهایی که پیشوندِ چند فایل‌اند.
//
// دکمه‌های کتابخانه هر پارت را جدا می‌خواهند (BOOK_02_AUDIO_P01 و ...)،
// پس در حالت عادی تطبیق دقیق جواب می‌دهد و این مسیر اجرا نمی‌شود. ولی
// اگر روزی کدی بدون شماره درخواست شود، به‌جای «چیزی پیدا نشد» همه‌ی
// پارت‌هایش به‌ترتیب می‌روند.
export async function getContentParts(env, prefix, { includeHidden = false } = {}) {
  // ستون hidden ممکن است در جدولِ از قبل ساخته‌شده نباشد؛ بدون این
  // فراخوانی، کوئری زیر با «no such column» می‌شکند تا وقتی که یک پست
  // تازه از کانال برسد.
  await ensureContentSchema(env).catch(() => {});
  try {
    const { results } = await env.DB
      .prepare(
        `SELECT content_id, title, file_id, file_type FROM content_library
           WHERE content_id LIKE ? ESCAPE '\\' AND active = 1
             ${includeHidden ? "" : "AND COALESCE(hidden, 0) = 0"}
           ORDER BY content_id`
      )
      .bind(likePrefix(prefix) + "\\_%")
      .all();
    return results || [];
  } catch (err) {
    emptyIfNoTable(err);
    return [];
  }
}

// updated_at هم برمی‌گردد چون تنها معیار زمانیِ قابل‌اعتماد است: شناسه‌ها
// دو نسل دارند (نسل قدیم با timestamp ساخته می‌شد، نسل تازه با
// message_id) و مرتب‌سازی متنیِ این دو با هم بی‌معنی است.
export async function listContentByPrefix(env, prefix, { includeHidden = false } = {}) {
  // ستون hidden ممکن است در جدولِ از قبل ساخته‌شده نباشد؛ بدون این
  // فراخوانی، کوئری زیر با «no such column» می‌شکند تا وقتی که یک پست
  // تازه از کانال برسد.
  await ensureContentSchema(env).catch(() => {});
  try {
    const { results } = await env.DB
      .prepare(
        `SELECT content_id, title, file_id, file_type, updated_at,
                COALESCE(hidden, 0) AS hidden
           FROM content_library
           WHERE content_id LIKE ? ESCAPE '\\' AND active = 1
             ${includeHidden ? "" : "AND COALESCE(hidden, 0) = 0"}
           ORDER BY content_id`
      )
      .bind(likePrefix(prefix) + "%")
      .all();
    return results || [];
  } catch (err) {
    emptyIfNoTable(err);
    return [];
  }
}

// عنوان یک مدخل را عوض می‌کند بدون اینکه به فایلش دست بزند.
//
// همان عنوان هم روی دکمه‌ی فهرست می‌نشیند (خط اولش) و هم به‌عنوان کپشن
// کنار خود فایل می‌رود، پس یک ویرایش هر دو را درست می‌کند.
export async function updateContentTitle(env, contentId, title) {
  try {
    const res = await env.DB
      // updated_at عمداً دست‌نخورده می‌ماند: ترتیب فهرست روی همین ستون
      // است و اصلاح یک غلط املایی نباید یک ویس دوساله را ببرد بالای
      // فهرست به‌عنوان «تازه‌ترین».
      .prepare(
        `UPDATE content_library SET title = ?
           WHERE content_id = ? AND active = 1`
      )
      .bind(title, contentId)
      .run();
    return res.meta ? res.meta.changes || 0 : 0;
  } catch (err) {
    emptyIfNoTable(err);
    return 0;
  }
}

// جای‌گزینی خود فایل، با نگه داشتن عنوان و جایگاه مدخل.
//
// چرا لازم است: تا پیش از این تنها راهِ عوض کردن یک فایل اشتباه، حذف
// مدخل و پست دوباره در کانال بود - که یعنی شناسه‌ی تازه، ته فهرست، و
// از دست رفتن عنوانی که دستی نوشته شده بود.
//
// updated_at اینجا هم دست‌نخورده می‌ماند: این «همان مورد، فایل درست»
// است، نه یک انتشار تازه.
export async function updateContentFile(env, contentId, fileId, fileType) {
  try {
    const res = await env.DB
      .prepare(
        `UPDATE content_library SET file_id = ?, file_type = ?
           WHERE content_id = ? AND active = 1`
      )
      .bind(fileId, fileType, contentId)
      .run();
    return res.meta ? res.meta.changes || 0 : 0;
  } catch (err) {
    emptyIfNoTable(err);
    return 0;
  }
}

// ─── ویرایش متن بخش‌ها از داخل تلگرام ─────────────────────────────

// فقط متن. عکس همان‌جا می‌ماند - اگر پاک می‌شد، هر اصلاح یک غلط املایی
// عکس بخش را هم می‌برد.
export async function setSectionBody(env, code, body) {
  await ensureContentSchema(env);
  await env.DB
    .prepare(
      `INSERT INTO text_content (content_id, body, photo_file_id, active, updated_at)
       VALUES (?, ?, '', 1, ?)
       ON CONFLICT(content_id) DO UPDATE SET
         body = excluded.body, active = 1, updated_at = excluded.updated_at`
    )
    .bind(code, body, new Date().toISOString())
    .run();
}

// فقط عکس. رشته‌ی خالی یعنی «عکس را بردار».
export async function setSectionPhoto(env, code, fileId) {
  await ensureContentSchema(env);
  await env.DB
    .prepare(
      `INSERT INTO text_content (content_id, body, photo_file_id, active, updated_at)
       VALUES (?, '', ?, 1, ?)
       ON CONFLICT(content_id) DO UPDATE SET
         photo_file_id = excluded.photo_file_id, active = 1, updated_at = excluded.updated_at`
    )
    .bind(code, fileId || "", new Date().toISOString())
    .run();
}

// بازگشت به پیش‌فرض: سطر کاملاً پاک می‌شود، نه خالی.
//
// چرا حذف و نه خالی کردن: خالی یعنی «مدیر عمداً متن را خالی گذاشته» و
// نبودنِ سطر یعنی «هرگز دست نخورده». فقط حالت دوم باید به پیش‌فرض
// برگردد، وگرنه راهی برای برگشت نمی‌ماند.
export async function resetSection(env, code) {
  try {
    const res = await env.DB
      .prepare(`DELETE FROM text_content WHERE content_id = ?`)
      .bind(code)
      .run();
    return res.meta ? res.meta.changes || 0 : 0;
  } catch (err) {
    emptyIfNoTable(err);
    return 0;
  }
}

// «فعلاً نه» - مدخل می‌ماند و در فهرست مدیر دیده می‌شود، ولی از دید
// کاربر بیرون است. برای چیزی که هنوز آماده نیست یا موقتاً نباید برود.
export async function setContentHidden(env, contentId, hidden) {
  await ensureContentSchema(env);
  try {
    const res = await env.DB
      .prepare(`UPDATE content_library SET hidden = ? WHERE content_id = ? AND active = 1`)
      .bind(hidden ? 1 : 0, contentId)
      .run();
    return res.meta ? res.meta.changes || 0 : 0;
  } catch (err) {
    emptyIfNoTable(err);
    return 0;
  }
}

// چند نفر این مورد را گرفته‌اند و آخرین بار کِی.
//
// جدول content_requests از اول هر درخواست را ثبت می‌کرده ولی هیچ‌جا
// خوانده نمی‌شد. همین یک کوئری، «کدام ویس را کسی نمی‌خواهد» را از حدس
// به عدد تبدیل می‌کند.
export async function contentStats(env, contentId) {
  try {
    const row = await env.DB
      .prepare(
        `SELECT COUNT(*) AS total, COUNT(DISTINCT telegram_user_id) AS people,
                MAX(created_at) AS last_at
           FROM content_requests WHERE content_id = ?`
      )
      .bind(contentId)
      .first();
    return {
      total: (row && row.total) || 0,
      people: (row && row.people) || 0,
      lastAt: (row && row.last_at) || "",
    };
  } catch {
    // جدول هنوز ساخته نشده یعنی هیچ درخواستی ثبت نشده.
    return { total: 0, people: 0, lastAt: "" };
  }
}

// حذف نرم: سطر می‌ماند و فقط active صفر می‌شود.
//
// چرا پاک نمی‌شود: اگر آکادمی اشتباهی چیزی را حذف کند، با پست دوباره‌ی
// همان فایل (که upsert است و active را برمی‌گرداند) همه‌چیز سر جایش
// می‌آید. و log درخواست‌های قبلی هم به سطری اشاره می‌کند که هنوز هست.
export async function deactivateContent(env, contentId) {
  try {
    const res = await env.DB
      .prepare(`UPDATE content_library SET active = 0 WHERE content_id = ? AND active = 1`)
      .bind(contentId)
      .run();
    return res.meta ? res.meta.changes || 0 : 0;
  } catch (err) {
    emptyIfNoTable(err);
    return 0;
  }
}

// حذف بر اساس شماره‌ی پیام کانال، وقتی هشتگ اصلی از کپشن پاک شده.
// شناسه‌ی نسل تازه دقیقاً به همین شماره ختم می‌شود.
export async function deactivateContentBySuffix(env, suffix) {
  try {
    const res = await env.DB
      .prepare(
        `UPDATE content_library SET active = 0
           WHERE content_id LIKE ? ESCAPE '\\' AND active = 1`
      )
      .bind("%\\_" + likePrefix(suffix))
      .run();
    return res.meta ? res.meta.changes || 0 : 0;
  } catch (err) {
    emptyIfNoTable(err);
    return 0;
  }
}

export async function deactivateTextContent(env, contentId) {
  try {
    const res = await env.DB
      .prepare(`UPDATE text_content SET active = 0 WHERE content_id = ? AND active = 1`)
      .bind(contentId)
      .run();
    return res.meta ? res.meta.changes || 0 : 0;
  } catch (err) {
    emptyIfNoTable(err);
    return 0;
  }
}

export async function getTextContent(env, contentId) {
  try {
    const row = await env.DB
      .prepare(
        `SELECT content_id, body, photo_file_id FROM text_content
           WHERE content_id = ? AND active = 1`
      )
      .bind(contentId)
      .first();
    return row || null;
  } catch (err) {
    emptyIfNoTable(err);
    return null;
  }
}
