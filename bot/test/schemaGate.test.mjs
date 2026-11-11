// طرحِ جدول‌ها یک بار ساخته می‌شود، نه در هر درخواست (src/schemaGate.js).
//
// ─── چه چیزی را می‌سنجد ─────────────────────────────────────────
//
//   ۱. ساختِ کامل چند تکه است و هیچ تکه‌ای از ۵۰ کوئری (سقفِ پلنِ رایگان
//      در هر اجرا) رد نمی‌شود.
//   ۲. بعد از ساختِ کامل، ایزوله‌ی تازه برای همه‌ی ensureها روی هم فقط
//      یک کوئری می‌زند - همان خواندنِ نسخه.
//   ۳. DDLِ تازه نسخه را عوض می‌کند و ensure دوباره می‌سازد - بی‌آنکه کسی
//      عددی را دستی بالا ببرد.

import { DatabaseSync } from "node:sqlite";

let n = 0;
const ok = (c, m, x) => {
  if (!c) { console.log("❌ " + m + (x !== undefined ? " → " + JSON.stringify(x) : "")); process.exitCode = 1; }
  else { console.log("✅ " + m); n++; }
};

// D1ِ ساختگی روی یک SQLiteِ مشترک؛ هر «ایزوله» یک پوسته‌ی تازه روی همان
// دیتابیس است (حافظه‌ی schemaGate به ازای خودِ env.DB است).
const raw = new DatabaseSync(":memory:");
raw.exec(`CREATE TABLE user_state (telegram_user_id TEXT PRIMARY KEY, last_interaction_at TEXT)`);
function isolate() {
  const log = [];
  const prepare = (sql) => {
    const st = { _a: [], sql };
    st.bind = (...a) => { st._a = a; return st; };
    st.run = async () => { log.push(sql); const r = raw.prepare(sql).run(...st._a); return { meta: { changes: Number(r.changes) } }; };
    st.first = async () => { log.push(sql); return raw.prepare(sql).get(...st._a) || null; };
    st.all = async () => { log.push(sql); return { results: raw.prepare(sql).all(...st._a) }; };
    st._run = () => raw.prepare(sql).run(...st._a);
    return st;
  };
  return {
    log,
    DB: {
      prepare,
      async batch(list) {
        log.push("BATCH");
        raw.exec("BEGIN");
        try { const out = list.map((s) => ({ meta: { changes: Number(s._run().changes) } })); raw.exec("COMMIT"); return out; }
        catch (e) { raw.exec("ROLLBACK"); throw e; }
      },
    },
  };
}

// همه‌ی ماژول‌ها، همان‌طور که در ورکر بارگذاری می‌شوند.
await import("../src/worker.js");
const gate = await import("../src/schemaGate.js");
const { ensureSubscriberSchema } = await import("../src/econ/subscribers.js");
const { ensureCrmSchema } = await import("../src/crm/schema.js");
const { ensureSentSchema } = await import("../src/econ/sender.js");
const { ensureConfig } = await import("../src/content/channel.js");

// ─── ۱) ساختِ کامل، تکه‌تکه ─────────────────────────────────────
{
  let res = null;
  let rounds = 0;
  let maxQ = 0;
  for (; rounds < 10; rounds++) {
    const env = isolate();
    res = await gate.ensureAllSchemas(env);
    maxQ = Math.max(maxQ, env.log.length);
    if (res.built || res.current) break;
  }
  ok(res && res.built === gate.registeredSchemas().length, "همه‌ی طرح‌ها ساخته شدند", res);
  ok(maxQ <= 40, "هیچ تکه‌ای بیش از ۴۰ کوئری نزد (سقفِ رایگان ۵۰)", maxQ);
  ok(rounds >= 1, "ساخت بیش از یک تکه طول کشید - پیشرفت در bot_config ماند", rounds + 1);
  const cols = raw.prepare("PRAGMA table_info(user_state)").all().map((c) => c.name);
  ok(cols.includes("blocked_at") && cols.includes("sent_digest"), "ستون‌های افزوده هم ساخته شدند", cols);
}

// ─── ۲) ایزوله‌ی تازه: فقط یک خواندن ──────────────────────────────
{
  const env = isolate();
  await ensureSubscriberSchema(env);
  await ensureCrmSchema(env);
  await ensureSentSchema(env);
  await ensureConfig(env);
  await ensureSubscriberSchema(env);
  ok(env.log.length === 1 && /bot_config/.test(env.log[0]), "چهار ensure در ایزوله‌ی تازه = یک کوئری", env.log);
  const again = await gate.ensureAllSchemas(env);
  ok(again.current === true && env.log.length === 1, "کرانِ ده‌دقیقه‌ای هم کاری نمی‌کند", env.log.length);
}

// ─── ۳) DDLِ تازه → نسخه‌ی تازه → ساختِ دوباره ──────────────────────
{
  const before = gate.schemaVersion();
  const ensureX = gate.defineSchema("test_x", "CREATE TABLE IF NOT EXISTS t_x (a TEXT)", async (env) => {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS t_x (a TEXT)").run();
  });
  ok(gate.schemaVersion() !== before, "یک طرحِ تازه نسخه را عوض کرد");
  const env = isolate();
  await ensureX(env);
  const t = raw.prepare("SELECT name FROM sqlite_master WHERE name = 't_x'").get();
  ok(!!t, "و ensureِ آن روی ایزوله‌ی تازه واقعاً ساخت (نسخه‌ی ثبت‌شده کهنه بود)");
  await ensureSubscriberSchema(env);
  ok(env.log.some((q) => /econ_subscriber/.test(q)), "بقیه هم تا ساختِ دوباره DDLِ خودشان را اجرا می‌کنند");
}

console.log("\n" + n + " ادعا");
