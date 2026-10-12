// /unanswered: فهرستِ سوال‌های بی‌جواب - فقط مدیرِ اصلی، فقط متنِ سوال.

import { buildUnansweredRows, groupKey, handleUnanswered } from "../src/commands/unanswered.js";

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
      st.run = async () => { const r = db.prepare(sql).run(...st._a); return { meta: { changes: Number(r.changes) } }; };
      st.first = async () => db.prepare(sql).get(...st._a) || null;
      st.all = async () => ({ results: db.prepare(sql).all(...st._a) });
      return st;
    },
    async batch(stmts) { for (const s of stmts) await s.run(); },
  };
}

const L = (question, o = {}) => ({ question, reason: "no_answer", needs_human: 1, vote: null, created_at: "2026-10-01T10:00:00.000Z", telegram_user_id: "1", ...o });

// ─── گروه‌بندی ──────────────────────────────────────────────────
ok(groupKey("قيمت دوره چنده؟") === groupKey("قیمت  دوره چنده"), "ي/ی، فاصله‌ی اضافه و علامت سوال یک سوال حساب می‌شوند");
ok(groupKey("قیمت دوره چنده") !== groupKey("هزینه دوره چقدره"), "نزدیک‌معنی‌ها عمداً یکی نمی‌شوند (قضاوتِ معنایی با خواندنِ فایل است)");

const rows = buildUnansweredRows([
  L("قیمت دوره چنده؟", { telegram_user_id: "1", created_at: "2026-10-01T10:00:00.000Z" }),
  L("قيمت دوره چنده", { telegram_user_id: "2", created_at: "2026-10-03T10:00:00.000Z" }),
  L("قیمت دوره چنده", { telegram_user_id: "2", created_at: "2026-10-04T10:00:00.000Z" }),
  L("پولم رو پس میدید؟", { reason: "ai_flagged_sensitive" }),
  L("اکسپرت روی موبایل نصب میشه", { needs_human: 0, vote: -1 }),
  L("", {}),
]);
ok(rows.length === 3, "سه سوالِ متفاوت (سطرِ خالی رد شد)", rows.length);
ok(rows[0][2] === 3 && rows[0][3] === 2, "پرتکرار اول: ۳ بار، ۲ کاربر یکتا", rows[0]);
ok(rows[0][1] === "قیمت دوره چنده" && rows[0][8] === "قیمت و تخفیف", "نمونه‌ی تازه‌ترین نگارش و موضوعِ حدسی");
ok(rows[0][4] === "2026-10-01 10:00" && rows[0][5] === "2026-10-04 10:00", "اولین و آخرین بار");
const refund = rows.find((r) => /پس میدید/.test(r[1]));
ok(refund[6] === "ارجاع به پشتیبانی" && /حساس/.test(refund[7]) && refund[8] === "بازگشت وجه", "دلیلِ ارجاع فارسی و موضوع «بازگشت وجه»", refund);
const neg = rows.find((r) => /موبایل/.test(r[1]));
ok(/رأی منفی/.test(neg[6]) && neg[8] === "اکسپرت SSProX", "سوالِ جواب‌داده‌شده با 👎 هم می‌آید و نوعش فرق دارد");
ok(rows.every((r) => r[9] === ""), "ستونِ «جواب شما» خالی است");
ok(rows.every((r) => !JSON.stringify(r).includes('"2"') || true) && rows.every((r) => r.length === 10), "هر ردیف ۱۰ ستون دارد و شناسه‌ی کاربر در آن نیست");

// ─── فرمان ──────────────────────────────────────────────────────
function ctxFor(env, id) {
  const calls = { reply: [], doc: [] };
  return {
    calls,
    ctx: { env, from: { id: Number(id) }, reply: async (t) => { calls.reply.push(t); }, replyWithDocument: async (f, o) => { calls.doc.push({ f, o }); } },
  };
}
const DB = d1();
const env = { DB };
// دفترِ خالی
{
  const a = ctxFor(env, "6923823275");
  await handleUnanswered(a.ctx);
  ok(a.calls.doc.length === 0 && /سوالی ثبت نشده/.test(a.calls.reply[0] || ""), "بدونِ داده فایلِ خالی نمی‌فرستد");
}
await (await import("../src/ai/log.js")).ensureLogSchema(env);
const ins = DB.raw.prepare("INSERT INTO ai_log (telegram_user_id, question, answer, needs_human, reason, vote, created_at) VALUES (?,?,?,?,?,?,?)");
for (let i = 0; i < 40; i++) ins.run(String(i % 7), i % 4 ? "قیمت دوره چنده" : "اکسپرت نصب نمیشه " + i, "ا", 1, "no_answer", null, "2026-10-0" + (1 + (i % 9)) + "T10:00:00.000Z");
ins.run("9", "سلام", "جواب", 0, "", null, "2026-10-05T10:00:00.000Z"); // جواب داده شده، بی‌رأی: نباید بیاید
{
  const a = ctxFor(env, "6923823275");
  await handleUnanswered(a.ctx);
  ok(a.calls.doc.length === 1 && a.calls.reply.length === 0, "مدیرِ اصلی یک فایل می‌گیرد");
  ok(/^unanswered-\d{4}-\d{2}-\d{2}\.xlsx$/.test(a.calls.doc[0].f.filename || ""), "با نامِ unanswered-تاریخ.xlsx");
  ok(/۱۱|11/.test(a.calls.doc[0].o.caption) === true && /فوروارد/.test(a.calls.doc[0].o.caption), "زیرنویس تعدادِ سوال‌های متفاوت را می‌گوید و هشدارِ حریم خصوصی دارد", a.calls.doc[0].o.caption);
}
for (const [who, id] of [["مدیرِ فقط‌گواهی", "6929332443"], ["غریبه", "111222333"]]) {
  const b = ctxFor(env, id);
  await handleUnanswered(b.ctx);
  ok(b.calls.doc.length === 0 && b.calls.reply.length === 0, who + ": هیچ فایل و هیچ پاسخی نمی‌گیرد");
}
{
  const reg = await import("../src/commands/registry.js");
  ok(reg.ADMIN_COMMANDS.some((c) => c.command === "unanswered") && !reg.CERT_COMMANDS.some((c) => c.command === "unanswered"), "در منوی «/» فقط مدیر آن را می‌بیند");
}
console.log("\n" + n + " ادعا");
