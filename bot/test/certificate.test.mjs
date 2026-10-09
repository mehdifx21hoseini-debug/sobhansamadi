// گواهیِ دانشجو: نام، چیدمان، صف، و رفتارِ فرمان و دکمه‌ها.
//
// ─── چرا SQLite واقعی ─────────────────────────────────────────────
//
// تست‌های قبلیِ این پروژه دیتابیسِ ساختگی داشتند که خودم نوشته بودم - و
// ساختگی فقط همان چیزی را تأیید می‌کند که من از SQL فرض کرده‌ام. اینجا
// دستورها روی یک SQLiteِ واقعی (همان موتورِ D1) اجرا می‌شوند، پس شرط‌های
// `WHERE status = ...` و `changes` واقعاً آزموده می‌شوند.
//
// ─── آنچه می‌خواهیم ثابت شود ──────────────────────────────────────
//
//   • دو بار زدنِ یک دکمه، دو گواهی نمی‌سازد.
//   • غیرمدیر نه پاسخ می‌گیرد، نه چیزی در دیتابیس عوض می‌کند.
//   • ورک‌فلوی دیررسیده نمی‌تواند درخواستِ شکست‌خورده را «انجام‌شده» کند.
//   • تکرارِ آپلود هرگز عکسِ دوم نمی‌فرستد.
//   • نام از «ي ك» عربی به فارسی برمی‌گردد و ورودیِ بد رد می‌شود.

import { createRequire } from "node:module";
import { normalizeName } from "../src/certificate/name.js";
import {
  createDraft, takeDraft, cancelDraft, claimNext, finishJob, sweep, countActive,
  failAllRendering, getJob, resetCertSchemaMemo, DRAFT_TTL_MS, STALE_MS, KEEP_MS, MAX_ACTIVE,
} from "../src/certificate/store.js";
import {
  slotForFilename, saveAsset, readAsset, missingAssets, completeJob, failJob,
  streamAsset, startRender, sweepIfPending, failLeftovers, looksLikePng, PENDING_FLAG,
} from "../src/certificate/service.js";
import { readConfig } from "../src/content/channel.js";
import { handleCert, handleCertCallback, handleCertAsset } from "../src/commands/cert.js";
import { planLine, REF } from "../../scripts/cert/layout.mjs";
import fs from "node:fs";

let n = 0;
const ok = (c, m, x) => {
  if (!c) { console.log("❌ " + m + (x !== undefined ? " → " + JSON.stringify(x) : "")); process.exitCode = 1; }
  else { console.log("✅ " + m); n++; }
};

const { DatabaseSync } = await import("node:sqlite");

// آداپتورِ D1 روی SQLiteِ واقعی.
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
  };
}
const freshEnv = (extra = {}) => { resetCertSchemaMemo(); return { DB: d1(), BOT_TOKEN: "TEST", ...extra }; };

const OWNER = "6923823275"; // یکی از OWNER_IDS
const STRANGER = "111222333";
const T0 = Date.UTC(2026, 9, 9, 12, 0, 0);

// ─── ۱) نام ─────────────────────────────────────────────────────
{
  const r = normalizeName("  سید   محمد  سرآبادانی ");
  ok(r.ok && r.name === "سید محمد سرآبادانی" && !r.converted, "فاصله‌های اضافه جمع می‌شود", r);
}
{
  // کیبوردِ عربی: «علي» و «كريم»
  const r = normalizeName("علي كريمي");
  ok(r.ok && r.name === "علی کریمی" && r.converted === true, "ي و ك عربی به ی و ک فارسی برمی‌گردد و مدیر باخبر می‌شود", r);
}
{
  const r = normalizeName("فاطمة زهراء");
  ok(r.ok && r.name === "فاطمه زهراء", "ة → ه", r);
}
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

// ─── ۲) چیدمان ──────────────────────────────────────────────────
const layout = JSON.parse(fs.readFileSync(new URL("../../scripts/cert/layout.json", import.meta.url), "utf8"));
// اندازه‌ی جوهر در ۱۰۰ پیکسل، از اندازه‌گیریِ واقعیِ Chromium با فونت‌های آکادمی:
// نام «راحیل غلامی» ۷۸۰ در ۱۷۲٫۲ و برچسب «سرکار خانم» ۵۸۵ در ۱۳۳٫۹.
const nameRef = { abl: 0, abr: (780 / 172.2) * REF };
const labelRef = { abl: 0, abr: (585 / 133.9) * REF };
{
  const p = planLine(labelRef, nameRef, layout);
  ok(p.fit === "ok" && p.nameScale === 1, "نامِ معمولی بدونِ کوچک شدن جا می‌شود", p);
  const center = p.name.inkLeft + p.totalWidth / 2;
  ok(Math.abs(center - layout.centerX) < 0.01, "وسطِ خط روی centerX می‌نشیند");
  ok(p.label.inkLeft > p.name.inkLeft, "برچسب سمتِ راستِ نام است (خطِ راست‌به‌چپ)");
  ok(Math.abs(p.label.inkLeft - (p.name.inkLeft + p.name.width) - layout.gapPx) < 0.01, "فاصله‌ی جوهر تا جوهر همان gapPx است");
  ok(p.name.inkLeft + p.totalWidth <= layout.canvas.width, "خط از بوم بیرون نمی‌زند");
}
{
  const long = { abl: 0, abr: (1900 / 172.2) * REF };
  const p = planLine(labelRef, long, layout);
  ok(p.fit === "shrunk" && p.nameScale < 1 && p.nameScale >= layout.fit.minScale, "نامِ بلند کوچک می‌شود، نه بیرون می‌زند", p);
  ok(p.totalWidth <= layout.fit.maxWidthPx + 0.5, "و بعد از کوچک شدن در عرضِ مجاز است", p.totalWidth);
}
{
  const absurd = { abl: 0, abr: (9000 / 172.2) * REF };
  const p = planLine(labelRef, absurd, layout);
  ok(p.fit === "overflow" && p.nameScale === layout.fit.minScale, "نامِ بی‌نهایت بلند به کفِ اندازه می‌رسد و overflow اعلام می‌شود", p);
}
{
  const a = planLine(labelRef, nameRef, layout), b = planLine({ abl: 0, abr: labelRef.abr * 0.9 }, nameRef, layout);
  ok(a.name.inkLeft !== b.name.inkLeft, "برچسبِ کوتاه‌تر (جناب آقای) خط را دوباره وسط‌چین می‌کند");
}

// ─── ۳) صف روی SQLiteِ واقعی ────────────────────────────────────
{
  const env = freshEnv();
  const id = await createDraft(env, OWNER, "علی رضایی", T0);
  ok(/^[0-9a-f]{12}$/.test(id), "شناسه ۱۲ رقمِ هگز است", id);
  ok(Buffer.byteLength("CERT|m|" + id) <= 64, "callback_data زیرِ سقفِ ۶۴ بایتِ تلگرام است");
  ok((await getJob(env, id)).status === "draft", "پیش‌نویس با وضعیتِ draft ساخته می‌شود");

  const wrong = await takeDraft(env, { id, ownerId: STRANGER, gender: "f", chatId: "1", messageId: 5, now: T0 + 1000 });
  ok(wrong.ok === false && wrong.why === "owner", "کسِ دیگر نمی‌تواند پیش‌نویسِ مدیر را به صف ببرد", wrong);
  ok((await getJob(env, id)).status === "draft", "و پیش‌نویس دست‌نخورده می‌ماند");

  const t1 = await takeDraft(env, { id, ownerId: OWNER, gender: "f", chatId: "1", messageId: 5, now: T0 + 1000 });
  ok(t1.ok && t1.job.status === "queued" && t1.job.gender === "f", "مالک پیش‌نویس را با جنسیت به صف می‌برد", t1);
  const t2 = await takeDraft(env, { id, ownerId: OWNER, gender: "m", chatId: "1", messageId: 5, now: T0 + 2000 });
  ok(t2.ok === false && t2.why === "gone", "زدنِ دوباره‌ی دکمه رد می‌شود", t2);
  ok((await getJob(env, id)).gender === "f", "و جنسیتِ ثبت‌شده با دکمه‌ی دوم عوض نمی‌شود");
}
{
  const env = freshEnv();
  const id = await createDraft(env, OWNER, "علی", T0);
  const late = await takeDraft(env, { id, ownerId: OWNER, gender: "m", chatId: "1", messageId: 1, now: T0 + DRAFT_TTL_MS + 1000 });
  ok(late.ok === false && late.why === "expired", "پیش‌نویسِ کهنه‌تر از ۱۵ دقیقه منقضی است", late);
  ok((await takeDraft(env, { id: "ffffffffffff", ownerId: OWNER, gender: "m", chatId: "1", messageId: 1, now: T0 })).why === "gone", "شناسه‌ی ناموجود → gone");
}
{
  const env = freshEnv();
  const id = await createDraft(env, OWNER, "علی", T0);
  ok(await cancelDraft(env, id, STRANGER, T0) === false, "کسِ دیگر نمی‌تواند لغو کند");
  ok(await cancelDraft(env, id, OWNER, T0) === true, "مالک لغو می‌کند");
  ok((await takeDraft(env, { id, ownerId: OWNER, gender: "m", chatId: "1", messageId: 1, now: T0 })).ok === false, "پیش‌نویسِ لغوشده به صف نمی‌رود");
}
{
  const env = freshEnv();
  const mk = async (name, at) => {
    const id = await createDraft(env, OWNER, name, at);
    await takeDraft(env, { id, ownerId: OWNER, gender: "m", chatId: "1", messageId: 1, now: at });
    return id;
  };
  const a = await mk("اول", T0), b = await mk("دوم", T0 + 5000);
  const c1 = await claimNext(env, T0 + 6000), c2 = await claimNext(env, T0 + 6000), c3 = await claimNext(env, T0 + 6000);
  ok(c1.id === a && c2.id === b, "قدیمی‌ترین اول برداشته می‌شود (FIFO)", [c1 && c1.id, c2 && c2.id]);
  ok(c3 === null, "هر درخواست دقیقاً یک بار برداشته می‌شود");
  ok(c1.status === "rendering", "وضعیتِ برداشته‌شده rendering است");
  ok(await countActive(env) === 2, "countActive درخواست‌های در جریان را می‌شمارد");

  ok(await finishJob(env, a, "done", null, T0 + 7000) === true, "done از rendering ممکن است");
  ok(await finishJob(env, a, "done", null, T0 + 8000) === false, "done دوباره اثری ندارد");
  ok(await finishJob(env, a, "failed", "x", T0 + 9000) === false, "درخواستِ انجام‌شده را نمی‌شود شکست‌خورده کرد");
  ok((await getJob(env, a)).status === "done", "و وضعیتش done می‌ماند");
}
{
  const env = freshEnv();
  const id = await createDraft(env, OWNER, "علی", T0);
  await takeDraft(env, { id, ownerId: OWNER, gender: "m", chatId: "1", messageId: 1, now: T0 });
  ok(await finishJob(env, id, "done", null, T0 + 1) === false, "done از queued ممکن نیست - عکسی رندر نشده");
}
{
  // جاروی گیرکرده‌ها و پاک‌سازیِ داده‌ی شخصی
  const env = freshEnv();
  const take = async (name, at) => {
    const id = await createDraft(env, OWNER, name, at);
    await takeDraft(env, { id, ownerId: OWNER, gender: "m", chatId: "1", messageId: 1, now: at });
    return id;
  };
  const stuckQueued = await take("منتظر", T0);
  const stuckRendering = await take("درحال", T0);
  await claimNext(env, T0 + 10); // قدیمی‌ترینِ queued را به rendering می‌برد
  const fresh = await take("تازه", T0 + STALE_MS - 1000);
  const r = await sweep(env, T0 + STALE_MS + 5000);
  const codes = Object.fromEntries(r.stale.map((j) => [j.id, j.error]));
  ok(r.stale.length === 2, "هر دو درخواستِ گیرکرده شکست‌خورده اعلام شدند", r.stale.length);
  ok(Object.values(codes).sort().join() === "no_runner,timeout", "دلیلشان با وضعیتِ قبلی می‌خواند (شروع نشد / طول کشید)", codes);
  ok((await getJob(env, fresh)).status === "queued", "درخواستِ تازه دست‌نخورده می‌ماند");
  void stuckQueued; void stuckRendering;
}
{
  const env = freshEnv();
  const old = await createDraft(env, OWNER, "قدیمی", T0 - KEEP_MS - 5000);
  await takeDraft(env, { id: old, ownerId: OWNER, gender: "m", chatId: "1", messageId: 1, now: T0 - KEEP_MS - 5000 });
  await claimNext(env, T0 - KEEP_MS - 4000);
  await finishJob(env, old, "done", null, T0 - KEEP_MS - 3000);
  const young = await createDraft(env, OWNER, "تازه", T0);
  const staleDraft = await createDraft(env, OWNER, "پیش‌نویسِ کهنه", T0 - 2 * 86400000);
  const r = await sweep(env, T0);
  ok(r.purged === 2, "نامِ انجام‌شده‌ی بیش از ۳۰ روز و پیش‌نویسِ بیش از یک روز پاک می‌شود", r);
  ok((await getJob(env, old)) === null && (await getJob(env, staleDraft)) === null, "هر دو رفتند");
  ok((await getJob(env, young)) !== null, "و پیش‌نویسِ تازه ماند");
}
{
  const env = freshEnv();
  const id = await createDraft(env, OWNER, "علی", T0);
  await takeDraft(env, { id, ownerId: OWNER, gender: "m", chatId: "1", messageId: 1, now: T0 });
  await claimNext(env, T0);
  const left = await failAllRendering(env, T0 + 1);
  ok(left.length === 1 && (await getJob(env, id)).status === "failed", "failAllRendering هرچه نیمه‌کاره مانده را شکست‌خورده می‌کند");
}

// ─── ۴) فایل‌های خصوصی ───────────────────────────────────────────
ok(slotForFilename("template.png") === "template", "template.png → قالب");
ok(slotForFilename("Template.PNG") === "template", "بزرگیِ حروف مهم نیست");
ok(slotForFilename("YekanBakh-ExtraBlack.ttf") === "name_font", "ExtraBlack → فونتِ اسم");
ok(slotForFilename("YekanBakh-Light.ttf") === "label_font", "Light → فونتِ برچسب");
ok(slotForFilename("YekanBakh-Black.ttf") === null, "Black و بقیه‌ی وزن‌ها گواهی نیستند");
ok(slotForFilename("YekanBakh-Bold.ttf") === null && slotForFilename("YekanBakh-Thin.ttf") === null, "Bold/Thin هم نه");
ok(slotForFilename("photo.png") === null && slotForFilename("") === null && slotForFilename(undefined) === null, "فایلِ نامربوط شناخته نمی‌شود");
ok(slotForFilename("template.png.exe") === null, "پسوندِ جعلی شناخته نمی‌شود");

// ─── ۵) ساختِ ctx و fetchِ ساختگی ─────────────────────────────
const sent = []; // هر درخواستِ بیرونی
function installFetch(handler) {
  globalThis.fetch = async (url, init = {}) => {
    sent.push({ url: String(url), method: init.method, body: init.body });
    return handler(String(url), init);
  };
}
const jsonRes = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

function makeCtx(env, { from = OWNER, match = "", data, doc } = {}) {
  const calls = { reply: [], answer: [], edit: [], editMarkup: [] };
  const ctx = {
    env,
    from: { id: Number(from) },
    match,
    message: doc ? { document: doc } : undefined,
    callbackQuery: data ? { data, message: { chat: { id: Number(from) }, message_id: 77 } } : undefined,
    reply: async (t, o) => { calls.reply.push({ t, o }); },
    answerCallbackQuery: async (o) => { calls.answer.push(o); },
    editMessageText: async (t, o) => { calls.edit.push({ t, o }); },
    editMessageReplyMarkup: async (o) => { calls.editMarkup.push(o); },
  };
  return { ctx, calls };
}

async function loadAssets(env) {
  for (const [slot, file] of [["template", "template.png"], ["name_font", "YekanBakh-ExtraBlack.ttf"], ["label_font", "YekanBakh-Light.ttf"]]) {
    await saveAsset(env, slot, { file_id: "fid_" + slot, file_size: 1234, file_name: file });
  }
}

// ─── ۶) فرمانِ /cert ─────────────────────────────────────────────
{
  const env = freshEnv();
  await loadAssets(env);
  const { ctx, calls } = makeCtx(env, { from: STRANGER, match: "علی رضایی" });
  await handleCert(ctx);
  ok(calls.reply.length === 0, "برای غیرمدیر هیچ پاسخی نیست - انگار فرمان وجود ندارد");
  // برای غیرمدیر حتی جدول هم ساخته نمی‌شود - قوی‌تر از «صفر ردیف».
  const table = env.DB.raw.prepare("SELECT name FROM sqlite_master WHERE name = 'cert_jobs'").get();
  ok(!table || env.DB.raw.prepare("SELECT COUNT(*) AS n FROM cert_jobs").get().n === 0, "و به دیتابیس دست نمی‌زند");
}
{
  const env = freshEnv();
  const { ctx, calls } = makeCtx(env, { match: "علی رضایی" });
  await handleCert(ctx);
  ok(calls.reply.length === 1 && /هنوز کامل بارگذاری نشده/.test(calls.reply[0].t), "بدونِ فایل‌های گواهی، دکمه نمی‌دهد و می‌گوید چه چیزی کم است");
  ok(!calls.reply[0].o || !calls.reply[0].o.reply_markup, "و دکمه‌ای نشان نمی‌دهد");
  ok(/template\.png/.test(calls.reply[0].t) && /ExtraBlack/.test(calls.reply[0].t) && /Light/.test(calls.reply[0].t), "نامِ سه فایل را می‌گوید");
}
{
  const env = freshEnv();
  await loadAssets(env);
  const { ctx, calls } = makeCtx(env, { match: "علي كريمي" });
  await handleCert(ctx);
  const r = calls.reply[0];
  ok(/«علی کریمی»/.test(r.t) && /تبدیل شد/.test(r.t), "نامِ پاک‌سازی‌شده نشان داده می‌شود و تبدیلِ حروفِ عربی اعلام می‌شود", r.t);
  const btns = r.o.reply_markup.inline_keyboard.flat();
  const m = btns.find((b) => /^CERT\|m\|/.test(b.callback_data)), f = btns.find((b) => /^CERT\|f\|/.test(b.callback_data));
  ok(m && f && /آقای/.test(m.text) && /خانم/.test(f.text), "دو دکمه: جناب آقای و سرکار خانم");
  ok(btns.some((b) => /^CERT\|x\|/.test(b.callback_data)), "و دکمه‌ی لغو");
  ok(btns.every((b) => Buffer.byteLength(b.callback_data) <= 64), "همه‌ی callback_dataها در سقفِ تلگرام‌اند");
  const row = await env.DB.raw.prepare("SELECT name, status, owner_id FROM cert_jobs").get();
  ok(row.name === "علی کریمی" && row.status === "draft" && row.owner_id === OWNER, "پیش‌نویس با نامِ پاک‌سازی‌شده ذخیره می‌شود");
}
{
  const env = freshEnv();
  await loadAssets(env);
  const { ctx, calls } = makeCtx(env, { match: "Ali" });
  await handleCert(ctx);
  ok(/لاتین/.test(calls.reply[0].t) && !(calls.reply[0].o || {}).reply_markup, "نامِ نامعتبر رد می‌شود، با دلیل و بی‌دکمه");
  const none = makeCtx(env, { match: "" });
  await handleCert(none.ctx);
  ok(/\/cert /.test(none.calls.reply[0].t), "بدونِ نام، راهنمای استفاده می‌دهد");
}
{
  const env = freshEnv();
  await loadAssets(env);
  for (let i = 0; i < MAX_ACTIVE; i++) {
    const id = await createDraft(env, OWNER, "نام " + "ا".repeat(i + 2));
    await takeDraft(env, { id, ownerId: OWNER, gender: "m", chatId: "1", messageId: 1 });
  }
  const { ctx, calls } = makeCtx(env, { match: "علی" });
  await handleCert(ctx);
  ok(/در حال ساختن/.test(calls.reply[0].t), "وقتی چند گواهی در جریان است، درخواستِ تازه صبر می‌خواهد");
}

// ─── ۷) دکمه‌ها ─────────────────────────────────────────────────
const ghOk = (url) =>
  url.includes("api.github.com") ? new Response(null, { status: 204 }) : jsonRes({ ok: true, result: {} });
async function draftFor(env, name = "علی رضایی") { return createDraft(env, OWNER, name); }

{
  const env = freshEnv({ GITHUB_DISPATCH_TOKEN: "t", GITHUB_REPO: "o/r", GITHUB_REF_NAME: "main" });
  sent.length = 0; installFetch(ghOk);
  const id = await draftFor(env);
  const { ctx, calls } = makeCtx(env, { from: STRANGER, data: "CERT|f|" + id });
  await handleCertCallback(ctx);
  ok((await getJob(env, id)).status === "draft", "دکمه‌ی غیرمدیر هیچ اثری ندارد");
  ok(calls.edit.length === 0 && sent.length === 0, "نه پیامی عوض می‌شود و نه ورک‌فلویی راه می‌افتد");
  ok(calls.answer.length === 1 && !calls.answer[0], "فقط دکمه خنثی می‌شود - بی‌هیچ متنی");
}
{
  const env = freshEnv({ GITHUB_DISPATCH_TOKEN: "t", GITHUB_REPO: "o/r", GITHUB_REF_NAME: "main" });
  sent.length = 0; installFetch(ghOk);
  const id = await draftFor(env);
  const { ctx, calls } = makeCtx(env, { data: "CERT|f|" + id });
  await handleCertCallback(ctx);
  const job = await getJob(env, id);
  ok(job.status === "queued" && job.gender === "f" && job.chat_id === String(OWNER) && job.message_id === 77, "زدنِ «سرکار خانم» درخواست را با جنسیت و پیامِ وضعیت به صف می‌برد", job);
  ok(/در حال ساخت/.test(calls.edit[0].t) && /سرکار خانم/.test(calls.edit[0].t), "پیام به «در حال ساخت» عوض می‌شود");
  ok(calls.edit[0].o.reply_markup.inline_keyboard.length === 0, "و دکمه‌ها برداشته می‌شوند تا دوباره زده نشوند");
  const gh = sent.filter((s) => s.url.includes("api.github.com"));
  ok(gh.length === 1 && /cert-render\.yml\/dispatches$/.test(gh[0].url), "ورک‌فلوی cert-render دقیقاً یک بار راه می‌افتد", gh.map((g) => g.url));
  ok(!JSON.stringify(gh[0].body).includes("علی"), "و نامِ دانشجو در درخواستِ گیت‌هاب نیست - ریپو عمومی است", gh[0].body);
  ok((await readConfig(env, PENDING_FLAG)) === "1", "علامتِ «کار در جریان» برای جاروی کران گذاشته می‌شود");

  // دوباره زدنِ همان دکمه
  const again = makeCtx(env, { data: "CERT|m|" + id });
  const before = sent.length;
  await handleCertCallback(again.ctx);
  ok(sent.length === before, "دوباره زدنِ دکمه ورک‌فلوی دوم راه نمی‌اندازد");
  ok(/قبلاً/.test(again.calls.answer[0].text), "و می‌گوید قبلاً انجام شده");
  ok((await getJob(env, id)).gender === "f", "و جنسیتِ ثبت‌شده عوض نمی‌شود");
}
{
  const env = freshEnv({ GITHUB_DISPATCH_TOKEN: "t", GITHUB_REPO: "o/r", GITHUB_REF_NAME: "main" });
  sent.length = 0; installFetch(ghOk);
  const id = await draftFor(env);
  const { ctx, calls } = makeCtx(env, { data: "CERT|x|" + id });
  await handleCertCallback(ctx);
  ok((await getJob(env, id)).status === "cancelled" && sent.length === 0, "لغو: درخواست لغو می‌شود و چیزی راه نمی‌افتد");
  ok(/لغو/.test(calls.edit[0].t), "و پیام «لغو شد» می‌شود");
}
{
  // ورک‌فلو راه نیفتد: مدیر نباید برای همیشه منتظر بماند.
  const env = freshEnv({ GITHUB_DISPATCH_TOKEN: "t", GITHUB_REPO: "o/r", GITHUB_REF_NAME: "main" });
  sent.length = 0;
  installFetch((url) => (url.includes("api.github.com") ? new Response("no", { status: 403 }) : jsonRes({ ok: true, result: {} })));
  const id = await draftFor(env);
  const { ctx } = makeCtx(env, { data: "CERT|m|" + id });
  await handleCertCallback(ctx);
  const job = await getJob(env, id);
  ok(job.status === "failed" && job.error === "dispatch", "اگر ورک‌فلو راه نیفتد، درخواست همان لحظه شکست‌خورده اعلام می‌شود", job);
  const tg = sent.filter((s) => s.url.includes("api.telegram.org"));
  ok(tg.some((s) => /editMessageText/.test(s.url) && /انجام نشد/.test(String(s.body))), "و پیامِ وضعیتِ مدیر به «انجام نشد» عوض می‌شود");
}
{
  const env = freshEnv();
  const { ctx, calls } = makeCtx(env, { data: "CERT|f|not-a-valid-id" });
  await handleCertCallback(ctx);
  ok(calls.edit.length === 0 && calls.answer.length === 1, "شناسه‌ی خراب بی‌سروصدا نادیده گرفته می‌شود");
}

// ─── ۸) آپلودِ فایل‌ها از مدیر ─────────────────────────────────
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

// ─── ۹) رساندنِ عکس ─────────────────────────────────────────────
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]).buffer;
async function renderingJob(env, name = "راحیل غلامی", gender = "f") {
  const id = await createDraft(env, OWNER, name);
  await takeDraft(env, { id, ownerId: OWNER, gender, chatId: "555", messageId: 9 });
  await claimNext(env);
  return id;
}
ok(looksLikePng(PNG) && !looksLikePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer) && !looksLikePng(new ArrayBuffer(3)), "تشخیصِ PNG از امضای ۸ بایتی");

{
  const env = freshEnv();
  sent.length = 0; installFetch(() => jsonRes({ ok: true, result: { message_id: 1 } }));
  const id = await renderingJob(env);
  const r = await completeJob(env, id, PNG, "ok");
  ok(r.status === 200 && (await getJob(env, id)).status === "done", "عکس می‌رسد و درخواست done می‌شود", r);
  const doc = sent.find((s) => /sendDocument$/.test(s.url));
  ok(!!doc, "با sendDocument فرستاده می‌شود، نه sendPhoto - عکس را تلگرام فشرده می‌کند");
  const form = doc.body;
  ok(form instanceof FormData && form.get("chat_id") === "555", "به گفتگوی همان مدیر");
  const file = form.get("document");
  ok(file instanceof Blob && file.type === "image/png" && file.size === PNG.byteLength && file.name === "certificate.png", "فایل PNG با نامِ certificate.png و بایت‌های دست‌نخورده");
  ok(/سرکار خانم راحیل غلامی/.test(form.get("caption")), "زیرنویس جنسیت و نام را دارد");
  ok(sent.some((s) => /editMessageText$/.test(s.url) && /ارسال شد/.test(String(s.body))), "و پیامِ وضعیت به «ارسال شد» عوض می‌شود");

  const before = sent.filter((s) => /sendDocument$/.test(s.url)).length;
  const dup = await completeJob(env, id, PNG, "ok");
  ok(dup.status === 409, "تکرارِ آپلود 409 می‌گیرد", dup);
  ok(sent.filter((s) => /sendDocument$/.test(s.url)).length === before, "و هرگز عکسِ دوم نمی‌فرستد");
}
{
  const env = freshEnv();
  sent.length = 0; installFetch(() => jsonRes({ ok: true }));
  const id = await renderingJob(env, "علی", "m");
  ok((await completeJob(env, id, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).status === 400, "فایلِ غیرِ PNG رد می‌شود");
  ok((await completeJob(env, id, new ArrayBuffer(0))).status === 400, "فایلِ خالی رد می‌شود");
  ok((await completeJob(env, "ffffffffffff", PNG)).status === 404, "شناسه‌ی ناموجود 404 است");
  ok(sent.length === 0, "و در این سه حالت هیچ چیزی به تلگرام نمی‌رود");
  ok((await getJob(env, id)).status === "rendering", "درخواست هنوز منتظرِ عکسِ درست است");
}
{
  const env = freshEnv();
  sent.length = 0; installFetch(() => { throw new Error("network"); });
  const id = await renderingJob(env);
  const r = await completeJob(env, id, PNG);
  ok(r.status === 502 && (await getJob(env, id)).status === "failed" && (await getJob(env, id)).error === "send", "اگر تلگرام عکس را نگرفت، درخواست شکست‌خورده با دلیلِ send است", r);
}
{
  // ورک‌فلوی دیررسیده: درخواست از قبل شکست‌خورده اعلام شده بود
  const env = freshEnv();
  sent.length = 0; installFetch(() => jsonRes({ ok: true }));
  const id = await renderingJob(env);
  await failJob(env, id, "timeout");
  const r = await completeJob(env, id, PNG);
  ok(r.status === 409 && !sent.some((s) => /sendDocument$/.test(s.url)), "ورک‌فلوی دیررسیده نمی‌تواند درخواستِ شکست‌خورده را انجام‌شده کند و عکسی نمی‌فرستد");
}
{
  const env = freshEnv();
  sent.length = 0; installFetch(() => jsonRes({ ok: true }));
  const id = await renderingJob(env);
  await completeJob(env, id, PNG, "shrunk");
  ok(/کوچک شد/.test(sent.find((s) => /sendDocument$/.test(s.url)).body.get("caption")), "اگر فونت کوچک شده باشد، مدیر در زیرنویس می‌فهمد");
}
{
  const env = freshEnv();
  sent.length = 0; installFetch(() => jsonRes({ ok: true }));
  const id = await renderingJob(env);
  await completeJob(env, id, PNG, "overflow");
  ok(/جا نمی‌شود/.test(sent.find((s) => /sendDocument$/.test(s.url)).body.get("caption")), "و اگر حتی با کوچک‌ترین اندازه جا نشد، هشدار می‌گیرد");
}
{
  const env = freshEnv();
  sent.length = 0; installFetch(() => jsonRes({ ok: true }));
  const id = await renderingJob(env);
  ok(await failJob(env, id, "<script>") === true && (await getJob(env, id)).error === "other", "کدِ دلخواهِ ورک‌فلو به «other» تبدیل می‌شود - متنِ آزاد منعکس نمی‌شود");
  ok(await failJob(env, id, "render") === false, "شکستِ دوباره اثری ندارد");
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
  const env = freshEnv({ GITHUB_DISPATCH_TOKEN: "t", GITHUB_REPO: "o/r", GITHUB_REF_NAME: "main" });
  sent.length = 0; installFetch(ghOk);
  const id = await createDraft(env, OWNER, "علی رضایی", T0);
  await takeDraft(env, { id, ownerId: OWNER, gender: "m", chatId: "555", messageId: 4, now: T0 });
  await startRender(env, await getJob(env, id));
  ok((await readConfig(env, PENDING_FLAG)) === "1", "علامتِ در-جریان روشن است");
  const r = await sweepIfPending(env, T0 + STALE_MS + 60000);
  const job = await getJob(env, id);
  ok(r.failed === 1 && job.status === "failed" && job.error === "no_runner", "اگر ورک‌فلو هرگز شروع نکرد، کران بعد از شش دقیقه درخواست را شکست‌خورده می‌کند", job);
  ok(sent.some((s) => /editMessageText$/.test(s.url) && /شروع نشد/.test(String(s.body))), "و مدیر دلیلش را می‌فهمد");
  ok((await readConfig(env, PENDING_FLAG)) === "", "و چون چیزی در جریان نمانده، علامت پاک می‌شود");
}
{
  const env = freshEnv();
  sent.length = 0; installFetch(() => jsonRes({ ok: true }));
  const id = await renderingJob(env);
  const n1 = await failLeftovers(env);
  ok(n1 === 1 && (await getJob(env, id)).status === "failed", "پایانِ ورک‌فلو: هرچه نیمه‌کاره ماند شکست‌خورده و اعلام می‌شود");
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
}

console.log("\n" + n + " ادعا");
