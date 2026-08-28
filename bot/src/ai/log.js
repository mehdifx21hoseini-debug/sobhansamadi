// دفترچه‌ی دستیار: چه پرسیدند، چه جواب گرفتند، و آیا به‌دردشان خورد.
//
// تا امروز هیچ‌جا ثبت نمی‌شد. یعنی اگر دستیار به ده سوالِ پرتکرار جواب
// اشتباه می‌داد یا مدام به پشتیبانی پاس می‌داد، تنها راه فهمیدنش این بود
// که کاربری شکایت کند - و کاربری که جواب بد می‌گیرد معمولاً شکایت
// نمی‌کند، فقط می‌رود.
//
// دو چیز اینجا ثبت می‌شود:
//
//   ۱ - هر پاسخ: سوال، جواب، اینکه به انسان ارجاع شد یا نه و چرا، و
//       کدام مدخل‌های پایگاه دانش پشتش بودند. سوالی که ارجاع می‌شود،
//       سوالی است که پایگاه دانش جوابش را ندارد - یعنی دقیقاً همان
//       چیزی که باید با /kbadd اضافه شود.
//
//   ۲ - رأی کاربر (👍/👎). این تنها سنجه‌ای است که از خودِ کاربر می‌آید،
//       نه از حدسِ ما.

const DDL = [
  `CREATE TABLE IF NOT EXISTS ai_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     telegram_user_id TEXT, question TEXT, answer TEXT,
     needs_human INTEGER DEFAULT 0, reason TEXT, intent TEXT,
     confidence REAL, matched_kb_ids TEXT,
     vote INTEGER, created_at TEXT)`,
  // گزارش‌ها همیشه «تازه‌ترین‌ها» و «رأی‌دارها» را می‌خواهند.
  `CREATE INDEX IF NOT EXISTS ai_log_created ON ai_log(created_at)`,
];

let schemaReady = false;

export async function ensureLogSchema(env) {
  if (schemaReady) return;
  await env.DB.batch(DDL.map((sql) => env.DB.prepare(sql)));
  schemaReady = true;
}

/**
 * یک پاسخ را ثبت می‌کند و شناسه‌اش را برمی‌گرداند.
 *
 * شکستش هرگز نباید به کاربر برسد: این یک دفترچه است، نه پاسخ. اگر ثبت
 * نشد، خروجی null است و دکمه‌های رأی نمایش داده نمی‌شوند - کاربر فقط
 * جوابش را می‌گیرد، بی‌آنکه چیزی خراب به نظر برسد.
 *
 * @returns {Promise<number|null>}
 */
export async function logAnswer(env, entry) {
  try {
    await ensureLogSchema(env);
    const res = await env.DB
      .prepare(
        `INSERT INTO ai_log
           (telegram_user_id, question, answer, needs_human, reason, intent,
            confidence, matched_kb_ids, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        String(entry.userId || ""),
        String(entry.question || "").slice(0, 2000),
        String(entry.answer || "").slice(0, 4000),
        entry.needsHuman ? 1 : 0,
        entry.reason || "",
        entry.intent || "",
        typeof entry.confidence === "number" ? entry.confidence : null,
        JSON.stringify(entry.matchedKbIds || []),
        new Date().toISOString()
      )
      .run();
    return res.meta ? res.meta.last_row_id : null;
  } catch (err) {
    console.error("ثبت پاسخ دستیار شکست خورد:", err && err.message);
    return null;
  }
}

/**
 * رأی کاربر روی یک پاسخ.
 *
 * فقط رأی خودِ همان کاربر پذیرفته می‌شود؛ شناسه‌ی پاسخ در callback_data
 * است و هرکسی می‌تواند عدد دیگری بفرستد. بدون این شرط، یک نفر می‌توانست
 * روی گفتگوی بقیه رأی بدهد و آمار را بی‌معنی کند.
 *
 * @returns {Promise<boolean>} آیا رأی ثبت شد.
 */
export async function recordVote(env, logId, userId, vote) {
  try {
    await ensureLogSchema(env);
    const res = await env.DB
      .prepare(`UPDATE ai_log SET vote = ? WHERE id = ? AND telegram_user_id = ?`)
      .bind(vote ? 1 : -1, Number(logId), String(userId))
      .run();
    return !!(res.meta && res.meta.changes > 0);
  } catch (err) {
    console.error("ثبت رأی شکست خورد:", err && err.message);
    return false;
  }
}

// دکمه‌های رأی.
//
// شناسه‌ی پاسخ در callback_data می‌آید چون تلگرام جای دیگری برای
// چسباندن داده به یک پیام ندارد. جعلش خطری ندارد: recordVote فقط رأیی
// را می‌پذیرد که کاربر روی پاسخِ خودش داده باشد.
export const VOTE_PREFIX = "AIV|";

export function voteRow(logId) {
  return [
    { text: "👍 مفید بود", callback_data: VOTE_PREFIX + logId + "|1" },
    { text: "👎 مفید نبود", callback_data: VOTE_PREFIX + logId + "|0" },
  ];
}

/**
 * صفحه‌کلید پاسخ دستیار: ردیف رأی، به‌علاوه هر ردیف دیگری که صداکننده
 * از قبل داشته. اگر ثبت نشده باشد (logId خالی)، فقط همان ردیف‌ها
 * می‌مانند - نه دکمه‌ی رأیی که به هیچ‌جا وصل نیست.
 */
export function answerKeyboard(logId, extraRows = []) {
  const rows = [...(logId ? [voteRow(logId)] : []), ...extraRows];
  return rows.length > 0 ? { inline_keyboard: rows } : undefined;
}

/**
 * گفتگوهای اخیر، برای صفحه‌ی CRM.
 *
 * فیلترها همان سه چیزی‌اند که آدم واقعاً دنبالشان می‌گردد: همه، آن‌هایی
 * که به پشتیبانی رفتند، و آن‌هایی که کاربر ردشان کرد.
 *
 * @param {{filter?:string, limit?:number, offset?:number, q?:string}} opts
 */
export async function listLog(env, opts = {}) {
  await ensureLogSchema(env);

  const where = [];
  const args = [];
  if (opts.filter === "escalated") where.push("needs_human = 1");
  else if (opts.filter === "down") where.push("vote = -1");
  else if (opts.filter === "up") where.push("vote = 1");
  if (opts.q) {
    where.push("(question LIKE ? ESCAPE '\\' OR answer LIKE ? ESCAPE '\\')");
    // \ و _ و % در متن سوال معنی خاص دارند و بدون فرار دادن، جستجوی
    // «۵۰٪» همه‌ی سطرها را برمی‌گرداند.
    const like = "%" + String(opts.q).replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    args.push(like, like);
  }

  const clause = where.length ? " WHERE " + where.join(" AND ") : "";
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const offset = Math.max(Number(opts.offset) || 0, 0);

  const total = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM ai_log${clause}`)
    .bind(...args)
    .first();

  const { results } = await env.DB
    .prepare(
      `SELECT id, telegram_user_id, question, answer, needs_human, reason,
              intent, confidence, matched_kb_ids, vote, created_at
         FROM ai_log${clause} ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .bind(...args, limit, offset)
    .all();

  return {
    total: (total && total.n) || 0,
    rows: (results || []).map((r) => ({
      ...r,
      needs_human: r.needs_human === 1,
      matched_kb_ids: JSON.parse(r.matched_kb_ids || "[]"),
    })),
  };
}

/**
 * خلاصه‌ی کارکرد دستیار در ۳۰ روز گذشته.
 *
 * @returns {Promise<{total, answered, escalated, up, down, reasons, unanswered, weak}>}
 */
export async function aiStats(env) {
  await ensureLogSchema(env);
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();

  const totals = await env.DB
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN needs_human = 1 THEN 1 ELSE 0 END) AS escalated,
              SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END) AS up,
              SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) AS down
         FROM ai_log WHERE created_at >= ?`
    )
    .bind(since)
    .first();

  const { results: reasons } = await env.DB
    .prepare(
      `SELECT reason, COUNT(*) AS n FROM ai_log
         WHERE created_at >= ? AND needs_human = 1 AND reason <> ''
         GROUP BY reason ORDER BY n DESC`
    )
    .bind(since)
    .all();

  // سوال‌هایی که جواب نگرفتند. این فهرست، فهرست کارهای /kbadd است.
  const { results: unanswered } = await env.DB
    .prepare(
      `SELECT question, COUNT(*) AS n FROM ai_log
         WHERE created_at >= ? AND needs_human = 1
         GROUP BY question ORDER BY n DESC, id DESC LIMIT 10`
    )
    .bind(since)
    .all();

  // سوال‌هایی که جواب گرفتند ولی کاربر 👎 زد - بدترین حالت، چون کاربر
  // فکر می‌کند جوابش را گرفته و جوابش غلط است.
  const { results: weak } = await env.DB
    .prepare(
      `SELECT question, answer FROM ai_log
         WHERE created_at >= ? AND vote = -1 ORDER BY id DESC LIMIT 10`
    )
    .bind(since)
    .all();

  const total = (totals && totals.total) || 0;
  const escalated = (totals && totals.escalated) || 0;
  return {
    total,
    escalated,
    answered: total - escalated,
    up: (totals && totals.up) || 0,
    down: (totals && totals.down) || 0,
    reasons: reasons || [],
    unanswered: unanswered || [],
    weak: weak || [],
  };
}
