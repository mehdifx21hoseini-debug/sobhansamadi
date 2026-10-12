// «عکسِ فهرستِ مخاطب» - روی SQLiteِ واقعی.
//
// ─── چه چیزی را می‌سنجد ─────────────────────────────────────────
//
// ۱۲ اکتبر ۵٫۰۵ میلیون خواندنِ D1 و ربات برای همه ساکت شد؛ بیشترش
// کوئریِ مخاطب بود که هر دور تا ۱۶ هزار ردیف را رد می‌کرد. این تست سه
// چیز را ثابت می‌کند:
//
//   ۱. هزینه: بعد از ساختِ عکس، هیچ دوری به user_state دست نمی‌زند.
//   ۲. درستی: همان آدم‌ها، همان تقسیمِ شارد، هیچ‌کس دو بار، هیچ‌کس جا
//      نمی‌ماند - از جمله کسی که بعد از ساختِ عکس عضو شده.
//   ۳. ایمنی: عکسِ کهنه هرگز پیامِ تکراری نمی‌سازد، چون «گرفته یا نه»
//      هنوز با claimِ هر نفر تعیین می‌شود نه با عکس.

import { runDailyDigest, drainDailyDigest, digestRef, resetSnapshotMemo, ensureSentSchema } from "../src/econ/sender.js";
import { writeConfig, readConfig } from "../src/content/channel.js";

let n = 0;
const ok = (c, m, x) => {
  if (!c) { console.log("❌ " + m + (x !== undefined ? " → " + JSON.stringify(x) : "")); process.exitCode = 1; }
  else { console.log("✅ " + m); n++; }
};

const { DatabaseSync } = await import("node:sqlite");
function d1() {
  const db = new DatabaseSync(":memory:");
  const log = [];
  const api = {
    raw: db, log,
    prepare(sql) {
      const st = { _a: [] };
      st.bind = (...a) => { st._a = a; return st; };
      st.run = async () => { log.push(sql); const r = db.prepare(sql).run(...st._a); return { meta: { changes: Number(r.changes) } }; };
      st.first = async () => { log.push(sql); return db.prepare(sql).get(...st._a) || null; };
      st.all = async () => { log.push(sql); return { results: db.prepare(sql).all(...st._a) }; };
      return st;
    },
    async batch(stmts) {
      db.exec("BEGIN");
      try { for (const s of stmts) await s.run(); db.exec("COMMIT"); }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
  return api;
}

// تلگرام ساختگی: هر sendMessage / sendRichMessage را ثبت می‌کند.
const sent = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  sent.push(String(body.chat_id));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
};

// وقتِ مجاز: یک روزِ کاری ساعت ۸ صبحِ تهران (۰۴:۳۰ UTC).
const NOW = new Date("2026-10-13T04:30:00.000Z");
const REF = digestRef(NOW);

async function setup(count, extra = {}) {
  resetSnapshotMemo();
  const DB = d1();
  DB.raw.exec(`CREATE TABLE user_state (
    telegram_user_id TEXT PRIMARY KEY, current_flow TEXT, current_step TEXT, temp_data TEXT, phone TEXT,
    intro_progress INTEGER DEFAULT 0, source_first_seen TEXT, last_interaction_at TEXT, blocked_at TEXT)`);
  const env = { DB, BOT_TOKEN: "TEST", ...extra };
  // طرح‌های خودِ برنامه: ستون‌های sent_* و جدول‌های ارسال.
  await writeConfig(env, "econ_worker_sender", "on");
  const { ensureSubscriberSchema } = await import("../src/econ/subscribers.js");
  await ensureSubscriberSchema(env);
  await ensureSentSchema(env);
  const ins = DB.raw.prepare("INSERT INTO user_state (telegram_user_id) VALUES (?)");
  for (let i = 0; i < count; i++) ins.run(String(100000 + i * 7));
  return env;
}
const touchesUserState = (env, from) => env.DB.log.slice(from).filter((q) => /FROM\s+user_state/i.test(q));

// ─── ۱) درستی با شارد ────────────────────────────────────────────
{
  const env = await setup(600);
  sent.length = 0;
  const seen = new Set();
  let dup = 0;
  const SHARDS = 6;
  let rounds = 0;
  // درِینِ موازیِ شبیه‌سازی‌شده: هر شارد تا تمام‌شدن دور می‌زند.
  for (let s = 0; s < SHARDS; s++) {
    for (let i = 0; i < 40; i++) {
      rounds++;
      const before = sent.length;
      const r = await runDailyDigest(env, NOW, { of: SHARDS, index: s });
      for (const id of sent.slice(before)) { if (seen.has(id)) dup++; seen.add(id); }
      if (r.done === true || r.throttled === true && r.sent === 0) break;
    }
  }
  const expected = 600;
  ok(seen.size === expected && dup === 0, "همه‌ی ۶۰۰ نفر دقیقاً یک بار پیام می‌گیرند (شش شارد)", { got: seen.size, dup });
}

// ─── ۲) هزینه: بعد از ساختِ عکس، به user_state دست نمی‌زند ─────────
{
  const env = await setup(600);
  sent.length = 0;
  await runDailyDigest(env, NOW, { of: 6, index: 0 }); // دورِ اول: عکس ساخته می‌شود
  const afterBuild = env.DB.log.length;
  for (let i = 0; i < 5; i++) await runDailyDigest(env, NOW, { of: 6, index: 0 });
  ok(touchesUserState(env, afterBuild).length === 0, "دورهای بعد هیچ کوئریِ user_state ندارند - فقط ردیفِ عکس و نشانگر");
  const raw = await readConfig(env, "econ_aud_digest_" + REF);
  ok(raw && JSON.parse(raw).ids.split(",").length === 600, "عکس یک ردیف است و ۶۰۰ آیدی دارد");
}

// ─── ۳) عکسِ کهنه پیامِ تکراری نمی‌سازد ─────────────────────────────
{
  const env = await setup(100);
  sent.length = 0;
  await runDailyDigest(env, NOW, null); // بی‌شارد: عکس + ۴۵ نفرِ اول
  const firstBatch = new Set(sent);
  // نشانگر را عقب می‌بریم، انگار ورکر وسطِ کار مرده: همان ۴۵ نفر دوباره کاندید می‌شوند.
  await writeConfig(env, "econ_cur_digest_" + REF + "_all", "");
  sent.length = 0;
  await runDailyDigest(env, NOW, null);
  const again = sent.filter((id) => firstBatch.has(id));
  ok(again.length === 0, "کاندیدِ دوباره‌ی کسی که گرفته، claim می‌شود و پیامش دوباره نمی‌رود", again.length);
}

// ─── ۴) تازه‌وارد بعد از ساختِ عکس ─────────────────────────────────
{
  const env = await setup(60);
  sent.length = 0;
  for (let i = 0; i < 6; i++) await runDailyDigest(env, NOW, null);
  ok(new Set(sent).size === 60, "کلِ ۶۰ نفر گرفتند");
  // تازه‌وارد با آیدیِ کوچک‌تر از نشانگر
  env.DB.raw.prepare("INSERT INTO user_state (telegram_user_id) VALUES ('1')").run();
  sent.length = 0;
  const soon = new Date(NOW.getTime() + 10 * 60 * 1000);
  const r1 = await runDailyDigest(env, soon, null);
  ok(sent.length === 0 && r1.throttled === true, "تا پیش از یک ساعت، عکس تازه می‌ماند و کاری نیست (بدونِ اسکنِ جدول)");
  const later = new Date(NOW.getTime() + 61 * 60 * 1000);
  const r2 = await runDailyDigest(env, later, null);
  ok(sent.length === 1 && sent[0] === "1", "بعد از یک ساعت عکس دوباره ساخته می‌شود و تازه‌وارد پیام می‌گیرد", { sent: sent.slice(), r2 });
}

// ─── ۵) بلاک‌شده و خاموش‌کرده از عکس بیرونند ─────────────────────
{
  const env = await setup(30);
  env.DB.raw.prepare("UPDATE user_state SET blocked_at = '2026-10-01' WHERE telegram_user_id = '100000'").run();
  env.DB.raw.prepare("INSERT OR REPLACE INTO econ_subscriber (telegram_user_id, chat_id, subscribed, digest_off, created_at, updated_at) VALUES ('100007', '100007', 1, 1, 'x', 'x')").run();
  sent.length = 0;
  for (let i = 0; i < 4; i++) await runDailyDigest(env, NOW, null);
  ok(!sent.includes("100000") && !sent.includes("100007") && sent.length === 28, "بلاک‌شده و «دیگر نفرست» پیام نمی‌گیرند", sent.length);
}

// ─── ۶) کلیدِ برگشت ─────────────────────────────────────────────
{
  const env = await setup(50);
  await writeConfig(env, "econ_audience_snapshot", "off");
  sent.length = 0;
  for (let i = 0; i < 4; i++) await runDailyDigest(env, NOW, null);
  ok(new Set(sent).size === 50, "با کلیدِ off همان مسیرِ قدیمی کار می‌کند و همه می‌گیرند");
  ok(!(await readConfig(env, "econ_aud_digest_" + REF)), "و هیچ عکسی ساخته نمی‌شود");
}

// ─── ۷) پاک‌سازیِ عکسِ روزهای پیش ─────────────────────────────────
{
  const env = await setup(10);
  await writeConfig(env, "econ_aud_digest_2026-10-01", JSON.stringify({ t: 1, ids: "1,2" }));
  await writeConfig(env, "econ_aud_greet_2026-10-05", JSON.stringify({ t: 1, ids: "1,2" }));
  await runDailyDigest(env, NOW, null);
  ok(!(await readConfig(env, "econ_aud_digest_2026-10-01")), "عکسِ خلاصه‌ی روزهای پیش پاک می‌شود");
  ok(!!(await readConfig(env, "econ_aud_greet_2026-10-05")), "ولی عکسِ نوعِ دیگر دست نمی‌خورد");
}

// ─── ۸) دروازه‌ی ساعتی همچنان کار می‌کند ──────────────────────────
{
  const env = await setup(10);
  const early = new Date("2026-10-13T02:00:00.000Z"); // ۰۵:۳۰ تهران
  const r = await drainDailyDigest(env, early, null);
  ok(r && r.skipped, "پیش از ۷:۳۰ هیچ‌چیز ارسال یا ساخته نمی‌شود", r);
  ok(!(await readConfig(env, "econ_aud_digest_" + REF)), "و عکس هم ساخته نمی‌شود");
}

// ─── ۹) همان مخاطبِ listPendingAudience ─────────────────────────────
{
  const { listPendingAudience, listPendingAudienceIds } = await import("../src/econ/subscribers.js");
  const env = await setup(300);
  env.DB.raw.prepare("UPDATE user_state SET blocked_at = 'x' WHERE CAST(telegram_user_id AS INTEGER) % 11 = 0").run();
  env.DB.raw.prepare("UPDATE user_state SET sent_digest = ? WHERE CAST(telegram_user_id AS INTEGER) % 13 = 0").run(REF);
  env.DB.raw.prepare("INSERT INTO econ_subscriber (telegram_user_id, chat_id, subscribed, digest_off, created_at, updated_at) SELECT telegram_user_id, telegram_user_id, 1, 1, 'x', 'x' FROM user_state WHERE CAST(telegram_user_id AS INTEGER) % 17 = 0").run();
  for (const kind of ["digest", "greet"]) {
    const a = (await listPendingAudience(env, kind, REF, 100000, null, null)).map((r) => r.telegram_user_id);
    const b = await listPendingAudienceIds(env, kind, REF);
    ok(a.length > 100 && JSON.stringify(a) === JSON.stringify(b), "فهرستِ " + kind + ": group_concat دقیقاً همان آدم‌ها و همان ترتیبِ کوئریِ قدیمی است", { a: a.length, b: b.length });
  }
  // روزِ پیش از جابه‌جایی (مسیرِ دفترِ قدیمی)
  const old = "2026-09-01";
  env.DB.raw.prepare("INSERT INTO econ_sent_log (kind, ref, telegram_user_id, sent_at) SELECT 'digest', ?, telegram_user_id, 'x' FROM user_state WHERE CAST(telegram_user_id AS INTEGER) % 5 = 0").run(old);
  const a2 = (await listPendingAudience(env, "digest", old, 100000, null, null)).map((r) => r.telegram_user_id);
  const b2 = await listPendingAudienceIds(env, "digest", old);
  ok(JSON.stringify(a2) === JSON.stringify(b2), "و برای روزهای قدیمی (دفترِ ارسال) هم یکی است", { a: a2.length, b: b2.length });
}

console.log("\n" + n + " ادعا");
