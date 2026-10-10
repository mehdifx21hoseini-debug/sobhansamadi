// گواهیِ دانشجو: نام، لیست، چیدمان، صفِ دسته‌ها، فرمان و ارسالِ پشتِ سرِ هم.
//
// ─── چرا SQLite واقعی ─────────────────────────────────────────────
//
// تست‌های قبلیِ این پروژه دیتابیسِ ساختگی داشتند که خودم نوشته بودم - و
// ساختگی فقط همان چیزی را تأیید می‌کند که من از SQL فرض کرده‌ام. اینجا
// دستورها روی یک SQLiteِ واقعی (همان موتورِ D1) اجرا می‌شوند، پس شرط‌های
// `WHERE status = ...`، `changes` و `ORDER BY rowid` واقعاً آزموده می‌شوند.
//
// ─── آنچه می‌خواهیم ثابت شود ──────────────────────────────────────
//
//   • یک لیست، چه یک نام چه سی نام، یک‌جا و به ترتیبِ لیست ساخته می‌شود.
//   • جنسیت را مدیر مشخص می‌کند: سرِ خط، یا با سرخطِ «خانم» / «آقایان».
//   • همه یا هیچ: یک خطِ بد یعنی هیچ گواهی‌ای ساخته نمی‌شود.
//   • غیرمدیر نه پاسخ می‌گیرد، نه چیزی در دیتابیس عوض می‌کند.
//   • ورک‌فلوی دیررسیده نمی‌تواند ردیفِ شکست‌خورده را «انجام‌شده» کند.
//   • تکرارِ آپلود هرگز عکسِ دوم نمی‌فرستد.
//   • برای کلِ دسته یک پیامِ پیشرفت هست، نه پیامی برای هر نام.

import { normalizeName } from "../src/certificate/name.js";
import { parseList, MAX_BATCH } from "../src/certificate/list.js";
import {
  enqueueBatch, claimNext, finishJob, cancelBatch, batchStats, sweep, countActive,
  failAllRendering, failBatch, getJob, resetCertSchemaMemo, STALE_MS, KEEP_MS, MAX_ACTIVE,
} from "../src/certificate/store.js";
import {
  slotForFilename, saveAsset, readAsset, missingAssets, completeJob, failJob, batchText,
  streamAsset, startRender, sweepIfPending, failLeftovers, looksLikePng, PENDING_FLAG,
} from "../src/certificate/service.js";
import { readConfig } from "../src/content/channel.js";
import {
  handleCert, handleCertAssets, handleCertCallback, handleCertAsset, handleCertListText, routeCertList,
  CERT_FLOW, CERT_STEP,
} from "../src/commands/cert.js";
import { planLine, REF } from "../../scripts/cert/layout.mjs";
import { getUserState, setUserState } from "../src/db.js";
import fs from "node:fs";

let n = 0;
const ok = (c, m, x) => {
  if (!c) { console.log("❌ " + m + (x !== undefined ? " → " + JSON.stringify(x) : "")); process.exitCode = 1; }
  else { console.log("✅ " + m); n++; }
};

const { DatabaseSync } = await import("node:sqlite");

// آداپتورِ D1 روی SQLiteِ واقعی. batch مثلِ D1 اتمیک است: یا همه یا هیچ.
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
    async batch(stmts) {
      db.exec("BEGIN");
      try { for (const s of stmts) await s.run(); db.exec("COMMIT"); }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
}
const freshEnv = (extra = {}) => {
  resetCertSchemaMemo();
  const DB = d1();
  DB.raw.exec(`CREATE TABLE user_state (
    telegram_user_id TEXT PRIMARY KEY, current_flow TEXT, current_step TEXT, temp_data TEXT, phone TEXT,
    intro_progress INTEGER DEFAULT 0, source_first_seen TEXT, last_interaction_at TEXT, blocked_at TEXT)`);
  return { DB, BOT_TOKEN: "TEST", ...extra };
};

const OWNER = "6923823275"; // یکی از OWNER_IDS
const STRANGER = "111222333";
const T0 = Date.UTC(2026, 9, 9, 12, 0, 0);
const ghEnv = { GITHUB_DISPATCH_TOKEN: "t", GITHUB_REPO: "o/r", GITHUB_REF_NAME: "main" };

// ─── ۱) نام ─────────────────────────────────────────────────────
{
  const r = normalizeName("  سید   محمد  سرآبادانی ");
  ok(r.ok && r.name === "سید محمد سرآبادانی" && !r.converted, "فاصله‌های اضافه جمع می‌شود", r);
}
{
  const r = normalizeName("علي كريمي");
  ok(r.ok && r.name === "علی کریمی" && r.converted === true, "ي و ك عربی به ی و ک فارسی برمی‌گردد و مدیر باخبر می‌شود", r);
}
ok(normalizeName("فاطمة زهراء").name === "فاطمه زهراء", "ة → ه");
ok(normalizeName("محـــمد").name === "محمد", "کشیده (ـ) برداشته می‌شود");
ok(normalizeName("مُحَمَّد").name === "محمد", "اعراب برداشته می‌شود");
ok(normalizeName("ﻣﺤﻤﺪ").name === "محمد", "شکل‌های نمایشیِ عربی به حرفِ اصلی برمی‌گردند");
ok(normalizeName("محمدی‌نژاد").name === "محمدی‌نژاد", "نیم‌فاصله‌ی درونِ نام می‌ماند");
ok(normalizeName("علی ‌ رضا").name === "علی رضا", "نیم‌فاصله‌ی چسبیده به فاصله حذف می‌شود");
ok(normalizeName("‏علی‎").name === "علی", "نشانه‌های جهت (RLM/LRM) برداشته می‌شوند");
ok(normalizeName("علی-رضا").ok, "خط‌تیره مجاز است");
ok(!normalizeName("").ok && !normalizeName("   ").ok, "خالی رد می‌شود");
ok(!normalizeName("Ali").ok, "حرفِ لاتین رد می‌شود");
ok(!normalizeName("علی ۱۲").ok && !normalizeName("علی 12").ok, "رقم رد می‌شود");
ok(!normalizeName("علی 😀").ok, "ایموجی رد می‌شود");
ok(!normalizeName("ع").ok, "تک‌حرف رد می‌شود");
ok(!normalizeName("ا".repeat(61)).ok && normalizeName("ا".repeat(60)).ok, "سقفِ ۶۰ نویسه دقیق است");
ok(!normalizeName("<b>علی</b>").ok, "نشانه‌گذاریِ HTML رد می‌شود");

// ─── ۲) لیست ────────────────────────────────────────────────────
const names = (r) => r.items.map((i) => i.gender + ":" + i.name);
{
  const r = parseList("خانم راحیل غلامی\nآقا سید محمد سرآبادانی");
  ok(r.ok && names(r).join("|") === "f:راحیل غلامی|m:سید محمد سرآبادانی", "هر خط با جنسیتِ خودش", r);
}
{
  const r = parseList("خانم راحیل غلامی");
  ok(r.ok && r.items.length === 1, "یک نام هم یک لیست است");
}
{
  const r = parseList("خانم\nراحیل غلامی\nفاطمه محمدی\nآقا\nسید محمد سرآبادانی");
  ok(r.ok && names(r).join("|") === "f:راحیل غلامی|f:فاطمه محمدی|m:سید محمد سرآبادانی", "سرخطِ «خانم» جنسیتِ خط‌های بعدی را تا سرخطِ دیگر تعیین می‌کند", r);
}
{
  const r = parseList("خانم\nراحیل غلامی\nآقا سید محمد سرآبادانی\nفاطمه محمدی");
  ok(r.ok && names(r).join("|") === "f:راحیل غلامی|m:سید محمد سرآبادانی|f:فاطمه محمدی", "جنسیتِ سرِ خط بر سرخط می‌چربد و سرخط را عوض نمی‌کند", r);
}
{
  const r = parseList("آقایان:\nعلی رضایی\nخانم‌ها\nمریم احمدی");
  ok(r.ok && names(r).join("|") === "m:علی رضایی|f:مریم احمدی", "جمع («آقایان:»، «خانم‌ها») هم سرخط است", r);
}
{
  const r = parseList("جناب آقای حسین نوری\nسرکار خانم زهرا کریمی\nجناب علی\nسرکار مریم\nبانو سارا\nآقای رضا");
  ok(r.ok && names(r).join("|") === "m:حسین نوری|f:زهرا کریمی|m:علی|f:مریم|f:سارا|m:رضا", "همه‌ی شکل‌های جنسیت: جناب آقای، سرکار خانم، جناب، سرکار، بانو، آقای", r);
}
{
  const r = parseList("۱- خانم راحیل غلامی\n2) آقا علی رضایی\n• سرکار خانم زهرا کریمی\n- جناب آقای حسین نوری");
  ok(r.ok && r.items.length === 4 && r.items[0].name === "راحیل غلامی", "شماره‌گذاری و گلوله‌ی اولِ خط برداشته می‌شود (لیستِ کپی‌شده)", r);
}
{
  const r = parseList("آقاي علي كريمي\nخانم فاطمة زهراء");
  ok(r.ok && names(r).join("|") === "m:علی کریمی|f:فاطمه زهراء" && r.items.every((i) => i.converted), "کیبوردِ عربی در لیست هم تبدیل می‌شود", r);
}
{
  const r = parseList("خانم\nآقازاده مریم");
  ok(r.ok && names(r)[0] === "f:آقازاده مریم", "«آقازاده» نامِ یک خانم است، نه جنسیتِ «آقا» (مرزِ کلمه)", r);
}
{
  const r = parseList("خانم راحیل غلامی؛آقا علی رضایی");
  ok(r.ok && r.items.length === 2, "«؛» هم جداکننده است");
}
{
  const r = parseList("\n\n  خانم راحیل غلامی  \n\n   \nآقا علی رضایی\n");
  ok(r.ok && r.items.length === 2, "خط‌های خالی و فاصله‌ی اضافه نادیده گرفته می‌شود");
}
{
  const r = parseList("راحیل غلامی\nخانم علی\nعلی رضایی");
  ok(!r.ok && r.errors.length === 2 && r.errors[0].line === 1 && r.errors[1].line === 3 && /جنسیت/.test(r.errors[0].reason),
     "خطِ بدونِ جنسیت (و بدونِ سرخط) ایراد است و شماره‌ی خطش گفته می‌شود", r);
}
{
  const r = parseList("خانم Ali\nآقا 12\nآقا ع\nخانم علی");
  ok(!r.ok && r.errors.length === 3 && r.errors.map((e) => e.line).join() === "1,2,3", "همه‌ی ایراد‌ها یک‌جا گفته می‌شود، نه فقط اولی", r);
  ok(r.errors.every((e) => e.text && e.reason), "هر ایراد خط و دلیل دارد");
}
{
  const r = parseList("خانم علی رضایی\nخانم Ali");
  ok(!r.ok, "همه یا هیچ: یک خطِ بد کلِ لیست را رد می‌کند");
}
ok(!parseList("").ok && !parseList("  \n \n").ok && !parseList(null).ok, "لیستِ خالی رد می‌شود");
ok(!parseList("خانم").ok, "فقط یک سرخط، بی‌نام، رد می‌شود");
{
  const mk = (k) => Array.from({ length: k }, (_, i) => "خانم نام " + "ا".repeat((i % 20) + 2)).join("\n");
  ok(parseList(mk(MAX_BATCH)).ok, "دقیقاً ۳۰ نام پذیرفته می‌شود");
  const r = parseList(mk(MAX_BATCH + 1));
  ok(!r.ok && /۳۰|30/.test(r.errors[0].reason), "۳۱ نام رد می‌شود", r);
}
ok(parseList("خانم علی\n\nآقا رضا").items.length === 2, "ترتیبِ لیست حفظ می‌شود");
{
  const r = parseList("آقا <b>علی</b>");
  ok(!r.ok, "نشانه‌گذاریِ HTML در لیست رد می‌شود");
}

// ─── ۳) چیدمان ──────────────────────────────────────────────────
const layout = JSON.parse(fs.readFileSync(new URL("../../scripts/cert/layout.json", import.meta.url), "utf8"));
const nameRef = { abl: 0, abr: (780 / 172.2) * REF };
const labelRef = { abl: 0, abr: (585 / 133.9) * REF };
{
  const p = planLine(labelRef, nameRef, layout);
  ok(p.fit === "ok" && p.nameScale === 1, "نامِ معمولی بدونِ کوچک شدن جا می‌شود", p);
  ok(Math.abs(p.name.inkLeft + p.totalWidth / 2 - layout.centerX) < 0.01, "وسطِ خط روی centerX می‌نشیند");
  ok(p.label.inkLeft > p.name.inkLeft, "برچسب سمتِ راستِ نام است (خطِ راست‌به‌چپ)");
  ok(Math.abs(p.label.inkLeft - (p.name.inkLeft + p.name.width) - layout.gapPx) < 0.01, "فاصله‌ی جوهر تا جوهر همان gapPx است");
  ok(p.name.inkLeft + p.totalWidth <= layout.canvas.width, "خط از بوم بیرون نمی‌زند");
}
{
  const p = planLine(labelRef, { abl: 0, abr: (1900 / 172.2) * REF }, layout);
  ok(p.fit === "shrunk" && p.nameScale < 1 && p.nameScale >= layout.fit.minScale, "نامِ بلند کوچک می‌شود، نه بیرون می‌زند", p);
  ok(p.totalWidth <= layout.fit.maxWidthPx + 0.5, "و بعد از کوچک شدن در عرضِ مجاز است", p.totalWidth);
}
{
  const p = planLine(labelRef, { abl: 0, abr: (9000 / 172.2) * REF }, layout);
  ok(p.fit === "overflow" && p.nameScale === layout.fit.minScale, "نامِ بی‌نهایت بلند به کفِ اندازه می‌رسد و overflow اعلام می‌شود", p);
}
{
  const a = planLine(labelRef, nameRef, layout), b = planLine({ abl: 0, abr: labelRef.abr * 0.9 }, nameRef, layout);
  ok(a.name.inkLeft !== b.name.inkLeft, "برچسبِ کوتاه‌تر (جناب آقای) خط را دوباره وسط‌چین می‌کند");
}

// ─── ۴) صفِ دسته‌ها روی SQLiteِ واقعی ──────────────────────────
const ITEMS3 = [
  { name: "راحیل غلامی", gender: "f" },
  { name: "سید محمد سرآبادانی", gender: "m" },
  { name: "فاطمه محمدی", gender: "f" },
];
const enq = (env, items = ITEMS3, o = {}) =>
  enqueueBatch(env, { ownerId: OWNER, chatId: "555", messageId: 9, items, now: T0, ...o });

{
  const env = freshEnv();
  const { batchId, ids } = await enq(env);
  ok(/^[0-9a-f]{12}$/.test(batchId) && ids.length === 3, "شناسه‌ی دسته ۱۲ رقمِ هگز است و هر نام شناسه‌ی خودش را دارد");
  ok(Buffer.byteLength("CERT|k|" + batchId) <= 64, "callback_data زیرِ سقفِ ۶۴ بایتِ تلگرام است");
  const st = await batchStats(env, batchId);
  ok(st.total === 3 && st.counts.queued === 3, "هر سه ردیف در صف نشستند", st);
  ok(st.chat_id === "555" && st.message_id === 9 && st.owner_id === OWNER, "و شناسه‌ی گفتگو و پیامِ پیشرفت روی دسته ثبت شد");
  const rows = env.DB.raw.prepare("SELECT name, gender, batch_pos, batch_total FROM cert_jobs ORDER BY rowid").all();
  ok(rows.map((r) => r.batch_pos).join() === "1,2,3" && rows.every((r) => r.batch_total === 3), "جایگاه و کلِ دسته روی هر ردیف ثبت می‌شود", rows);
  ok(rows.map((r) => r.gender).join() === "f,m,f", "جنسیتِ هر نام همان است که مدیر نوشت");
}
{
  // ترتیب: ورک‌فلو دقیقاً به ترتیبِ لیست برمی‌دارد
  const env = freshEnv();
  await enq(env);
  const a = await claimNext(env, T0 + 1), b = await claimNext(env, T0 + 1), c = await claimNext(env, T0 + 1), d = await claimNext(env, T0 + 1);
  ok([a, b, c].map((j) => j.name).join("|") === ITEMS3.map((i) => i.name).join("|"), "claimNext به ترتیبِ لیست برمی‌دارد، هرچند همه در یک میلی‌ثانیه ساخته شدند", [a, b, c].map((j) => j.name));
  ok(d === null, "و هر ردیف دقیقاً یک بار");
  ok(a.status === "rendering", "ردیفِ برداشته‌شده rendering است");
}
{
  // دو دسته: اولی کامل، بعد دومی
  const env = freshEnv();
  await enq(env, [{ name: "اول", gender: "m" }, { name: "دوم", gender: "m" }]);
  await enq(env, [{ name: "سوم", gender: "f" }]);
  const order = [];
  for (let i = 0; i < 3; i++) order.push((await claimNext(env)).name);
  ok(order.join() === "اول,دوم,سوم", "دسته‌ی دوم بعد از دسته‌ی اول می‌آید", order);
  ok(await countActive(env) === 3, "countActive ردیف‌های در جریان را می‌شمارد");
}
{
  // اتمیک: یک ردیفِ خراب کلِ دسته را نمی‌نشاند
  const env = freshEnv();
  let threw = false;
  try { await enq(env, [{ name: "خوب", gender: "f" }, { name: null, gender: "f" }]); } catch { threw = true; }
  ok(threw && env.DB.raw.prepare("SELECT COUNT(*) AS n FROM cert_jobs").get().n === 0, "درجِ دسته اتمیک است: یک ردیفِ خراب یعنی هیچ‌کدام نمی‌نشیند");
}
{
  const env = freshEnv();
  const { ids } = await enq(env);
  ok(await finishJob(env, ids[0], "done", null, T0 + 1) === false, "done از queued ممکن نیست - عکسی رندر نشده");
  const j = await claimNext(env);
  ok(await finishJob(env, j.id, "done", null, T0 + 2) === true, "done از rendering ممکن است");
  ok(await finishJob(env, j.id, "done", null, T0 + 3) === false, "done دوباره اثری ندارد");
  ok(await finishJob(env, j.id, "failed", "x", T0 + 4) === false, "ردیفِ انجام‌شده را نمی‌شود شکست‌خورده کرد");
  ok((await getJob(env, j.id)).status === "done", "و وضعیتش done می‌ماند");
}
{
  // لغوِ باقی‌مانده
  const env = freshEnv();
  const { batchId, ids } = await enq(env);
  const first = await claimNext(env);
  ok(await cancelBatch(env, batchId, STRANGER) === 0, "کسِ دیگر نمی‌تواند دسته را لغو کند");
  ok(await cancelBatch(env, batchId, OWNER) === 2, "مالک دو ردیفِ منتظر را لغو می‌کند");
  const st = await batchStats(env, batchId);
  ok(st.counts.cancelled === 2 && st.counts.rendering === 1, "ردیفِ در حال رندر لغو نمی‌شود - تمام می‌شود", st.counts);
  ok(await claimNext(env) === null, "و ردیفِ لغوشده هرگز برداشته نمی‌شود");
  ok(await finishJob(env, first.id, "done") === true, "ردیفِ در حال رندر همچنان می‌تواند تمام شود");
  ok(await cancelBatch(env, batchId, OWNER) === 0, "لغوِ دوباره چیزی پیدا نمی‌کند");
  void ids;
}
{
  // جاروی گیرکرده‌ها
  const env = freshEnv();
  const { batchId } = await enq(env, [{ name: "منتظر", gender: "m" }, { name: "درحال", gender: "m" }, { name: "سوم", gender: "m" }]);
  await claimNext(env, T0 + 10);
  const r = await sweep(env, T0 + STALE_MS + 5000);
  const codes = r.stale.map((j) => j.error).sort();
  ok(r.stale.length === 3 && codes.join() === "no_runner,no_runner,timeout", "هر سه ردیفِ گیرکرده شکست‌خورده اعلام شدند، با دلیلی که با وضعیتِ قبلی می‌خواند", codes);
  ok(r.stale.every((j) => j.batch_id === batchId), "و دسته‌شان معلوم است - برای تازه‌سازیِ یک‌بارِ پیام");
}
{
  const env = freshEnv();
  await enq(env, [{ name: "تازه", gender: "m" }], { now: T0 + STALE_MS - 1000 });
  ok((await sweep(env, T0 + STALE_MS + 5000)).stale.length === 0, "ردیفِ تازه دست‌نخورده می‌ماند");
}
{
  // پاک‌سازیِ داده‌ی شخصی
  const env = freshEnv();
  const old = await enq(env, [{ name: "قدیمی", gender: "m" }], { now: T0 - KEEP_MS - 5000 });
  await claimNext(env, T0 - KEEP_MS - 4000);
  await finishJob(env, old.ids[0], "done", null, T0 - KEEP_MS - 3000);
  const young = await enq(env, [{ name: "تازه", gender: "m" }], { now: T0 });
  const r = await sweep(env, T0);
  ok(r.purged === 1 && (await getJob(env, old.ids[0])) === null, "نامِ انجام‌شده‌ی بیش از ۳۰ روز پاک می‌شود");
  ok((await getJob(env, young.ids[0])) !== null, "و ردیفِ تازه ماند");
}
{
  const env = freshEnv();
  const { batchId, ids } = await enq(env);
  await claimNext(env);
  const left = await failAllRendering(env, T0 + 1);
  ok(left.length === 1 && (await getJob(env, ids[0])).status === "failed", "failAllRendering هرچه نیمه‌کاره مانده را شکست‌خورده می‌کند");
  ok(await failBatch(env, batchId, "dispatch", T0 + 2) === 2 && (await batchStats(env, batchId)).counts.failed === 3, "failBatch همه‌ی باقی‌مانده‌ی دسته را شکست‌خورده می‌کند");
}
{
  // جدولِ نسخه‌ی قبلی (بدونِ ستون‌های دسته) بی‌خطا و بی‌ازدست‌دادنِ داده ارتقا می‌یابد
  resetCertSchemaMemo();
  const env = { DB: d1(), BOT_TOKEN: "T" };
  env.DB.raw.exec(`CREATE TABLE cert_jobs (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, gender TEXT,
    status TEXT NOT NULL, chat_id TEXT, message_id INTEGER, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  env.DB.raw.prepare("INSERT INTO cert_jobs VALUES ('oldoldoldold', ?, 'قدیمی', 'f', 'done', '1', 2, NULL, 'a', 'b')").run(OWNER);
  const b = await enq(env, [{ name: "تازه", gender: "m" }]);
  const cols = env.DB.raw.prepare("PRAGMA table_info(cert_jobs)").all().map((c) => c.name);
  ok(["batch_id", "batch_pos", "batch_total"].every((c) => cols.includes(c)), "ستون‌های دسته به جدولِ قدیمی اضافه می‌شود");
  ok((await getJob(env, "oldoldoldold")).name === "قدیمی" && (await batchStats(env, b.batchId)).total === 1, "ردیفِ قدیمی می‌ماند و دسته‌ی تازه کار می‌کند");
}

// ─── ۵) فایل‌های خصوصی ───────────────────────────────────────────
ok(slotForFilename("template.png") === "template", "template.png → قالب");
ok(slotForFilename("Template.PNG") === "template", "بزرگیِ حروف مهم نیست");
ok(slotForFilename("YekanBakh-ExtraBlack.ttf") === "name_font", "ExtraBlack → فونتِ اسم");
ok(slotForFilename("YekanBakh-Light.ttf") === "label_font", "Light → فونتِ برچسب");
ok(slotForFilename("YekanBakh-Black.ttf") === null, "Black و بقیه‌ی وزن‌ها گواهی نیستند");
ok(slotForFilename("YekanBakh-Bold.ttf") === null && slotForFilename("YekanBakh-Thin.ttf") === null, "Bold/Thin هم نه");
ok(slotForFilename("photo.png") === null && slotForFilename("") === null && slotForFilename(undefined) === null, "فایلِ نامربوط شناخته نمی‌شود");
ok(slotForFilename("template.png.exe") === null, "پسوندِ جعلی شناخته نمی‌شود");

// ─── ctx و fetchِ ساختگی ────────────────────────────────────────
const sent = [];
function installFetch(handler) {
  globalThis.fetch = async (url, init = {}) => {
    sent.push({ url: String(url), method: init.method, body: init.body });
    return handler(String(url), init);
  };
}
const jsonRes = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const ghOk = (url) => (url.includes("api.github.com") ? new Response(null, { status: 204 }) : jsonRes({ ok: true, result: {} }));
const dispatches = () => sent.filter((s) => s.url.includes("api.github.com"));
const tg = (method) => sent.filter((s) => s.url.endsWith("/" + method));
const edits = () => tg("editMessageText").map((s) => JSON.parse(s.body));

function makeCtx(env, { from = OWNER, match = "", data, doc, text } = {}) {
  const calls = { reply: [], answer: [], edit: [] };
  let seq = 500;
  const ctx = {
    env,
    from: { id: Number(from) },
    chat: { id: Number(from) },
    match,
    message: doc ? { document: doc } : text !== undefined ? { text } : undefined,
    callbackQuery: data ? { data, message: { chat: { id: Number(from) }, message_id: 77 } } : undefined,
    reply: async (t, o) => { calls.reply.push({ t, o }); return { message_id: ++seq }; },
    answerCallbackQuery: async (o) => { calls.answer.push(o); },
    editMessageText: async (t, o) => { calls.edit.push({ t, o }); },
  };
  return { ctx, calls };
}

async function loadAssets(env) {
  for (const [slot, file] of [["template", "template.png"], ["name_font", "YekanBakh-ExtraBlack.ttf"], ["label_font", "YekanBakh-Light.ttf"]]) {
    await saveAsset(env, slot, { file_id: "fid_" + slot, file_size: 1234, file_name: file });
  }
}
const readyEnv = async (extra = ghEnv) => { const env = freshEnv(extra); await loadAssets(env); sent.length = 0; installFetch(ghOk); return env; };
const rows = (env) => {
  try { return env.DB.raw.prepare("SELECT * FROM cert_jobs ORDER BY rowid").all(); } catch { return []; }
};

// ─── ۶) فرمانِ /cert ─────────────────────────────────────────────
{
  const env = await readyEnv();
  const { ctx, calls } = makeCtx(env, { from: STRANGER, match: "خانم راحیل غلامی" });
  await handleCert(ctx);
  ok(calls.reply.length === 0, "برای غیرمدیر هیچ پاسخی نیست - انگار فرمان وجود ندارد");
  const table = env.DB.raw.prepare("SELECT name FROM sqlite_master WHERE name = 'cert_jobs'").get();
  ok(!table || rows(env).length === 0, "و به دیتابیس دست نمی‌زند");
  ok(dispatches().length === 0, "و ورک‌فلویی راه نمی‌افتد");
}
{
  const env = freshEnv(ghEnv); sent.length = 0; installFetch(ghOk);
  const { ctx, calls } = makeCtx(env, { match: "" });
  await handleCert(ctx);
  ok(/هنوز کامل بارگذاری نشده/.test(calls.reply[0].t), "بدونِ فایل‌های گواهی، می‌گوید چه چیزی کم است");
  ok(/template\.png/.test(calls.reply[0].t) && /ExtraBlack/.test(calls.reply[0].t) && /Light/.test(calls.reply[0].t), "نامِ سه فایل را می‌گوید");
  ok((await getUserState(env, OWNER)) === null || (await getUserState(env, OWNER)).current_flow !== CERT_FLOW, "و منتظرِ لیست نمی‌ماند");
}
{
  const env = await readyEnv();
  const { ctx, calls } = makeCtx(env, { match: "" });
  await handleCert(ctx);
  const t = calls.reply[0].t;
  ok(/لیستِ نام‌ها را بفرستید/.test(t) && /خانم راحیل غلامی/.test(t) && /آقا سید محمد/.test(t), "/cert بدونِ نام، فرمتِ لیست را با مثال توضیح می‌دهد - نه دکمه‌ی جنسیت");
  ok(/«خانم» یا «آقا»/.test(t) && /سرخط|زیرش/.test(t), "و می‌گوید چطور برای چند نفرِ هم‌جنس یک خط کافی است");
  const btns = calls.reply[0].o.reply_markup.inline_keyboard.flat();
  ok(btns.length === 1 && btns[0].callback_data === "CERT|c", "فقط دکمه‌ی لغو دارد");
  const st = await getUserState(env, OWNER);
  ok(st.current_flow === CERT_FLOW && st.current_step === CERT_STEP, "و منتظرِ لیست می‌ماند", st);
  ok(rows(env).length === 0 && dispatches().length === 0, "هنوز چیزی ساخته نمی‌شود");
}
{
  // لیست در پیامِ بعد
  const env = await readyEnv();
  await handleCert(makeCtx(env, { match: "" }).ctx);
  const { ctx, calls } = makeCtx(env, { text: "خانم\nراحیل غلامی\nفاطمه محمدی\nآقا\nسید محمد سرآبادانی" });
  await handleCertListText(ctx);
  const r = rows(env);
  ok(r.length === 3 && r.map((x) => x.gender).join() === "f,f,m" && r.map((x) => x.name).join("|") === "راحیل غلامی|فاطمه محمدی|سید محمد سرآبادانی", "هر سه نام با جنسیتِ مدیر و به ترتیبِ لیست در صف می‌نشینند", r.map((x) => x.name));
  ok(r.every((x) => x.status === "queued" && x.batch_total === 3), "در یک دسته، و همه منتظرِ رندر");
  ok(calls.reply.length === 1 && /۳ گواهی در صف/.test(calls.reply[0].t), "یک پیامِ پیشرفت برای کلِ دسته (نه سه پیام)");
  ok(/۱\. سرکار خانم راحیل غلامی/.test(calls.reply[0].t) && /۳\. جناب آقای سید محمد سرآبادانی/.test(calls.reply[0].t), "پیش‌نمایش ترتیب و جنسیتِ هر نام را نشان می‌دهد");
  ok(r.every((x) => x.message_id === 501 && x.chat_id === OWNER), "و همه‌ی ردیف‌ها همان پیام را به‌روز می‌کنند");
  ok(dispatches().length === 1 && /cert-render\.yml\/dispatches$/.test(dispatches()[0].url), "ورک‌فلوی رندر دقیقاً یک بار راه می‌افتد - نه یک بار برای هر نام");
  ok(!/راحیل|فاطمه|سرآبادانی/.test(String(dispatches()[0].body)), "و نامِ هیچ دانشجویی در درخواستِ گیت‌هاب نیست - ریپو عمومی است");
  ok((await getUserState(env, OWNER)).current_flow === null, "حالتِ «منتظرِ لیست» پاک می‌شود - پیام‌های بعدیِ مدیر بلعیده نمی‌شوند");
  ok((await readConfig(env, PENDING_FLAG)) === "1", "علامتِ «کار در جریان» برای جاروی کران گذاشته می‌شود");
}
{
  // میان‌بر: لیست همراهِ خودِ دستور
  const env = await readyEnv();
  const one = makeCtx(env, { match: "خانم راحیل غلامی" });
  await handleCert(one.ctx);
  ok(rows(env).length === 1 && rows(env)[0].gender === "f", "میان‌بر: «/cert خانم نام» بی‌مرحله‌ی «لیست را بفرستید» می‌سازد");
  ok(dispatches().length === 1, "و ورک‌فلو راه می‌افتد");

  const env2 = await readyEnv();
  await handleCert(makeCtx(env2, { match: "آقایان\nعلی رضایی\nحسین نوری\nخانم مریم احمدی" }).ctx);
  ok(rows(env2).map((x) => x.gender + x.name).join("|") === "mعلی رضایی|mحسین نوری|fمریم احمدی", "میان‌بر چند خطی هم کار می‌کند", rows(env2).map((x) => x.name));
}
{
  // همه یا هیچ
  const env = await readyEnv();
  await handleCert(makeCtx(env, { match: "" }).ctx);
  const bad = makeCtx(env, { text: "خانم راحیل غلامی\nعلی رضایی\nآقا Ali\nخانم فاطمه محمدی" });
  await handleCertListText(bad.ctx);
  const t = bad.calls.reply[0].t;
  ok(rows(env).length === 0 && dispatches().length === 0, "لیستِ ایراددار: هیچ گواهی‌ای ساخته نمی‌شود (حتی خط‌های درست)");
  ok(/هیچ گواهی‌ای ساخته نشد/.test(t) && /خط ۲/.test(t) && /خط ۳/.test(t) && !/خط ۱/.test(t) && !/خط ۴/.test(t), "و فقط خط‌های بد با شماره‌شان گفته می‌شود", t);
  ok(/جنسیت/.test(t) && /لاتین/.test(t), "با دلیلِ هرکدام");
  ok((await getUserState(env, OWNER)).current_flow === CERT_FLOW, "حالت را نمی‌بندد: مدیر اصلاح‌شده را دوباره می‌فرستد");
  const good = makeCtx(env, { text: "خانم راحیل غلامی\nآقا علی رضایی\nآقا حسین نوری\nخانم فاطمه محمدی" });
  await handleCertListText(good.ctx);
  ok(rows(env).length === 4 && (await getUserState(env, OWNER)).current_flow === null, "نسخه‌ی اصلاح‌شده ساخته می‌شود و حالت پاک می‌شود");
}
{
  // میان‌بر با ایراد: حالتی نمی‌ماند
  const env = await readyEnv();
  const bad = makeCtx(env, { match: "راحیل غلامی" });
  await handleCert(bad.ctx);
  ok(/جنسیت/.test(bad.calls.reply[0].t) && /\/cert/.test(bad.calls.reply[0].t) && rows(env).length === 0, "میان‌برِ بی‌جنسیت رد می‌شود و راهِ دوباره‌فرستادن را می‌گوید");
}
{
  // صف جا ندارد
  const env = await readyEnv();
  await enq(env, Array.from({ length: MAX_ACTIVE }, (_, i) => ({ name: "نام " + "ا".repeat(i % 9 + 2), gender: "m" })));
  const { ctx, calls } = makeCtx(env, { match: "خانم علی رضایی" });
  await handleCert(ctx);
  ok(/جا نمی‌شود/.test(calls.reply[0].t) && rows(env).length === MAX_ACTIVE, "وقتی صف پر است لیستِ تازه در صف نمی‌نشیند");
  await handleCert(makeCtx(env, { match: "" }).ctx);
  // حالتِ منتظرِ لیست در این وضع: لیست که برسد، حالت پاک می‌شود (پیش‌نیاز آماده نیست)
  const l = makeCtx(env, { text: "خانم علی رضایی" });
  await handleCertListText(l.ctx);
  ok((await getUserState(env, OWNER)).current_flow === null, "و حالت پاک می‌شود تا مدیر برای همیشه «وسطِ گواهی» نماند");
}
{
  // لغوِ «منتظرِ لیست»
  const env = await readyEnv();
  await handleCert(makeCtx(env, { match: "" }).ctx);
  const c = makeCtx(env, { data: "CERT|c" });
  await handleCertCallback(c.ctx);
  ok((await getUserState(env, OWNER)).current_flow === null && /لغو/.test(c.calls.edit[0].t), "دکمه‌ی لغو حالتِ «منتظرِ لیست» را پاک می‌کند و پیام را «لغو شد» می‌کند");
  ok(rows(env).length === 0, "و چیزی ساخته نمی‌شود");
}
{
  // /cert دوباره
  const env = await readyEnv();
  await handleCert(makeCtx(env, { match: "" }).ctx);
  await handleCert(makeCtx(env, { match: "خانم راحیل غلامی" }).ctx);
  ok((await getUserState(env, OWNER)).current_flow === null, "/cert با لیست حالتِ قبلیِ «منتظرِ لیست» را پاک می‌کند");
  await setUserState(env, OWNER, { current_flow: "label_edit", current_step: "ask_label", temp_data: { x: 1 } });
  await handleCert(makeCtx(env, { match: "آقا علی رضایی" }).ctx);
  ok((await getUserState(env, OWNER)).current_flow === "label_edit", "ولی فرآیندِ ویرایشِ برچسب را که وسطش بود خراب نمی‌کند");
}
{
  // ضربه‌ی دکمه‌ی منو لیست نیست
  const env = await readyEnv();
  await handleCert(makeCtx(env, { match: "" }).ctx);
  const menu = makeCtx(env, { text: "تماس با ما" });
  const consumed = await routeCertList(menu.ctx, await getUserState(env, OWNER), async (_e, t) => (t === "تماس با ما" ? "CONTACT" : null));
  ok(consumed === false, "اگر متن ضربه‌ی یک دکمه‌ی منو باشد، مصرف نمی‌شود و مسیریابیِ عادی ادامه می‌دهد");
  ok((await getUserState(env, OWNER)).current_flow === null && rows(env).length === 0 && menu.calls.reply.length === 0, "حالتِ گواهی پاک می‌شود، چیزی ساخته نمی‌شود و ربات چیزی نمی‌گوید");

  await handleCert(makeCtx(env, { match: "" }).ctx);
  const list = makeCtx(env, { text: "خانم علی رضایی" });
  const c2 = await routeCertList(list.ctx, await getUserState(env, OWNER), async () => null);
  ok(c2 === true && rows(env).length === 1, "متنی که دکمه‌ی منو نیست به‌عنوانِ لیست مصرف می‌شود");
}
{
  // غیرمدیر با حالتِ کهنه
  const env = await readyEnv();
  await setUserState(env, STRANGER, { current_flow: CERT_FLOW, current_step: CERT_STEP, temp_data: {} });
  const evil = makeCtx(env, { from: STRANGER, text: "خانم علی رضایی" });
  await handleCertListText(evil.ctx);
  ok(rows(env).length === 0 && dispatches().length === 0 && evil.calls.reply.length === 0, "غیرمدیر نمی‌تواند با تایپِ لیست گواهی بسازد، و جوابی هم نمی‌گیرد");
  ok((await getUserState(env, STRANGER)).current_flow === null, "و حالتِ ساختگی‌اش پاک می‌شود");
}
{
  // لغوِ باقی‌مانده با دکمه
  const env = await readyEnv();
  await handleCert(makeCtx(env, { match: "خانم الف ب\nخانم ج د\nآقا ه و" }).ctx);
  const batchId = rows(env)[0].batch_id;
  const stranger = makeCtx(env, { from: STRANGER, data: "CERT|k|" + batchId });
  await handleCertCallback(stranger.ctx);
  ok(rows(env).every((x) => x.status === "queued") && stranger.calls.answer[0] === undefined, "دکمه‌ی لغوِ غیرمدیر هیچ اثری ندارد و جوابی هم نمی‌دهد");
  sent.length = 0;
  const own = makeCtx(env, { data: "CERT|k|" + batchId });
  await handleCertCallback(own.ctx);
  ok(rows(env).every((x) => x.status === "cancelled") && /۳ مورد لغو شد/.test(own.calls.answer[0].text), "مدیر باقی‌مانده را لغو می‌کند و تعدادش را می‌بیند");
  ok(edits().length === 1 && /لغو شد/.test(edits()[0].text) && edits()[0].reply_markup.inline_keyboard.length === 0, "پیامِ پیشرفت به‌روز می‌شود و دکمه‌ی لغو برداشته می‌شود");
  const again = makeCtx(env, { data: "CERT|k|" + batchId });
  await handleCertCallback(again.ctx);
  ok(/نمانده/.test(again.calls.answer[0].text), "لغوِ دوباره می‌گوید چیزی نمانده");
}
{
  const env = await readyEnv();
  const { ctx, calls } = makeCtx(env, { data: "CERT|k|zzzzzzzzzzzz" });
  await handleCertCallback(ctx);
  ok(calls.edit.length === 0 && calls.answer.length === 1, "شناسه‌ی خراب بی‌سروصدا نادیده گرفته می‌شود");
}
{
  // ورک‌فلو راه نیفتد: مدیر نباید برای همیشه منتظر بماند
  const env = await readyEnv();
  sent.length = 0;
  installFetch((url) => (url.includes("api.github.com") ? new Response("no", { status: 403 }) : jsonRes({ ok: true, result: {} })));
  await handleCert(makeCtx(env, { match: "خانم الف ب\nآقا ج د" }).ctx);
  const r = rows(env);
  ok(r.every((x) => x.status === "failed" && x.error === "dispatch"), "اگر ورک‌فلو راه نیفتد، کلِ دسته همان لحظه شکست‌خورده اعلام می‌شود", r.map((x) => x.status));
  ok(edits().some((e) => /انجام نشد/.test(e.text) && /گیت‌هاب/.test(e.text)), "و پیامِ پیشرفت دلیلش را می‌گوید");
}

// ─── ۷) آپلودِ فایل‌ها از مدیر ─────────────────────────────────
{
  const env = freshEnv();
  const doc = (name, extra = {}) => ({ file_id: "id_" + name, file_size: 4_000_000, file_name: name, mime_type: "image/png", ...extra });
  const s = makeCtx(env, { from: STRANGER, doc: doc("template.png") });
  ok(await handleCertAsset(s.ctx) === false && !(await readAsset(env, "template")), "فایلِ غیرمدیر ذخیره نمی‌شود");
  const o = makeCtx(env, { doc: doc("template.png") });
  ok(await handleCertAsset(o.ctx) === true && (await readAsset(env, "template")).file_id === "id_template.png", "قالبِ مدیر ذخیره می‌شود");
  ok(/هنوز مانده/.test(o.calls.reply[0].t), "و می‌گوید چه چیزی هنوز مانده");
  const x = makeCtx(env, { doc: doc("holiday.pdf") });
  ok(await handleCertAsset(x.ctx) === false && x.calls.reply.length === 0, "فایلِ نامربوط به این مسیر دست نمی‌خورد و جواب هم نمی‌گیرد");
  const bad = makeCtx(env, { doc: doc("template.png", { mime_type: "image/jpeg" }) });
  await handleCertAsset(bad.ctx);
  ok(/PNG/.test(bad.calls.reply[0].t) && (await readAsset(env, "template")).file_id === "id_template.png", "قالبِ غیرِ PNG رد می‌شود و قالبِ قبلی می‌ماند");
  const big = makeCtx(env, { doc: doc("YekanBakh-Light.ttf", { file_size: 30_000_000, mime_type: "font/ttf" }) });
  await handleCertAsset(big.ctx);
  ok(!(await readAsset(env, "label_font")), "فایلِ بزرگ‌تر از ۱۸ مگابایت رد می‌شود");
  await handleCertAsset(makeCtx(env, { doc: doc("YekanBakh-ExtraBlack.ttf", { mime_type: "font/ttf" }) }).ctx);
  const last = makeCtx(env, { doc: doc("YekanBakh-Light.ttf", { mime_type: "font/ttf" }) });
  await handleCertAsset(last.ctx);
  ok((await missingAssets(env)).length === 0 && /آماده/.test(last.calls.reply[0].t), "با سومین فایل همه‌چیز آماده اعلام می‌شود");
}

// ─── ۸) پیامِ پیشرفت ────────────────────────────────────────────
const St = (counts, failed = [], total) => ({
  total: total ?? Object.values(counts).reduce((a, b) => a + b, 0),
  counts: { queued: 0, rendering: 0, done: 0, failed: 0, cancelled: 0, ...counts }, failed,
});
{
  ok(/در حال ساختِ گواهی‌ها: ۳ از ۱۰ ارسال شد/.test(batchText(St({ done: 3, queued: 6, rendering: 1 }))), "در جریان: «۳ از ۱۰ ارسال شد»");
  ok(batchText(St({ done: 10 })) === "✅ هر ۱۰ گواهی ارسال شد.", "همه ارسال شد");
  ok(batchText(St({ done: 1 })) === "✅ گواهی ارسال شد.", "یک گواهی: بدونِ «هر ۱»");
  const t = batchText(St({ done: 8, failed: 2 }, [{ name: "علی رضایی", error: "send" }, { name: "مریم احمدی", error: "render" }]));
  ok(/۸ از ۱۰ گواهی ارسال شد/.test(t) && /علی رضایی — تلگرام عکس را نپذیرفت/.test(t) && /مریم احمدی — خطا در رندر/.test(t), "شکست‌ها با نام و دلیلِ هرکدام در همان پیام می‌آیند", t);
  ok(/دوباره بفرستید/.test(t), "و راهِ ساختنِ دوباره را می‌گوید");
  ok(/۱ مورد لغو شد|✖️ ۱/.test(batchText(St({ done: 2, cancelled: 1 }))), "لغوشده‌ها شمرده می‌شوند");
  ok(/❌ ۱ مورد انجام نشد/.test(batchText(St({ done: 1, failed: 1, queued: 1 }, [{ name: "ا", error: "send" }]))), "در جریان هم تعدادِ شکست‌ها دیده می‌شود");
  const many = batchText(St({ failed: 12 }, Array.from({ length: 12 }, (_, i) => ({ name: "نام" + i, error: "send" }))));
  ok(/و ۲ مورد دیگر/.test(many) && (many.match(/•/g) || []).length === 11, "فهرستِ شکست‌ها از ۱۰ مورد بلند نمی‌شود");
}

// ─── ۹) رساندنِ عکس‌ها پشتِ سرِ هم ──────────────────────────────
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]).buffer;
ok(looksLikePng(PNG) && !looksLikePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer) && !looksLikePng(new ArrayBuffer(3)), "تشخیصِ PNG از امضای ۸ بایتی");

{
  const env = freshEnv();
  sent.length = 0; installFetch(() => jsonRes({ ok: true, result: { message_id: 1 } }));
  const { batchId } = await enq(env);
  const order = [];
  for (let i = 0; i < 3; i++) {
    const job = await claimNext(env);
    const r = await completeJob(env, job.id, PNG, "ok");
    order.push(r.status);
  }
  ok(order.join() === "200,200,200", "هر سه عکس می‌رسد");
  const docs = tg("sendDocument");
  ok(docs.length === 3, "با سه sendDocument (فایل) - نه sendPhoto، که تلگرام فشرده‌اش می‌کند");
  const caps = docs.map((d) => d.body.get("caption"));
  ok(caps[0] === "🎓 سرکار خانم راحیل غلامی" && caps[1] === "🎓 جناب آقای سید محمد سرآبادانی" && caps[2] === "🎓 سرکار خانم فاطمه محمدی", "زیرنویس فقط جنسیت و نام است، بدون «N از M»، به ترتیبِ لیست", caps);
  ok(docs.every((d) => d.body instanceof FormData && d.body.get("chat_id") === "555"), "همه به گفتگوی همان مدیر");
  const f = docs[0].body.get("document");
  ok(f instanceof Blob && f.type === "image/png" && f.size === PNG.byteLength && f.name === "راحیل غلامی.png", "فایلِ PNG با نامِ دانشجو (نه certificate.png) و بایت‌های دست‌نخورده");
  const e = edits();
  ok(e.length === 3 && e.every((x) => x.message_id === 9 && x.chat_id === "555"), "فقط یک پیام به‌روز می‌شود، با هر گواهی یک بار (نه پیامِ جدا برای هر نام)");
  ok(/۱ از ۳ ارسال شد/.test(e[0].text) && /۲ از ۳ ارسال شد/.test(e[1].text) && e[2].text === "✅ هر ۳ گواهی ارسال شد.", "پیشرفتِ «۱ از ۳» ← «۲ از ۳» ← «هر ۳ گواهی ارسال شد»", e.map((x) => x.text));
  ok(e[0].reply_markup.inline_keyboard.length === 1 && e[2].reply_markup.inline_keyboard.length === 0, "دکمه‌ی «لغوِ باقی‌مانده» تا وقتی چیزی مانده هست و در پایان برداشته می‌شود");
  ok((await batchStats(env, batchId)).counts.done === 3, "و هر سه done شد");

  const before = tg("sendDocument").length;
  const job1 = rows(env)[0];
  ok((await completeJob(env, job1.id, PNG)).status === 409 && tg("sendDocument").length === before, "تکرارِ آپلود 409 می‌گیرد و هرگز عکسِ دوم نمی‌فرستد");
}
{
  // تک‌نام: بدونِ «۱ از ۱»
  const env = freshEnv();
  sent.length = 0; installFetch(() => jsonRes({ ok: true }));
  await enq(env, [{ name: "راحیل غلامی", gender: "f" }]);
  await completeJob(env, (await claimNext(env)).id, PNG);
  ok(!/از/.test(tg("sendDocument")[0].body.get("caption")), "زیرنویسِ تک‌نام «از» ندارد");
  ok(edits()[0].text === "✅ گواهی ارسال شد.", "و پیامِ پایانی «گواهی ارسال شد» است");
}
{
  // شکستِ یکی، موفقیتِ بقیه
  const env = freshEnv();
  sent.length = 0;
  let k = 0;
  installFetch((url) => (/sendDocument$/.test(url) && ++k === 2 ? new Response("no", { status: 400 }) : jsonRes({ ok: true })));
  const { batchId } = await enq(env);
  const rs = [];
  for (let i = 0; i < 3; i++) rs.push((await completeJob(env, (await claimNext(env)).id, PNG)).status);
  ok(rs.join() === "200,502,200", "شکستِ یک گواهی بقیه را نمی‌اندازد", rs);
  const st = await batchStats(env, batchId);
  ok(st.counts.done === 2 && st.counts.failed === 1 && st.failed[0].name === "سید محمد سرآبادانی" && st.failed[0].error === "send", "دسته: ۲ انجام، ۱ شکست با نام و دلیل", st);
  const last = edits().at(-1).text;
  ok(/۲ از ۳ گواهی ارسال شد/.test(last) && /سید محمد سرآبادانی — تلگرام عکس را نپذیرفت/.test(last), "پیامِ پایانی دقیقاً می‌گوید کدام نشد", last);
  ok(edits().length === 3, "و باز هم فقط همان یک پیام به‌روز شد - شکست پیامِ جدا نساخت");
}
{
  const env = freshEnv();
  sent.length = 0; installFetch(() => jsonRes({ ok: true }));
  const { ids } = await enq(env, [{ name: "علی رضایی", gender: "m" }]);
  const job = await claimNext(env);
  ok((await completeJob(env, job.id, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).status === 400, "فایلِ غیرِ PNG رد می‌شود");
  ok((await completeJob(env, job.id, new ArrayBuffer(0))).status === 400, "فایلِ خالی رد می‌شود");
  ok((await completeJob(env, "ffffffffffff", PNG)).status === 404, "شناسه‌ی ناموجود 404 است");
  ok(sent.length === 0 && (await getJob(env, ids[0])).status === "rendering", "در این سه حالت هیچ چیزی به تلگرام نمی‌رود و درخواست هنوز منتظرِ عکسِ درست است");
}
{
  // ورک‌فلوی دیررسیده
  const env = freshEnv();
  sent.length = 0; installFetch(() => jsonRes({ ok: true }));
  await enq(env, [{ name: "علی رضایی", gender: "m" }]);
  const job = await claimNext(env);
  await failJob(env, job.id, "timeout");
  const before = tg("sendDocument").length;
  ok((await completeJob(env, job.id, PNG)).status === 409 && tg("sendDocument").length === before, "ورک‌فلوی دیررسیده نمی‌تواند ردیفِ شکست‌خورده را انجام‌شده کند و عکسی نمی‌فرستد");
}
{
  // ردیفِ لغوشده هرگز رندر نمی‌شود، پس عکسش هم نمی‌آید
  const env = freshEnv();
  sent.length = 0; installFetch(() => jsonRes({ ok: true }));
  const { batchId, ids } = await enq(env);
  await cancelBatch(env, batchId, OWNER);
  ok((await completeJob(env, ids[1], PNG)).status === 409 && tg("sendDocument").length === 0, "ردیفِ لغوشده عکس نمی‌گیرد، حتی اگر ورک‌فلو بخواهد بفرستد");
}
{
  const env = freshEnv();
  sent.length = 0; installFetch(() => jsonRes({ ok: true }));
  await enq(env, [{ name: "علی رضایی", gender: "m" }]);
  const job = await claimNext(env);
  await completeJob(env, job.id, PNG, "shrunk");
  ok(/کوچک شد/.test(tg("sendDocument")[0].body.get("caption")), "اگر فونت کوچک شده باشد، مدیر در زیرنویس می‌فهمد");
  const env2 = freshEnv();
  sent.length = 0; installFetch(() => jsonRes({ ok: true }));
  await enq(env2, [{ name: "علی رضایی", gender: "m" }]);
  await completeJob(env2, (await claimNext(env2)).id, PNG, "overflow");
  ok(/جا نمی‌شود/.test(tg("sendDocument")[0].body.get("caption")), "و اگر حتی با کوچک‌ترین اندازه جا نشد، هشدار می‌گیرد");
}
{
  const env = freshEnv();
  sent.length = 0; installFetch(() => jsonRes({ ok: true }));
  await enq(env, [{ name: "علی رضایی", gender: "m" }]);
  const job = await claimNext(env);
  ok(await failJob(env, job.id, "<script>") === true && (await getJob(env, job.id)).error === "other", "کدِ دلخواهِ ورک‌فلو به «other» تبدیل می‌شود - متنِ آزاد منعکس نمی‌شود");
  ok(await failJob(env, job.id, "render") === false, "شکستِ دوباره اثری ندارد");
}

// ─── ۱۰) فایل‌های خصوصی از تلگرام به ورک‌فلو ────────────────────
{
  const env = freshEnv();
  sent.length = 0;
  installFetch((url) => {
    if (/getFile$/.test(url)) return jsonRes({ ok: true, result: { file_path: "documents/file_1.png" } });
    if (/\/file\/bot/.test(url)) return new Response(new Uint8Array([9, 9, 9]), { status: 200, headers: { "content-length": "3" } });
    return jsonRes({ ok: true });
  });
  ok((await streamAsset(env, "template")).status === 404, "فایلِ بارگذاری‌نشده 404 می‌دهد");
  ok((await streamAsset(env, "../../etc/passwd")).status === 400, "نامِ جایگاهِ دلخواه رد می‌شود");
  await saveAsset(env, "template", { file_id: "FID", file_size: 3, file_name: "template.png" });
  const r = await streamAsset(env, "template");
  ok(r.status === 200 && r.headers["content-type"] === "application/octet-stream" && r.headers["cache-control"] === "no-store", "فایل با no-store و octet-stream برمی‌گردد");
  ok(Buffer.from(await new Response(r.body).arrayBuffer()).join() === "9,9,9", "بایت‌ها همان‌طور که از تلگرام آمد می‌رسند");
  ok(sent.some((s) => /getFile$/.test(s.url) && /FID/.test(String(s.body))), "از file_idِ ذخیره‌شده می‌خواند");
}

// ─── ۱۱) جاروی کران ────────────────────────────────────────────
{
  const env = freshEnv();
  sent.length = 0; installFetch(() => jsonRes({ ok: true }));
  const r0 = await sweepIfPending(env, T0);
  ok(r0.skipped === true && sent.length === 0, "روزِ عادی (بدونِ علامت) هیچ‌کاری نمی‌کند و به تلگرام نمی‌زند");
}
{
  const env = freshEnv(ghEnv);
  sent.length = 0; installFetch(ghOk);
  const { batchId } = await enq(env);
  await startRender(env, batchId);
  ok((await readConfig(env, PENDING_FLAG)) === "1", "علامتِ در-جریان روشن است");
  const r = await sweepIfPending(env, T0 + STALE_MS + 60000);
  const st = await batchStats(env, batchId);
  ok(r.failed === 3 && st.counts.failed === 3 && st.failed.every((f) => f.error === "no_runner"), "اگر ورک‌فلو هرگز شروع نکرد، کران بعد از شش دقیقه کلِ دسته را شکست‌خورده می‌کند", st);
  const e = edits();
  ok(e.length === 1 && /شروع نشد/.test(e[0].text), "و مدیر دلیلش را می‌فهمد - با یک پیام برای کلِ دسته، نه سه پیام", e.map((x) => x.text));
  ok((await readConfig(env, PENDING_FLAG)) === "", "و چون چیزی در جریان نمانده، علامت پاک می‌شود");
}
{
  const env = freshEnv();
  sent.length = 0; installFetch(() => jsonRes({ ok: true }));
  const { batchId } = await enq(env);
  await claimNext(env);
  ok(await failLeftovers(env) === 1, "پایانِ ورک‌فلو: هرچه نیمه‌کاره ماند شکست‌خورده شمرده می‌شود");
  ok((await batchStats(env, batchId)).counts.failed === 1 && edits().length === 1, "و پیامِ پیشرفت یک بار به‌روز می‌شود");
}

// ─── ۱۲) هیچ‌چیزِ خصوصی در ریپو نیست ────────────────────────────
//
// ریپو عمومی است و از قبل فونت‌های دیگری هم دارد (IranYekan، FontAwesome)؛
// آن‌ها مجوزِ خودشان را دارند. فقط فونتِ گواهی (Yekan Bakh، متعلق به Fontiran،
// «همه‌ی حقوق محفوظ») و قالب و PSD نباید اینجا باشند.
{
  const root = new URL("../../", import.meta.url).pathname;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.name === "node_modules" || e.name === ".git" ? [] : e.isDirectory() ? walk(d + e.name + "/") : [d + e.name]);
  const files = walk(root);
  const yekanBakh = files.filter((f) => /yekan[-_ ]?bakh/i.test(f));
  ok(yekanBakh.length === 0, "هیچ فایلی از فونتِ Yekan Bakh در ریپوی عمومی نیست", yekanBakh);
  ok(!files.some((f) => /\.psd$/i.test(f)), "PSDِ گواهی در ریپو نیست");
  ok(!files.some((f) => /(^|\/)(scripts\/cert|cert)\/[^/]*template[^/]*\.png$/i.test(f)), "قالبِ بی‌نامِ گواهی در ریپو نیست");
  const wf = fs.readFileSync(root + ".github/workflows/cert-render.yml", "utf8");
  ok(!/^\s+inputs:/m.test(wf), "ورک‌فلوی گواهی ورودی ندارد - نامِ دانشجو در تاریخچه‌ی عمومی نمی‌ماند");
  const loop = fs.readFileSync(root + "scripts/cert/job-loop.mjs", "utf8");
  ok(!/console\.(log|error)\([^)]*job\.name/.test(loop) && !/err\.message/.test(loop.replace(/\/\/.*$/gm, "").replace(/"[^"\n]*err\.message[^"\n]*"/g, "")), "حلقه‌ی ورک‌فلو نام یا متنِ خطا را چاپ نمی‌کند (ممکن است نام را داشته باشد)");
  ok(/MAX_JOBS = 60/.test(loop) && /timeout-minutes: 15/.test(wf), "ظرفیتِ ورک‌فلو برای دو دسته‌ی کامل کافی است (۶۰ گواهی، ۱۵ دقیقه)");
}

// ─── ۱۱) کاربرِ «فقط گواهی» ─────────────────────────────────────
{
  const CERT_ONLY = "6929332443";
  const { isOwner, isCertAdmin, CERT_ONLY_IDS } = await import("../src/owner.js");
  const { CERT_COMMANDS, ADMIN_COMMANDS } = await import("../src/commands/registry.js");
  const fake = (id) => ({ from: { id: Number(id) } });
  ok(CERT_ONLY_IDS.includes(CERT_ONLY) && isCertAdmin(fake(CERT_ONLY)) && isCertAdmin(fake(OWNER)) && !isCertAdmin(fake(STRANGER)), "isCertAdmin: مدیر و کاربرِ گواهی بله، غریبه نه");
  ok(!isOwner(fake(CERT_ONLY)), "ولی کاربرِ گواهی مدیر نیست - بقیه‌ی دسترسی‌های مدیر برایش بسته می‌ماند");
  ok(CERT_COMMANDS.map((c) => c.command).sort().join() === "cert,help,start", "منوی «/» او فقط start، help و cert است");
  ok(ADMIN_COMMANDS.length > CERT_COMMANDS.length, "و منوی مدیر همچنان کامل است");

  const env = await readyEnv();
  const a = makeCtx(env, { from: CERT_ONLY });
  await handleCert(a.ctx);
  ok(a.calls.reply.length === 1 && (await getUserState(env, CERT_ONLY)).current_flow === CERT_FLOW, "/cert برای او کار می‌کند و منتظرِ لیست می‌ماند");
  const b = makeCtx(env, { from: CERT_ONLY, text: "خانم راحیل غلامی\nآقا علی رضایی" });
  await handleCertListText(b.ctx);
  ok(rows(env).length === 2 && rows(env).every((r) => r.owner_id === CERT_ONLY) && dispatches().length >= 1, "لیستش ساخته می‌شود و دسته به نامِ خودش ثبت می‌شود");
  const batchId = rows(env)[0].batch_id;
  const c = makeCtx(env, { from: CERT_ONLY, data: "CERT|k|" + batchId });
  await handleCertCallback(c.ctx);
  ok((await batchStats(env, batchId)).counts.cancelled === 2, "دکمه‌ی لغو برای او کار می‌کند");

  const d = makeCtx(env, { from: CERT_ONLY });
  await handleCertAssets(d.ctx);
  ok(d.calls.reply.length === 0, "/certassets (وضعیتِ فایل‌ها) برایش وجود ندارد");
  const e = makeCtx(env, { from: CERT_ONLY, doc: { file_name: "template.png", file_size: 10, file_id: "x" } });
  ok((await handleCertAsset(e.ctx)) === false && e.calls.reply.length === 0, "و بارگذاریِ قالب و فونت را هم نمی‌تواند بکند");

  const bare = freshEnv();
  const f = makeCtx(bare, { from: CERT_ONLY });
  await handleCert(f.ctx);
  ok(f.calls.reply.length === 1 && /با مدیر/.test(f.calls.reply[0].t) && !/certassets/.test(f.calls.reply[0].t), "اگر فایل‌های گواهی نباشد، فقط می‌گوید با مدیر هماهنگ کند");
}

console.log("\n" + n + " ادعا");
