// ثبتِ دسته‌ای برای پیام‌های روزانه - روی SQLiteِ واقعی.
//
// ─── چه چیزی را می‌سنجد ─────────────────────────────────────────
//
// ۸ نوامبر: ۸۵٪ نوشتنِ D1 از claimِ تک‌به‌تکِ خلاصه‌ی صبح بود. ثبتِ
// دسته‌ای آن را برمی‌دارد. این تست ثابت می‌کند که با برداشتنش:
//
//   ۱. هیچ‌کس دو بار نمی‌گیرد - حتی وقتی شش کارگرِ شاردشده و کارگرِ
//      بی‌شارد هم‌زمان کار می‌کنند.
//   ۲. هیچ‌کس جا نمی‌ماند - حتی وقتی تلگرام وسطِ دسته قطع می‌شود، یا
//      ورکر وسطِ دسته می‌میرد.
//   ۳. نوشتن واقعاً کم شده: هیچ UPDATEِ sent_digest برای عکسِ اول.
//   ۴. تازه‌وارد بعد از عکسِ اول هنوز پیامش را می‌گیرد، فقط یک بار.

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
  const tick = () => new Promise((r) => setImmediate(r));
  const api = {
    raw: db, log,
    prepare(sql) {
      const st = { _a: [] };
      st.bind = (...a) => { st._a = a; return st; };
      // یک تیک پیش از هر کوئری: کارگرهای هم‌زمان واقعاً در هم می‌روند.
      st.run = async () => { await tick(); log.push(sql); const r = db.prepare(sql).run(...st._a); return { meta: { changes: Number(r.changes) } }; };
      st.first = async () => { await tick(); log.push(sql); return db.prepare(sql).get(...st._a) || null; };
      st.all = async () => { await tick(); log.push(sql); return { results: db.prepare(sql).all(...st._a) }; };
      return st;
    },
  };
  return api;
}

const sent = [];
let failAt = -1; // شماره‌ی ارسالی که شبکه‌اش قطع می‌شود
let calls = 0;
globalThis.fetch = async (url, init) => {
  calls++;
  if (calls === failAt) throw new Error("subrequest limit");
  const body = JSON.parse(init.body);
  sent.push(String(body.chat_id));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
};
// مکث‌های هر بیست پیام در تست بی‌معنی‌اند.
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => realTimeout(fn, Math.min(ms, 1), ...a);

const NOW = new Date("2026-11-09T04:30:00.000Z");
const REF = digestRef(NOW);

async function setup(count) {
  resetSnapshotMemo();
  const DB = d1();
  DB.raw.exec(`CREATE TABLE user_state (
    telegram_user_id TEXT PRIMARY KEY, current_flow TEXT, current_step TEXT, temp_data TEXT, phone TEXT,
    intro_progress INTEGER DEFAULT 0, source_first_seen TEXT, last_interaction_at TEXT, blocked_at TEXT)`);
  const env = { DB, BOT_TOKEN: "TEST" };
  await writeConfig(env, "econ_worker_sender", "on");
  const { ensureSubscriberSchema } = await import("../src/econ/subscribers.js");
  await ensureSubscriberSchema(env);
  await ensureSentSchema(env);
  const ins = DB.raw.prepare("INSERT INTO user_state (telegram_user_id) VALUES (?)");
  for (let i = 0; i < count; i++) ins.run(String(500000 + i * 13));
  sent.length = 0; calls = 0; failAt = -1;
  return env;
}
const dupes = () => sent.length - new Set(sent).size;
const claimWrites = (env, from = 0) => env.DB.log.slice(from).filter((q) => /UPDATE user_state SET sent_digest/i.test(q)).length;

async function drainAll(env, at = NOW, rounds = 200) {
  // شش کارگرِ ورک‌فلو و کرانِ بی‌شارد، هم‌زمان، تا وقتی کاری مانده.
  for (let i = 0; i < rounds; i++) {
    const rs = await Promise.all([
      ...[0, 1, 2, 3, 4, 5].map((s) => runDailyDigest(env, at, { of: 6, index: s })),
      runDailyDigest(env, at, null),
      runDailyDigest(env, at, null),
    ]);
    if (rs.every((r) => (r.sent || 0) + (r.failed || 0) + (r.blocked || 0) === 0 && !r.stopped)) return i;
  }
  return -1;
}

// ─── ۱) هم‌زمانی: همه یک بار، بی‌claimِ تک‌به‌تک ───────────────────
{
  const env = await setup(2000);
  const from = env.DB.log.length;
  const r = await drainAll(env);
  ok(r >= 0, "درِینِ هم‌زمان تمام می‌شود", r);
  ok(new Set(sent).size === 2000, "همه‌ی ۲۰۰۰ نفر پیام گرفتند", new Set(sent).size);
  ok(dupes() === 0, "هیچ‌کس دو بار نگرفت (۶ شارد + ۲ کارگرِ بی‌شارد هم‌زمان)", dupes());
  ok(claimWrites(env, from) === 0, "هیچ UPDATEِ sent_digest زده نشد", claimWrites(env, from));
  const cfgWrites = env.DB.log.slice(from).filter((q) => /^\s*(UPDATE|INSERT)[^]*bot_config/i.test(q) && /econ_bat_|value = \?/i.test(q)).length;
  ok(cfgWrites < 2000 / 10, "نوشتنِ برگه‌ها خیلی کمتر از یکی برای هر نفر است", cfgWrites);
}

// ─── ۲) تلگرام وسطِ دسته قطع می‌شود ────────────────────────────────
{
  const env = await setup(300);
  failAt = 17; // هفدهمین ارسال
  const r1 = await runDailyDigest(env, NOW, { of: 6, index: 2 });
  ok(r1.stopped === true && r1.done === false, "قطع وسطِ دسته: stopped و نه done", r1);
  const r = await drainAll(env);
  ok(r >= 0 && new Set(sent).size === 300, "بقیه‌ی دسته در دورهای بعد رفت - کسی جا نماند", new Set(sent).size);
  ok(dupes() === 0, "و کسی دو بار نگرفت", dupes());
}

// ─── ۳) ورکر وسطِ دسته می‌میرد (دسته در inf می‌ماند) ───────────────
{
  const env = await setup(600);
  // دورِ اولِ شارد ۱ را انجام می‌دهیم، بعد برگه را دستی به حالتی می‌بریم
  // که یک دسته رزرو شده ولی هرگز تمام نشده.
  await runDailyDigest(env, NOW, { of: 6, index: 1 });
  const key = "econ_bat_digest_" + REF + "_1";
  const st = JSON.parse(await readConfig(env, key));
  const snap = JSON.parse(await readConfig(env, "econ_aud_digest_" + REF)).ids.split(",");
  const mine = snap.filter((id) => Number(id) % 6 === 1);
  const after = mine.filter((id) => id > st.c);
  const lost = after.slice(0, 10);
  st.inf.push({ a: st.c, z: lost[lost.length - 1], t: NOW.getTime() });
  st.c = lost[lost.length - 1];
  await writeConfig(env, key, JSON.stringify(st));
  // پیش از کهنه شدن: کسی آن ده نفر را برنمی‌دارد.
  await drainAll(env);
  ok(lost.every((id) => !sent.includes(id)), "دسته‌ی در حالِ ارسال تا ۱۰ دقیقه دست نمی‌خورد");
  const later = new Date(NOW.getTime() + 11 * 60 * 1000);
  await drainAll(env, later);
  ok(lost.every((id) => sent.filter((x) => x === id).length === 1), "بعد از ۱۰ دقیقه دسته‌ی مرده دوباره فرستاده شد، هر نفر یک بار");
  const cnt = {}; for (const x of sent) cnt[x] = (cnt[x] || 0) + 1;
  const dd = Object.keys(cnt).filter((k) => cnt[k] > 1);
  ok(lost.length === 10 && new Set(sent).size === 600 && dupes() === 0, "در پایان همه یک بار", { got: new Set(sent).size, d: dupes(), shards: [...new Set(dd.map((k) => Number(k) % 6))], c: st.c, lost, sample: dd.slice(0, 5), st: await readConfig(env, key) });
}

// ─── ۴) تازه‌وارد بعد از عکسِ اول ──────────────────────────────────
{
  const env = await setup(120);
  await drainAll(env);
  ok(new Set(sent).size === 120, "۱۲۰ نفرِ عکسِ اول گرفتند");
  env.DB.raw.prepare("INSERT INTO user_state (telegram_user_id) VALUES ('7')").run();
  env.DB.raw.prepare("INSERT INTO user_state (telegram_user_id) VALUES ('999999999')").run();
  sent.length = 0;
  const soon = new Date(NOW.getTime() + 20 * 60 * 1000);
  await drainAll(env, soon);
  ok(sent.length === 0, "پیش از یک ساعت، تازه‌واردها منتظر می‌مانند (بی‌اسکنِ جدول)");
  const later = new Date(NOW.getTime() + 61 * 60 * 1000);
  await drainAll(env, later);
  ok(sent.length === 2 && sent.includes("7") && sent.includes("999999999"), "بعد از یک ساعت هر دو تازه‌وارد گرفتند", sent);
  await drainAll(env, new Date(NOW.getTime() + 130 * 60 * 1000));
  ok(sent.length === 2, "و در بازسازیِ ساعتِ بعد دوباره نگرفتند (claimِ تک‌به‌تک)", sent);
  ok(dupes() === 0, "هیچ تکراری", dupes());
  // پرچمِ پایان زده می‌شود.
  const r = await drainDailyDigest(env, new Date(NOW.getTime() + 130 * 60 * 1000), null);
  ok(r.skipped || r.done === true || (await readConfig(env, "econ_digest_done")) === REF, "روز تمام‌شده اعلام می‌شود", r);
}

// ─── ۵) کلیدِ برگشت ─────────────────────────────────────────────
{
  const env = await setup(90);
  await writeConfig(env, "econ_batch_claim", "off");
  const from = env.DB.log.length;
  await drainAll(env);
  ok(new Set(sent).size === 90 && dupes() === 0, "با کلیدِ off همان مسیرِ قبلی و همه یک بار");
  ok(claimWrites(env, from) >= 90, "و claimِ تک‌به‌تک برگشته", claimWrites(env, from));
}

// ─── ۶) شاردبندیِ دیگر (مثلاً ۴) هم تکرار نمی‌سازد ──────────────────
{
  const env = await setup(200);
  await Promise.all([0, 1, 2].map((s) => runDailyDigest(env, NOW, { of: 6, index: s })));
  for (let i = 0; i < 20; i++) await Promise.all([0, 1, 2, 3].map((s) => runDailyDigest(env, NOW, { of: 4, index: s })));
  await drainAll(env);
  ok(new Set(sent).size === 200 && dupes() === 0, "صداکننده با شش‌شاردِ ناهم‌خوان هم کسی را دو بار نمی‌فرستد", { got: new Set(sent).size, d: dupes() });
}

// ─── ۷) اطلاعیه‌ی فورواردی از کانال ─────────────────────────────────
{
  const { NOTICES, NOTICE_DATES, parsePostLink } = await import("../src/content/notices.js");
  const { runNotice } = await import("../src/econ/sender.js");
  ok(JSON.stringify(parsePostLink("https://t.me/sobhanforex/1850?single")) === JSON.stringify({ from_chat_id: "@sobhanforex", message_id: 1850 }), "لینکِ کانالِ عمومی خوانده می‌شود");
  ok(parsePostLink("https://t.me/c/1234567890/78").from_chat_id === "-1001234567890", "لینکِ کانالِ خصوصی هم");
  ok(parsePostLink("https://t.me/sobhanforex") === null, "لینکِ بی‌شماره‌ی پست رد می‌شود");
  const DAY = "2026-11-10";
  NOTICES[DAY] = { forward: "https://t.me/sobhanforex/1850" };
  NOTICE_DATES.push(DAY); // فهرستِ روزها یک بار هنگامِ بارگذاری ساخته می‌شود
  const env = await setup(150);
  await writeConfig(env, "econ_notice", "on");
  const reqs = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    reqs.push({ method: String(url).split("/").pop(), body: JSON.parse(init.body) });
    return prev(url, init);
  };
  const at = new Date(DAY + "T06:00:00.000Z"); // ۹:۳۰ تهران
  for (let i = 0; i < 20; i++) {
    const r = await runNotice(env, at, null);
    if (!r.sent && !r.stopped) break;
  }
  globalThis.fetch = prev;
  ok(reqs.length === 150 && reqs.every((q) => q.method === "forwardMessage"), "همه با forwardMessage رفتند", { n: reqs.length, m: [...new Set(reqs.map((q) => q.method))] });
  ok(reqs.every((q) => q.body.from_chat_id === "@sobhanforex" && q.body.message_id === 1850 && !q.body.text), "از همان کانال و همان پست، بی‌متنِ اضافه");
  ok(new Set(sent).size === 150 && dupes() === 0, "هر نفر یک بار", { got: new Set(sent).size, d: dupes() });
  delete NOTICES[DAY];
  NOTICE_DATES.splice(NOTICE_DATES.indexOf(DAY), 1);
}

// ─── ۸) متن و بعد فوروارد: ترتیب برای هر نفر ────────────────────────
{
  const { NOTICES, NOTICE_DATES } = await import("../src/content/notices.js");
  const { runNotice } = await import("../src/econ/sender.js");
  const DAY = "2026-11-11";
  NOTICES[DAY] = { text: "یادآوری 👇", forward: "https://t.me/sobhanforex/889" };
  NOTICE_DATES.push(DAY);
  const env = await setup(200);
  await writeConfig(env, "econ_notice", "on");
  const reqs = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    reqs.push({ method: String(url).split("/").pop(), body: JSON.parse(init.body) });
    return prev(url, init);
  };
  const at = new Date(DAY + "T06:00:00.000Z");
  let maxChunk = 0;
  for (let i = 0; i < 40; i++) {
    const rs = await Promise.all([0, 1, 2, 3, 4, 5].map((s) => runNotice(env, at, { of: 6, index: s })).concat([runNotice(env, at, null)]));
    for (const r of rs) maxChunk = Math.max(maxChunk, r.chunk || 0);
    if (rs.every((r) => !r.sent && !r.stopped)) break;
  }
  globalThis.fetch = prev;
  const byUser = {};
  for (const q of reqs) (byUser[q.body.chat_id] = byUser[q.body.chat_id] || []).push(q.method);
  const users = Object.keys(byUser);
  ok(users.length === 200, "همه‌ی ۲۰۰ نفر", users.length);
  ok(users.every((u) => JSON.stringify(byUser[u]) === JSON.stringify(["sendMessage", "forwardMessage"])), "هر نفر دقیقاً یک متن و بعد یک فوروارد، به همین ترتیب");
  ok(maxChunk <= 22, "در هر دور حداکثر ۲۲ نفر (دو پیام برای هر نفر، زیرِ سقفِ ۴۵)", maxChunk);
  delete NOTICES[DAY];
  NOTICE_DATES.splice(NOTICE_DATES.indexOf(DAY), 1);
}

// ─── ۹) ۴۲۹ روی تکه‌ی دوم: صبر و دوباره، و دورِ تازه در همان روز ─────
{
  const { NOTICES, NOTICE_DATES } = await import("../src/content/notices.js");
  const { runNotice } = await import("../src/econ/sender.js");
  const DAY = "2026-11-12";
  NOTICES[DAY] = { text: "یادآوری 👇", forward: "https://t.me/sobhanforex/889" };
  NOTICE_DATES.push(DAY);
  const env = await setup(60);
  await writeConfig(env, "econ_notice", "on");
  const reqs = [];
  const prev = globalThis.fetch;
  let k = 0;
  globalThis.fetch = async (url, init) => {
    const method = String(url).split("/").pop();
    const body = JSON.parse(init.body);
    // هر فورواردِ سوم بارِ اول ۴۲۹ می‌گیرد.
    if (method === "forwardMessage" && ++k % 3 === 0 && !body.__retried) {
      init.body = JSON.stringify({ ...body, __retried: 1 });
      return new Response(JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 1 } }), { status: 429 });
    }
    reqs.push({ method, body });
    return prev(url, init);
  };
  const at = new Date(DAY + "T06:00:00.000Z");
  for (let i = 0; i < 20; i++) {
    const r = await runNotice(env, at, null);
    if (!r.sent && !r.stopped) break;
  }
  const fw = reqs.filter((q) => q.method === "forwardMessage");
  ok(fw.length === 60 && new Set(fw.map((q) => q.body.chat_id)).size === 60, "با ۴۲۹، ویس بعد از صبر به همه‌ی ۶۰ نفر رسید", fw.length);
  // دورِ تازه در همان روز: فقط ویس، دوباره به همه.
  NOTICES[DAY] = { forward: "https://t.me/sobhanforex/889", round: "voice" };
  reqs.length = 0;
  for (let i = 0; i < 20; i++) {
    const r = await runNotice(env, at, null);
    if (!r.sent && !r.stopped) break;
  }
  globalThis.fetch = prev;
  ok(reqs.length === 60 && reqs.every((q) => q.method === "forwardMessage"), "دورِ «voice» همان روز دوباره به همه رفت، فقط ویس", reqs.length);
  delete NOTICES[DAY];
  NOTICE_DATES.splice(NOTICE_DATES.indexOf(DAY), 1);
}

console.log(n + " ادعا");
