// /phones: خروجیِ اکسلِ شماره‌ها - فقط مدیرِ اصلی.
//
// فایل xlsx دست‌ساز است (بدون کتابخانه)، پس مهم‌ترین چیز این است که یک
// خواننده‌ی واقعیِ zip آن را باز کند و محتوا درست باشد؛ تستِ «رشته‌ها
// برابرند» به‌تنهایی نشان نمی‌دهد اکسل فایل را باز می‌کند. اینجا
// unzipِ سیستم و بررسیِ XML هر دو هست.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildXlsx } from "../src/xlsx.js";
import { handlePhones, phoneRows } from "../src/commands/phones.js";
import { listAllPhones, ensurePhoneSchema } from "../src/phones.js";

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
      const st = { _a: [], _sql: sql };
      st.bind = (...a) => { st._a = a; return st; };
      st.run = async () => { const r = db.prepare(sql).run(...st._a); return { meta: { changes: Number(r.changes) } }; };
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

const OWNER = "6923823275";
const CERT_ONLY = "6929332443";

// ─── ۱) فایل xlsx واقعاً باز می‌شود ──────────────────────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xlsxtest-"));
const rows = [
  ["6923823275", "09123456789", "علی <رضایی> & پسران", "@ali", "ثبت‌نام / مشاوره", "", "", "2026-10-09 13:00", "2026-10-09 13:00"],
  ["171937271", "09370000001", "مریم", "", "دوره‌ی رایگان", "فارکس", "مشاوره", "2026-10-10 01:02", "2026-10-10 01:02"],
];
const bytes = buildXlsx({ sheetName: "شماره‌ها", headers: ["شناسه", "شماره", "نام", "کاربری", "منبع", "دوره", "نوع", "ثبت", "به‌روز"], rows });
const f = path.join(dir, "t.xlsx");
fs.writeFileSync(f, bytes);
let listing = "";
try { listing = execFileSync("unzip", ["-l", f], { encoding: "utf8" }); } catch (e) { listing = "ERR " + e.message; }
ok(/xl\/worksheets\/sheet1\.xml/.test(listing) && /\[Content_Types\]\.xml/.test(listing) && /xl\/workbook\.xml/.test(listing), "unzip فایل را باز می‌کند و بخش‌های اکسل را می‌بیند", listing);
let test = "";
try { test = execFileSync("unzip", ["-tq", f], { encoding: "utf8" }); } catch (e) { test = "ERR " + (e.stdout || e.message); }
ok(/No errors detected/.test(test), "و CRC همه‌ی بخش‌ها درست است", test);
const sheet = execFileSync("unzip", ["-p", f, "xl/worksheets/sheet1.xml"], { encoding: "utf8" });
ok(sheet.includes("09123456789") && sheet.includes('t="inlineStr"'), "شماره متن است (صفرِ اول نمی‌افتد)");
ok(sheet.includes("علی &lt;رضایی&gt; &amp; پسران"), "نویسه‌های XML در نام escape می‌شوند");
ok(sheet.includes('rightToLeft="1"'), "برگه راست‌به‌چپ است");
ok(sheet.includes('r="A3"') && !sheet.includes('r="A4"'), "دو ردیف + سرستون");
// XML خوش‌ساخت؟
let wellFormed = true;
for (const part of ["xl/worksheets/sheet1.xml", "xl/workbook.xml", "xl/styles.xml", "[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels"]) {
  const x = execFileSync("unzip", ["-p", f, part.replace("[", "\\[")], { encoding: "utf8" });
  try { execFileSync("python3", ["-c", "import sys,xml.dom.minidom as m; m.parseString(sys.stdin.buffer.read())"], { input: x }); } catch { wellFormed = false; console.log("XML بد:", part); }
}
ok(wellFormed, "همه‌ی XMLها خوش‌ساخت‌اند");
// ستون‌های بعد از Z
ok(buildXlsx({ headers: Array.from({ length: 30 }, (_, i) => "h" + i), rows: [] }).length > 100, "بیش از ۲۶ ستون هم ساخته می‌شود");
const big = buildXlsx({ headers: ["a"], rows: Array.from({ length: 20000 }, (_, i) => ["x" + i]) });
fs.writeFileSync(path.join(dir, "big.xlsx"), big);
ok(/No errors/.test(execFileSync("unzip", ["-tq", path.join(dir, "big.xlsx")], { encoding: "utf8" })), "۲۰ هزار ردیف هم سالم است");

// ─── ۲) خواندن از D1 ─────────────────────────────────────────────
const DB = d1();
const env = { DB, BOT_TOKEN: "T" };
await ensurePhoneSchema(env);
DB.raw.exec(`CREATE TABLE crm_leads (lead_id TEXT PRIMARY KEY, telegram_user_id TEXT, telegram_username TEXT, full_name TEXT, phone TEXT, course TEXT, request_type TEXT, notes TEXT, status TEXT, contact_attempts INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, score INTEGER, priority TEXT, assigned_to TEXT, reminder_date TEXT, source TEXT, quality TEXT, last_call_result TEXT, next_followup_at TEXT, level TEXT, topic TEXT, followup_reason TEXT)`);
const ins = DB.raw.prepare("INSERT INTO phone_book VALUES (?,?,?,?,?,?,?)");
for (let i = 0; i < 6000; i++) ins.run(String(1000 + i), "0912" + String(1000000 + i), "نام " + i, i % 2 ? "u" + i : null, '["ثبت‌نام"]', "2026-10-0" + (1 + (i % 9)) + "T10:00:00.000Z", "2026-10-09T10:00:00.000Z");
DB.raw.prepare("INSERT INTO crm_leads (lead_id, telegram_user_id, course, request_type) VALUES ('a','1000','فارکس','مشاوره'),('b','1000','فارکس','ثبت‌نام'),('c','1001','',' ')").run();
const all = await listAllPhones(env);
ok(all.length === 6000, "همه‌ی ۶۰۰۰ شماره می‌آید - سقفِ ۵هزارتاییِ پنل اینجا نیست", all.length);
const u = all.find((r) => r.telegram_user_id === "1000");
ok(u.courses.join() === "فارکس" && u.request_types.sort().join() === "ثبت‌نام,مشاوره", "دوره و نوعِ درخواست از لیدها یک‌جا جمع می‌شود (بدون تکرار)", u);
ok(all.find((r) => r.telegram_user_id === "1001").courses.length === 0, "لیدِ بی‌دوره چیزی اضافه نمی‌کند");
ok(phoneRows(all)[0].length === 9, "ردیف ۹ ستون دارد");

// ─── ۳) فرمان ────────────────────────────────────────────────────
function ctxFor(id) {
  const calls = { reply: [], doc: [] };
  return {
    calls,
    ctx: {
      env, from: { id: Number(id) }, chat: { id: Number(id), type: "private" },
      reply: async (t) => { calls.reply.push(t); },
      replyWithDocument: async (file, o) => { calls.doc.push({ file, o }); },
    },
  };
}
{
  const a = ctxFor(OWNER);
  await handlePhones(a.ctx);
  ok(a.calls.doc.length === 1, "مدیرِ اصلی یک فایل می‌گیرد");
  const d = a.calls.doc[0];
  ok(/^phones-\d{4}-\d{2}-\d{2}\.xlsx$/.test(d.file.filename || d.file.fileName || ""), "با نامِ phones-تاریخ.xlsx", Object.keys(d.file));
  ok(/6000/.test(d.o.caption) && /فوروارد/.test(d.o.caption), "زیرنویس تعداد را می‌گوید و هشدارِ حریم خصوصی دارد");
  ok(a.calls.reply.length === 0, "و پیامِ جدا نیست");
}
for (const [who, id] of [["کاربرِ فقط‌گواهی", CERT_ONLY], ["غریبه", "111222333"]]) {
  const b = ctxFor(id);
  await handlePhones(b.ctx);
  ok(b.calls.doc.length === 0 && b.calls.reply.length === 0, who + ": هیچ فایلی و هیچ پاسخی نمی‌گیرد - انگار فرمان وجود ندارد");
}
{
  const empty = { DB: d1(), BOT_TOKEN: "T" };
  empty.DB.raw.exec("CREATE TABLE crm_leads (lead_id TEXT PRIMARY KEY, telegram_user_id TEXT, course TEXT, request_type TEXT)");
  const a = ctxFor(OWNER);
  a.ctx.env = empty;
  await handlePhones(a.ctx);
  ok(a.calls.doc.length === 0 && /ثبت نشده/.test(a.calls.reply[0] || ""), "بدونِ شماره فایلِ خالی نمی‌فرستد");
}
{
  const reg = await import("../src/commands/registry.js");
  ok(reg.ADMIN_COMMANDS.some((c) => c.command === "phones") && !reg.CERT_COMMANDS.some((c) => c.command === "phones"), "در منوی «/» فقط مدیر /phones را می‌بیند");
}
fs.rmSync(dir, { recursive: true, force: true });
console.log("\n" + n + " ادعا");
