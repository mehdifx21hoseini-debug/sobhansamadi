// جای‌گزینی پایگاه دانش اکسپرت با SSProX V2.1 - روی SQLiteِ واقعی.
//
// می‌سنجد:
//   • مدخل‌های قدیمیِ اکسپرت/SSProX خاموش می‌شوند (نه حذف)، و هیچ مدخلِ
//     بی‌ربطی (متاتریدر، بروکر، ...) خاموش نمی‌شود.
//   • ۱۶۴ مدخلِ تازه فعال و در ai_kb هستند؛ مدخل‌های «تیم پشتیبانی» نه.
//   • همگام‌سازیِ خودکار: یک بار، فقط وقتی نسخه فرق دارد.

import { syncAndRebuild, autoSyncIfSeedChanged, currentSeedVersion, RETIRED_SEED_CATEGORIES } from "../src/ai/source.js";
import { SSPROX } from "../src/ai/ssproxKb.js";
import { SEED } from "../src/ai/seed.js";
import { readConfig } from "../src/content/channel.js";

let n = 0;
const ok = (c, m, x) => {
  if (!c) { console.log("❌ " + m + (x !== undefined ? " → " + JSON.stringify(x) : "")); process.exitCode = 1; }
  else { console.log("✅ " + m); n++; }
};

const { DatabaseSync } = await import("node:sqlite");
function d1() {
  const db = new DatabaseSync(":memory:");
  return {
    raw: db,
    prepare(sql) {
      const st = { _a: [] };
      st.bind = (...a) => { st._a = a; return st; };
      st.run = async () => { const r = db.prepare(sql).run(...st._a); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
      st.first = async () => db.prepare(sql).get(...st._a) || null;
      st.all = async () => ({ results: db.prepare(sql).all(...st._a) });
      return st;
    },
    async batch(stmts) {
      db.exec("BEGIN");
      try { for (const s of stmts) await s.run(); db.exec("COMMIT"); }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
}

const EXPERT_OLD = SEED.filter((e) => RETIRED_SEED_CATEGORIES.includes(e.category)).length;
const NON_EXPERT = SEED.length - EXPERT_OLD;

// ─── ۱) داده‌ی تازه ─────────────────────────────────────────────
ok(SSPROX.length === 164 && new Set(SSPROX.map((e) => e.id)).size === 164, "۱۶۴ مدخلِ یکتا از فایلِ V2.1");
ok(!SSPROX.some((e) => /STAFF/.test(e.id)), "هیچ مدخلِ «تیم پشتیبانی» وارد نشده");
ok(!SSPROX.some((e) => /ساختن فایل نهایی|کامپایل درست|نکته‌ی هر انتشار|اطلاعاتی که برای بررسی مشکل کاربر|Maximum Optimization|بدون اینکه کاربر چیزی را آپدیت/.test(e.answer + e.question)), "و هیچ جمله‌ی داخلیِ تیم (کامپایل، گزارش مشکل، انتشار) در مدخل‌ها نیست");
ok(SSPROX.some((e) => /SSProX/i.test(e.question)) && SSPROX.some((e) => /اس اس پرو ایکس/.test(e.question)), "اسم‌های مختلفِ اکسپرت در سوالِ مدخل‌ها هست (ssprox و اس اس پرو ایکس)");
ok(EXPERT_OLD === 96 && NON_EXPERT === 127, "seed قدیمی: ۹۶ مدخلِ اکسپرت/SSProX و ۱۲۷ مدخلِ دیگر", { EXPERT_OLD, NON_EXPERT });

// ─── ۲) همگام‌سازی، بدونِ کلیدِ Gemini (بردارها بعداً) ───────────────
const DB = d1();
const env = { DB };
// وضعیتِ پروداکشن را شبیه می‌کنیم: مدخل‌های قدیمیِ seed، یک مدخلِ دستیِ
// «اکسپرت» و یک مدخلِ دستیِ بی‌ربط.
await syncAndRebuild(env); // نسخه‌ی جدید
DB.raw.exec(`INSERT INTO kb_source (origin, category, question, answer, active, pinned, updated_at) VALUES
  ('seed:oldexpert1','اکسپرت','قدیمی ۱','قدیمی',1,0,'x'),
  ('seed:oldexpert2','SSProX','قدیمی ۲','قدیمی',1,0,'x'),
  ('manual:a','اکسپرت','دستیِ اکسپرت','قدیمی',1,1,'x'),
  ('manual:b','عمومی','دستیِ عمومی','می‌ماند',1,1,'x')`);
await syncAndRebuild(env);
const active = DB.raw.prepare("SELECT origin, category FROM kb_source WHERE active = 1").all();
ok(!active.some((r) => r.origin === "seed:oldexpert1" || r.origin === "seed:oldexpert2" || r.origin === "manual:a"), "مدخل‌های قدیمیِ اکسپرت/SSProX (seed و دستی) خاموش شدند");
ok(active.some((r) => r.origin === "manual:b"), "مدخلِ دستیِ بی‌ربط می‌ماند");
ok(active.filter((r) => r.origin.startsWith("seed:ssprox:")).length === 164, "۱۶۴ مدخلِ تازه فعال‌اند");
ok(active.filter((r) => r.category === "متاتریدر").length === 38 && active.filter((r) => r.category === "بروکر").length === 12, "دسته‌های متاتریدر (۳۸) و بروکر (۱۲) دست‌نخورده");
const still = DB.raw.prepare("SELECT COUNT(*) AS n FROM kb_source WHERE origin IN ('seed:oldexpert1','seed:oldexpert2','manual:a')").get().n;
ok(still === 3, "ردیف‌های قدیمی حذف نشده‌اند، فقط خاموش‌اند (برگشت‌پذیر)");
const kb = DB.raw.prepare("SELECT category, COUNT(*) AS n FROM ai_kb GROUP BY category").all();
ok(kb.find((r) => r.category === "SSProX").n === 164 && !kb.some((r) => r.category === "اکسپرت"), "ai_kb (آنچه دستیار می‌بیند) فقط ۱۶۴ مدخلِ SSProX دارد و «اکسپرت» ندارد", kb);

// ─── ۳) همگام‌سازی خودکار ────────────────────────────────────────
const DB2 = d1();
const env2 = { DB: DB2, GEMINI_API_KEY: "k" };
let calls = 0;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls++;
  const emb = body.requests.map(() => ({ values: Array.from({ length: 256 }, (_, i) => (i % 7) / 7) }));
  return new Response(JSON.stringify({ embeddings: emb }), { status: 200, headers: { "Content-Type": "application/json" } });
};
const none = await autoSyncIfSeedChanged({ DB: DB2 });
ok(none.skipped === "GEMINI_API_KEY", "بدونِ کلیدِ Gemini چیزی همگام نمی‌شود");
const r1 = await autoSyncIfSeedChanged(env2);
ok(r1.synced === true && r1.pending === 0, "با کلید: یک بار همگام می‌شود و همه بردار می‌گیرند", r1);
ok((await readConfig(env2, "kb_seed_version")) === currentSeedVersion(), "نسخه‌ی seed ثبت می‌شود");
const before = calls;
const r2 = await autoSyncIfSeedChanged(env2);
ok(r2.skipped === "به‌روز" && calls === before, "تیکِ بعدی هیچ کاری نمی‌کند (یک خواندنِ تنظیمات)");

console.log("\n" + n + " ادعا");
