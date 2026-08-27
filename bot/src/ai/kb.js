// آینه‌ی پایگاه دانش در D1.
//
// چرا آینه و نه خواندن مستقیم: پایگاه دانش را آکادمی از داخل CRM ویرایش
// می‌کند و جدولش در n8n است. اگر ورکر موقع هر سوال کاربر از n8n می‌خواند،
// پشتیبانی هوشمند دقیقاً به همان چیزی وابسته می‌ماند که مدام قطع می‌شود -
// همان اشتباهی که یک‌بار در تقویم تکرار شد. به‌جای آن، همان زمان‌بندی که
// تقویم را همگام می‌کند این را هم می‌کشد و پاسخ به کاربر از D1 خوانده
// می‌شود.

const DDL = [
  `CREATE TABLE IF NOT EXISTS ai_kb (
     id INTEGER PRIMARY KEY, category TEXT, question TEXT, answer TEXT,
     embedding TEXT, active INTEGER)`,
  // آمار استفاده عمداً جدول جداست: ai_kb در هر همگام‌سازی کامل جای‌گزین
  // می‌شود و اگر شمارنده داخلش بود، هر ده دقیقه صفر می‌شد.
  `CREATE TABLE IF NOT EXISTS ai_kb_usage (
     kb_id INTEGER PRIMARY KEY, usage_count INTEGER DEFAULT 0, last_used_at TEXT)`,
];

export async function ensureKbSchema(env) {
  await env.DB.batch(DDL.map((sql) => env.DB.prepare(sql)));
}

// پیش از اولین همگام‌سازی، جدول وجود ندارد. این خطا نیست - یعنی «هنوز
// پایگاه دانشی نداریم» - و باید همان‌طور خوانده شود تا پشتیبانی به مسیر
// انسانی برگردد، نه اینکه کاربر خطای داخلی بگیرد.
export async function readKb(env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, category, question, answer, embedding
         FROM ai_kb WHERE active = 1`
    ).all();
    return results || [];
  } catch (err) {
    if (err && /no such table/i.test(String(err.message))) return [];
    throw err;
  }
}

export async function replaceKb(env, entries) {
  const rows = (entries || []).filter((r) => r && r.id != null);
  const statements = [env.DB.prepare(`DELETE FROM ai_kb`)];
  for (const r of rows) {
    statements.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO ai_kb (id, category, question, answer, embedding, active)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        Number(r.id),
        r.category || null,
        r.question || null,
        r.answer || null,
        // embedding در مبدأ یک رشته‌ی JSON است. اگر آرایه آمد هم پذیرفته
        // می‌شود تا شکل دقیق خروجی export این‌جا را نشکند.
        typeof r.embedding === "string"
          ? r.embedding
          : Array.isArray(r.embedding)
            ? JSON.stringify(r.embedding)
            : null,
        r.active === false || r.active === 0 ? 0 : 1
      )
    );
  }
  await env.DB.batch(statements);
  return rows.length;
}

// کدام مدخل‌های پایگاه دانش واقعاً به کار آمدند. نسخه‌ی n8n این را روی
// خود ردیف می‌نوشت و صفحه‌ی «مدیریت هوش مصنوعی» در CRM از آن می‌خواند تا
// نشان دهد کدام جواب‌ها پرکاربردند و کدام‌ها هرگز استفاده نشده‌اند. اگر
// اینجا ثبت نشود، آن آمار برای همیشه از بین می‌رود؛ پس محلی نگه داشته
// می‌شود تا وقتی مسیر برگرداندنش به n8n ساخته شود.
//
// شکستش هرگز نباید جلوی پاسخ کاربر را بگیرد - این یک آمار است، نه پاسخ.
export async function recordKbUsage(env, kbIds) {
  // Number(null) برابر 0 است و از فیلترِ «عدد معتبر» رد می‌شود، پس شناسه
  // باید صریحاً مثبت هم باشد - وگرنه یک null به مدخل خیالیِ ۰ تبدیل می‌شد.
  const ids = [...new Set((kbIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return 0;
  const now = new Date().toISOString();
  await env.DB.batch(
    ids.map((id) =>
      env.DB.prepare(
        `INSERT INTO ai_kb_usage (kb_id, usage_count, last_used_at) VALUES (?, 1, ?)
           ON CONFLICT(kb_id) DO UPDATE SET
             usage_count = usage_count + 1,
             last_used_at = excluded.last_used_at`
      ).bind(id, now)
    )
  );
  return ids.length;
}

// --- رتبه‌بندی معنایی ---
//
// عیناً همان چیزی که نود Rank By Similarity انجام می‌داد، با همان دو عدد.
// اگر این‌ها عوض شوند، پاسخ‌ها با نسخه‌ی n8n فرق می‌کنند بدون اینکه کسی
// متوجه شود چرا.
const TOP_K = 15;
const MIN_SIMILARITY = 0.3;

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

// اگر بردار سوال ساخته نشده باشد (خطای سرویس embedding)، همه‌ی ردیف‌ها
// برمی‌گردند: پاسخ کمی عمومی‌تر می‌شود ولی پشتیبانی از کار نمی‌افتد.
export function rankBySimilarity(rows, queryVec) {
  if (!queryVec || !queryVec.length) return rows;

  const scored = [];
  for (const r of rows) {
    if (!r.embedding) continue;
    let vec;
    try {
      vec = JSON.parse(r.embedding);
    } catch {
      continue;
    }
    if (!Array.isArray(vec)) continue;
    scored.push({ row: r, score: cosineSim(queryVec, vec) });
  }
  scored.sort((a, b) => b.score - a.score);

  // اگر هیچ ردیفی به آستانه نرسید، بهترین‌ها فرستاده می‌شوند نه هیچ‌چیز -
  // تصمیمِ «این سوال جواب ندارد» با مدل است، نه با یک عدد آستانه.
  let selected = scored.filter((s) => s.score >= MIN_SIMILARITY).slice(0, TOP_K);
  if (selected.length === 0) selected = scored.slice(0, TOP_K);
  if (selected.length === 0) return rows;

  return selected.map((s) => s.row);
}
