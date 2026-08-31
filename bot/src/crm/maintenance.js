// کارهای نگهداریِ دستی روی جدول‌های CRM.
//
// فقط با کلید مدیر صدا زده می‌شوند و در جریان عادیِ پنل هیچ‌جا استفاده
// نمی‌شوند. دلیل وجودشان این است که بعد از انتقال، چند ردیفِ آزمایشی در
// داده‌ی واقعی مانده و پاک کردنشان از بیرون هیچ راهی نداشت.
//
// ─── چرا حذف، سه مرحله‌ای است ────────────────────────────────────────
// حذف برگشت‌ناپذیر است و یک شناسه‌ی اشتباه یعنی یک مشتری واقعیِ از دست
// رفته. پس: اول فهرست گرفته می‌شود، بعد همان شناسه‌ها صریح فرستاده
// می‌شوند، و پاسخ می‌گوید دقیقاً چه چیزی رفت. هیچ حذفِ الگویی («هرچه
// اسمش تست است») در کار نیست - الگو روی داده‌ی واقعی هم می‌افتد.

/** آخرین لیدها، برای اینکه پیش از حذف معلوم باشد چه چیزی هست. */
export async function recentLeads(env, limit = 15) {
  const { results } = await env.DB
    .prepare(
      `SELECT lead_id, full_name, phone, telegram_user_id, request_type, status, source, created_at
         FROM crm_leads ORDER BY created_at DESC LIMIT ?`
    )
    .bind(Math.min(Number(limit) || 15, 100))
    .all();
  return results || [];
}

/**
 * حذفِ لیدهایی که شناسه‌شان صریح داده شده.
 *
 * ردیف‌های تایم‌لاین و تماس‌های همان لید هم می‌روند: لیدی که نیست،
 * تاریخچه‌اش هم نباید در داشبورد شمرده شود.
 *
 * @param {string[]} ids
 * @param {boolean} dry فقط بگو چه چیزی حذف می‌شود، حذف نکن.
 */
export async function deleteLeads(env, ids, dry = true) {
  const wanted = [...new Set((ids || []).map((s) => String(s || "").trim()).filter(Boolean))];
  if (wanted.length === 0) return { ok: false, error: "هیچ شناسه‌ای داده نشد" };
  // سقف عمدی: این مسیر برای پاک کردنِ چند ردیفِ آزمایشی است، نه برای
  // خالی کردن جدول. اگر روزی لازم شد، باید تصمیمِ آگاهانه‌ای باشد.
  if (wanted.length > 20) return { ok: false, error: "بیش از ۲۰ شناسه در یک درخواست پذیرفته نمی‌شود" };

  const marks = wanted.map(() => "?").join(", ");
  const { results } = await env.DB
    .prepare(`SELECT lead_id, full_name, phone, created_at FROM crm_leads WHERE lead_id IN (${marks})`)
    .bind(...wanted)
    .all();

  const found = results || [];
  const missing = wanted.filter((id) => !found.some((r) => r.lead_id === id));

  if (dry) return { ok: true, dry: true, would_delete: found, missing };
  if (found.length === 0) return { ok: false, error: "هیچ‌کدام از شناسه‌ها پیدا نشد", missing };

  const hit = found.map((r) => r.lead_id);
  const hitMarks = hit.map(() => "?").join(", ");
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM crm_activity_log WHERE lead_id IN (${hitMarks})`).bind(...hit),
    env.DB.prepare(`DELETE FROM crm_calls WHERE lead_id IN (${hitMarks})`).bind(...hit),
    env.DB.prepare(`DELETE FROM crm_leads WHERE lead_id IN (${hitMarks})`).bind(...hit),
  ]);

  return { ok: true, deleted: found, missing };
}
