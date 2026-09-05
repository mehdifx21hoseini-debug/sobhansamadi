// خودآزمای CRM روی پروداکشن.
//
// چرا لازم است: تستِ محلی روی SQLite ثابت می‌کند منطق درست است، ولی
// نمی‌گوید همان کد روی ورکر، با همان D1 و همان داده‌ی منتقل‌شده، واقعاً
// کسی را وارد می‌کند. امروز دقیقاً همین فاصله - «کد را پوش کردم» به‌جای
// «اندپوینت روی پروداکشن جواب می‌دهد» - پنل را نیم‌ساعت خواباند.
//
// رمزِ هیچ کاربر واقعی‌ای لازم نیست: یک حساب موقت با رمز تصادفی ساخته
// می‌شود، با همان مسیرِ ورودِ واقعی وارد می‌شود، نشستش سنجیده می‌شود، و
// در پایان - چه تست پاس شود چه نه - حساب و نشستش پاک می‌شوند.

import { ensureCrmSchema, CRM_TABLES } from "./schema.js";
import { hashPassword, newSalt, login, requireSession } from "./auth.js";
import { listLeads, adminDashboard } from "./reads.js";

const TEST_USER = "__selftest__";

function randomPassword() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function cleanup(env) {
  await env.DB.prepare("DELETE FROM crm_session WHERE username = ?").bind(TEST_USER).run();
  await env.DB.prepare("DELETE FROM crm_admin WHERE username = ?").bind(TEST_USER).run();
}

/**
 * @returns {Promise<{ok:boolean, checks:Array<{name:string, pass:boolean, detail?:string}>, counts:object}>}
 */
export async function crmSelfTest(env) {
  await ensureCrmSchema(env);
  const checks = [];
  const add = (name, pass, detail) => checks.push(detail ? { name, pass, detail } : { name, pass });

  // شمارشِ ردیف‌های هر جدول. اگر انتقال ناقص مانده باشد، اینجا دیده
  // می‌شود - نه بعد از سوییچ، وقتی صفحه‌ای خالی بالا می‌آید.
  const counts = {};
  for (const t of CRM_TABLES) {
    try {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first();
      counts[t] = row ? row.n : null;
    } catch (err) {
      counts[t] = "خطا: " + String(err && err.message);
    }
  }

  // وضعیت‌های واقعیِ لیدها. رشته‌های وضعیت فارسی‌اند و در n8n هیچ‌جا
  // فهرست نشده بودند؛ برای اینکه ربات لیدِ تازه را با همان وضعیتی بنویسد
  // که پنل می‌شناسد، باید از خودِ داده پرسید نه از حافظه.
  try {
    const { results } = await env.DB
      .prepare("SELECT status, COUNT(*) AS n FROM crm_leads GROUP BY status ORDER BY n DESC")
      .all();
    counts.__status_breakdown = (results || []).map((r) => (r.status || "(خالی)") + ": " + r.n);
  } catch (err) {
    counts.__status_breakdown = "خطا: " + String(err && err.message);
  }

  // ستون‌های crm_leads.
  //
  // مهاجرت‌ها با ALTER جداگانه اجرا می‌شوند و خطای «ستون تکراری» بی‌صدا
  // بلعیده می‌شود - که یعنی یک مهاجرتِ شکست‌خورده هم بی‌صدا می‌ماند.
  // بدون این فهرست، تنها راهِ فهمیدنش این بود که کاربر ببیند چیزی ذخیره
  // نمی‌شود.
  try {
    const { results } = await env.DB.prepare("PRAGMA table_info(crm_leads)").all();
    counts.__lead_columns = (results || []).map((r) => r.name).sort();
  } catch (err) {
    counts.__lead_columns = "خطا: " + String(err && err.message);
  }

  // پیام همگانی: چند نفر مخاطب‌اند، و آخرین ارسال‌ها به چند نفر رسیدند.
  //
  // بدون این دو، وقتی کسی می‌گوید «پیام نرفت» هیچ راهی نیست بفهمیم ارسال
  // اصلاً شروع شده و وسطش قطع شده، یا از اول رد شده - و اندازه‌ی مخاطب
  // همان چیزی است که تعیین می‌کند ارسالِ یکجا در مهلتِ ورکر جا می‌شود یا
  // نه.
  try {
    const row = await env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM user_state
          WHERE telegram_user_id NOT IN (SELECT telegram_id FROM crm_admin_users)`
      )
      .first();
    counts.__broadcast_audience_all = row ? row.n : null;
    const econ = await env.DB.prepare("SELECT COUNT(*) AS n FROM econ_subscriber").first();
    counts.__broadcast_audience_econ = econ ? econ.n : null;
    const { results } = await env.DB
      .prepare(
        `SELECT batch_id, audience, sent_count, created_at,
                (SELECT COUNT(*) FROM crm_broadcast_recipients r WHERE r.batch_id = b.batch_id) AS stored
           FROM crm_broadcasts b ORDER BY created_at DESC LIMIT 5`
      )
      .all();
    counts.__last_broadcasts = (results || []).map(
      (r) => r.created_at + " | " + r.audience + " | ثبت‌شده: " + r.sent_count + " | گیرنده: " + r.stored
    );
  } catch (err) {
    counts.__last_broadcasts = "خطا: " + String(err && err.message);
  }

  // فایل‌های ثابتی که از کانال می‌آیند و مسیرِ ثبت‌نام به آن‌ها تکیه
  // می‌کند. نبودنشان خطا نمی‌دهد - مسیر بی‌صدا بدونشان ادامه پیدا
  // می‌کند - پس تنها راهِ فهمیدنش یا یک ثبت‌نامِ تستی است یا همین خط.
  try {
    const ids = ["LEAD_DONE_ANIM", "COURSE_TECH_VOICE", "COURSE_PSY_VOICE", "INTRO_P16"];
    const { results } = await env.DB
      .prepare(
        `SELECT content_id, file_type FROM content_library
           WHERE content_id IN (` + ids.map(() => "?").join(", ") + `) AND active = 1`
      )
      .bind(...ids)
      .all();
    const found = new Map((results || []).map((r) => [r.content_id, r.file_type]));
    counts.__channel_files = ids.map(
      (id) => id + ": " + (found.has(id) ? found.get(id) : "— هنوز در کانال گذاشته نشده")
    );
  } catch (err) {
    counts.__channel_files = "خطا: " + String(err && err.message);
  }

  try {
    await cleanup(env); // بازمانده‌ی اجرای قبلی، اگر وسط کار قطع شده بود
    const password = randomPassword();
    const salt = newSalt();
    const hash = await hashPassword(password, salt);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO crm_admin (username, display_name, role, active, password_hash, password_salt, created_at, updated_at)
       VALUES (?, ?, 'admin', 1, ?, ?, ?, ?)`
    ).bind(TEST_USER, "خودآزما", hash, salt, now, now).run();

    const bad = await login(env, TEST_USER, password + "x");
    add("رمز غلط رد می‌شود", bad.ok === false);

    const good = await login(env, TEST_USER, password);
    add("ورود با رمز درست", good.ok === true);

    if (good.ok) {
      const req = new Request("https://x/crm/leads", {
        headers: { Authorization: "Bearer " + good.session.token },
      });
      const sess = await requireSession(env, req);
      add("نشست معتبر است", !!sess && sess.username === TEST_USER);

      const bogus = new Request("https://x/crm/leads", { headers: { Authorization: "Bearer nope" } });
      add("توکن جعلی رد می‌شود", (await requireSession(env, bogus)) === null);

      // حساب غیرفعال نباید نشستِ زنده هم داشته باشد.
      await env.DB.prepare("UPDATE crm_admin SET active = 0 WHERE username = ?").bind(TEST_USER).run();
      add("حسابِ غیرفعال بیرون می‌افتد", (await requireSession(env, req)) === null);
    }

    // دو خواندنِ واقعی، با همان توابعی که پنل صدا می‌زند.
    const leads = await listLeads(env);
    add("فهرست لیدها خوانده می‌شود", Array.isArray(leads) && leads.length > 0, "تعداد: " + (leads || []).length);

    const dash = await adminDashboard(env, "ALL");
    add("داشبورد محاسبه می‌شود", !!dash && typeof dash === "object");
  } catch (err) {
    add("اجرای خودآزما", false, String((err && err.stack) || err));
  } finally {
    await cleanup(env);
  }

  return { ok: checks.every((c) => c.pass), checks, counts };
}
