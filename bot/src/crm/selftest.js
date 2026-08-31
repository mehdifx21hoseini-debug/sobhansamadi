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
