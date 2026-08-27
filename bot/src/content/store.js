// کتابخانه‌ی محتوا در D1.
//
// فایل‌ها هرگز در جایی آپلود نمی‌شوند: آکادمی آن‌ها را در یک کانال خصوصی
// پست می‌کند و ربات که ادمین همان کانال است، file_id تلگرام را برمی‌دارد.
// همان file_id بعداً برای فرستادن به کاربر کافی است، بدون دانلود و آپلود
// دوباره. این همان کاری است که WF-13 می‌کرد.

const DDL = [
  `CREATE TABLE IF NOT EXISTS content_library (
     content_id TEXT PRIMARY KEY, title TEXT, file_id TEXT, file_type TEXT,
     active INTEGER DEFAULT 1, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS text_content (
     content_id TEXT PRIMARY KEY, body TEXT, photo_file_id TEXT,
     active INTEGER DEFAULT 1, updated_at TEXT)`,
];

export async function ensureContentSchema(env) {
  await env.DB.batch(DDL.map((sql) => env.DB.prepare(sql)));
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

export async function getContent(env, contentId) {
  try {
    const row = await env.DB
      .prepare(
        `SELECT content_id, title, file_id, file_type FROM content_library
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

// کتاب‌های صوتی چندپارتی: دکمه‌ی «نسخه صوتی» کتاب ۲ کد BOOK_02_AUDIO را
// می‌فرستد، ولی در کانال پنج پست جدا با کدهای BOOK_02_AUDIO_P01 تا P05
// هست. پس اگر تطبیق دقیق نبود، همه‌ی پارت‌ها به‌ترتیب برگردانده می‌شوند.
export async function getContentParts(env, prefix) {
  try {
    const { results } = await env.DB
      .prepare(
        `SELECT content_id, title, file_id, file_type FROM content_library
           WHERE content_id LIKE ? ESCAPE '\\' AND active = 1 ORDER BY content_id`
      )
      .bind(likePrefix(prefix) + "\\_%")
      .all();
    return results || [];
  } catch (err) {
    emptyIfNoTable(err);
    return [];
  }
}

export async function listContentByPrefix(env, prefix) {
  try {
    const { results } = await env.DB
      .prepare(
        `SELECT content_id, title, file_id, file_type FROM content_library
           WHERE content_id LIKE ? ESCAPE '\\' AND active = 1 ORDER BY content_id`
      )
      .bind(likePrefix(prefix) + "%")
      .all();
    return results || [];
  } catch (err) {
    emptyIfNoTable(err);
    return [];
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
