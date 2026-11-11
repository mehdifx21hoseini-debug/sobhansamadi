// اندازه‌گیریِ هر مسیرِ ورکر در برابرِ سقف‌های پلنِ رایگانِ کلادفلر.
//
// سقف‌ها (هر اجرای ورکر): ۵۰ درخواستِ بیرونی (fetch)، ۵۰ کوئریِ D1
// (هر db.batch یکی حساب می‌شود)، و حدودِ ۱۰ میلی‌ثانیه CPU.
//
// CPU اینجا CPUِ خودِ جاوااسکریپت است: زمانی که SQLiteِ محلی برای اجرای
// کوئری می‌گذارد کم می‌شود، چون روی کلادفلر آن کار بیرون از ورکر انجام
// می‌شود. عددِ مطلق با کلادفلر یکی نیست؛ برای مقایسه‌ی مسیرها با هم است.
//
// اجرا (از پوشه‌ی bot):
//   node --import ./test/grammyWeb.register.mjs test/freePlanBudget.harness.mjs [نام-سناریو]
// QLOG=n فهرستِ کوئری‌های اجرای nام را چاپ می‌کند؛ CHECK=1 اگر جایی از ۵۰
// کوئری یا ۵۰ fetch رد شود، با کدِ خطا بیرون می‌آید.

import { readFileSync } from "node:fs";

// ساعتِ ثابت: یک روزِ کاری، ۰۴:۳۰ UTC (۸:۰۰ تهران) - وسطِ پنجره‌ی خلاصه.
// بی‌این، نتیجه به ساعتِ اجرای همین فایل بستگی داشت.
{
  const RealDate = Date;
  const target = RealDate.parse(process.env.AT || "2026-11-11T04:30:00.000Z");
  const offset = target - RealDate.now();
  class FakeDate extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(RealDate.now() + offset);
      else super(...a);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = FakeDate;
}
import { DatabaseSync } from "node:sqlite";

const here = new URL("..", import.meta.url).pathname;
const USERS = Number(process.env.USERS || 17600);
const SUBS = Number(process.env.SUBS || 3600);

// ─── D1ِ ساختگی روی SQLiteِ واقعی، با شمارنده ─────────────────────
const meter = { q: 0, dbCpu: 0, fetch: 0, tg: 0, log: [] };
function cpuNow() {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
}
function timed(fn) {
  const t = cpuNow();
  try {
    return fn();
  } finally {
    meter.dbCpu += cpuNow() - t;
  }
}
function d1() {
  const db = new DatabaseSync(":memory:");
  const exec = (sql, args, mode) =>
    timed(() => {
      const st = db.prepare(sql);
      if (mode === "run") {
        const r = st.run(...args);
        return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      }
      if (mode === "first") return st.get(...args) || null;
      return { results: st.all(...args) };
    });
  const mk = (sql) => {
    const st = { _a: [], sql };
    st.bind = (...a) => {
      st._a = a.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
      return st;
    };
    st.run = async () => {
      meter.q++;
      meter.log.push(sql);
      return exec(sql, st._a, "run");
    };
    st.first = async (col) => {
      meter.q++;
      meter.log.push(/bot_config WHERE key = \?/.test(sql) ? sql + " [" + st._a[0] + "]" : sql);
      const r = exec(sql, st._a, "first");
      return col && r ? r[col] : r;
    };
    st.all = async () => {
      meter.q++;
      meter.log.push(sql);
      return exec(sql, st._a, "all");
    };
    st.raw = async () => {
      meter.q++;
      return timed(() => db.prepare(sql).all(...st._a).map((o) => Object.values(o)));
    };
    st._exec = (mode) => exec(sql, st._a, mode);
    return st;
  };
  return {
    raw: db,
    prepare: mk,
    async batch(stmts) {
      meter.q++;
      meter.log.push("BATCH x" + stmts.length);
      const out = [];
      timed(() => db.exec("BEGIN"));
      try {
        for (const s of stmts) out.push(/^\s*select/i.test(s.sql) ? s._exec("all") : s._exec("run"));
        timed(() => db.exec("COMMIT"));
      } catch (e) {
        timed(() => db.exec("ROLLBACK"));
        throw e;
      }
      return out;
    },
    async exec(sql) {
      meter.q++;
      timed(() => db.exec(sql));
    },
  };
}

// ─── fetchِ ساختگی ────────────────────────────────────────────────
const BOT_INFO = {
  id: 999, is_bot: true, first_name: "Bot", username: "test_bot",
  can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
};
globalThis.fetch = async (input, init = {}) => {
  meter.fetch++;
  const url = String(input && input.url ? input.url : input);
  const reply = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
  if (url.includes("api.telegram.org")) {
    meter.tg++;
    const m = url.split("/").pop();
    if (m === "getMe") return reply({ ok: true, result: BOT_INFO });
    if (m === "getChatMember") return reply({ ok: true, result: { status: "member", user: { id: 1 } } });
    if (m === "getWebhookInfo") return reply({ ok: true, result: { url: "https://x/webhook/tg", allowed_updates: [] } });
    return reply({ ok: true, result: { message_id: 1, date: 0, chat: { id: 1, type: "private" } } });
  }
  return reply({ ok: true });
};

// ─── داده ─────────────────────────────────────────────────────────
async function makeEnv() {
  const DB = d1();
  // فایل‌های طرح از کدِ زنده عقب‌ترند (ستون‌ها با ALTER اضافه شده‌اند)؛
  // هر دستور جدا اجرا می‌شود و ستون‌های شناخته‌شده پیش از ایندکس‌ها می‌آیند.
  const stmts = ["schema.sql", "schema-econ.sql", "schema-crm.sql"]
    .map((f) => readFileSync(here + f, "utf8").replace(/--[^\n]*/g, ""))
    .join(";\n")
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const later = [];
  for (const s of stmts) {
    if (/^CREATE\s+(UNIQUE\s+)?INDEX/i.test(s)) later.push(s);
    else try { DB.raw.exec(s); } catch (e) { console.log("طرح:", e.message); }
  }
  for (const s of ["ALTER TABLE user_state ADD COLUMN blocked_at TEXT"]) {
    try { DB.raw.exec(s); } catch { /* هست */ }
  }
  for (const s of later) {
    try { DB.raw.exec(s); } catch (e) { console.log("ایندکس:", e.message); }
  }
  const env = {
    DB, BOT_TOKEN: "123456:TEST", WEBHOOK_SECRET: "s", ADMIN_KEY: "k",
    WORKER_BASE_URL: "https://w.example", GITHUB_REPO: "o/r", GITHUB_REF_NAME: "main",
    GITHUB_DISPATCH_TOKEN: "x",
  };
  return env;
}

async function seed(env) {
  const { ensureSubscriberSchema } = await import("../src/econ/subscribers.js");
  const { ensureSentSchema } = await import("../src/econ/sender.js");
  const { writeConfig } = await import("../src/content/channel.js");
  await ensureSubscriberSchema(env).catch((e) => console.log("subs schema:", e.message));
  await ensureSentSchema(env);
  await writeConfig(env, "econ_worker_sender", "on");
  const db = env.DB.raw;
  for (const sql of [
    "ALTER TABLE econ_events ADD COLUMN currency TEXT",
    "ALTER TABLE econ_events ADD COLUMN previous_before TEXT",
  ]) {
    try { db.exec(sql); } catch { /* هست */ }
  }
  db.exec("BEGIN");
  const u = db.prepare("INSERT OR IGNORE INTO user_state (telegram_user_id, last_interaction_at) VALUES (?, ?)");
  for (let i = 0; i < USERS; i++) u.run(String(100000000 + i * 37), "2026-11-10T10:00:00.000Z");
  db.exec("COMMIT");
  db.exec("BEGIN");
  const cols = db.prepare("PRAGMA table_info(econ_subscriber)").all().map((c) => c.name);
  const s = db.prepare(
    "INSERT OR IGNORE INTO econ_subscriber (telegram_user_id, chat_id, subscribed, alert_minutes, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)"
  );
  const mins = [5, 15, 15, 15, 30, 60];
  for (let i = 0; i < SUBS; i++) {
    const id = String(100000000 + i * 37 * 3);
    s.run(id, id, mins[i % mins.length], "2026-10-01", "2026-10-01");
  }
  db.exec("COMMIT");
  void cols;
}

async function addEvents(env, now) {
  const db = env.DB.raw;
  const day = (o) => new Date(now.getTime() + o * 86400000).toISOString().slice(0, 10);
  const ins = db.prepare(
    "INSERT OR REPLACE INTO econ_events (event_id, date, time, event, event_fa, currency, importance, forecast, previous, actual, status, source, last_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
  );
  let n = 0;
  for (let d = -1; d <= 5; d++) {
    for (let k = 0; k < 18; k++) {
      ins.run("e" + n++, day(d), String(1 + (k % 12)).padStart(2, "0") + ":30", "Event " + k, "رویداد " + k,
        ["USD", "EUR", "GBP", "JPY"][k % 4], ["high", "medium", "low"][k % 3], "0.3%", "0.2%", null, "scheduled", "ff", now.toISOString());
    }
  }
}

// ─── اجرای یک سناریو ───────────────────────────────────────────────
async function measure(name, fn, reps = 5) {
  const rows = [];
  for (let r = 0; r < reps; r++) {
    meter.q = 0; meter.dbCpu = 0; meter.fetch = 0; meter.tg = 0; meter.log = [];
    const t0 = cpuNow();
    let err = "";
    try {
      await fn(r);
    } catch (e) {
      err = e && e.message ? e.message.slice(0, 80) : String(e);
    }
    const total = cpuNow() - t0;
    if (process.env.QLOG && r === Number(process.env.QLOG) - 1) {
      const c = new Map();
      for (const q of meter.log) {
        const k = q.replace(/\s+/g, " ").slice(0, 110);
        c.set(k, (c.get(k) || 0) + 1);
      }
      for (const [k, v] of [...c].sort((a, b) => b[1] - a[1])) console.log("   " + String(v).padStart(3) + "× " + k);
    }
    rows.push({ js: total - meter.dbCpu, db: meter.dbCpu, q: meter.q, fetch: meter.fetch, err });
  }
  const first = rows[0];
  const warm = rows.slice(1).map((x) => x.js).sort((a, b) => a - b);
  const med = warm.length ? warm[Math.floor(warm.length / 2)] : first.js;
  const maxQ = Math.max(...rows.map((x) => x.q));
  const maxF = Math.max(...rows.map((x) => x.fetch));
  const flag = (v, cap) => (v > cap ? "❌" : v > cap * 0.8 ? "⚠️" : "✅");
  // CHECK=1: کوئری یا fetch بیش از ۵۰ در هر اجرای گرم = شکست (CPUِ محلی
  // با کلادفلر یکی نیست، پس فقط گزارش می‌شود).
  const warmQ = Math.max(...rows.slice(1).map((x) => x.q), 0);
  const warmF = Math.max(...rows.slice(1).map((x) => x.fetch), 0);
  if (process.env.CHECK && (warmQ > 50 || warmF > 50 || maxQ > 50 || maxF > 50)) process.exitCode = 1;
  console.log(
    `${name.padEnd(34)} CPU(js) اول ${first.js.toFixed(1).padStart(6)}ms · گرم ${med.toFixed(1).padStart(6)}ms ${flag(med, 10)}` +
      ` · کوئری ${String(maxQ).padStart(3)} ${flag(maxQ, 50)} · fetch ${String(maxF).padStart(3)} ${flag(maxF, 50)}` +
      (first.err ? "  ! " + first.err : "")
  );
  return rows;
}

export { makeEnv, seed, addEvents, measure, meter };

// ─── سناریوها ──────────────────────────────────────────────────────
const only = process.argv[2] || "";
const env = await makeEnv();
await seed(env);
const NOW = new Date();
await addEvents(env, NOW);
// همان کاری که کرانِ ده‌دقیقه‌ای یک بار انجام می‌دهد: همه‌ی طرح‌ها و
// نوشتنِ نسخه. بعد از این، هیچ مسیری DDL اجرا نمی‌کند.
{
  const { ensureAllSchemas } = await import("../src/schemaGate.js");
  await import("../src/worker.js");
  if (!process.env.NO_GATE) {
    for (let i = 0; i < 4; i++) {
      let res = null;
      await measure("ensureAllSchemas تکه‌ی " + (i + 1), async () => {
        res = await ensureAllSchemas(env);
      }, 1);
      console.log("   →", JSON.stringify(res));
      if (res && (res.built || res.current)) break;
    }
  }
}
const worker = (await import("../src/worker.js")).default;
const ctx = () => {
  const waits = [];
  return { waits, waitUntil: (p) => waits.push(p), passThroughOnException() {} };
};
const runCtx = async (fn) => {
  const c = ctx();
  const res = await fn(c);
  await Promise.allSettled(c.waits);
  return res;
};

let uid = 555000;
function update(body) {
  return new Request("https://w.example/webhook/tg", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": "s" },
    body: JSON.stringify({ update_id: uid++, ...body }),
  });
}
const from = (id) => ({ id, is_bot: false, first_name: "U", username: "u" + id });
const msg = (id, text) => ({
  message: { message_id: uid, date: Math.floor(Date.now() / 1000), chat: { id, type: "private" }, from: from(id), text },
});
const cb = (id, data) => ({
  callback_query: {
    id: String(uid), from: from(id), chat_instance: "1", data,
    message: { message_id: 5, date: 0, chat: { id, type: "private" }, from: BOT_INFO, text: "x" },
  },
});
const admin = (path) =>
  new Request("https://w.example" + path, { method: "GET", headers: { "x-admin-key": "k" } });

const { MENU_LABELS } = await import("../src/menu.js");
const S = {
  "webhook /start": () => runCtx(() => worker.fetch(update(msg(100000000, "/start")), env)),
  "webhook menu تقویم": () => runCtx(() => worker.fetch(update(msg(100000037, MENU_LABELS.ECON_CALENDAR)), env)),
  "webhook menu کتاب‌ها": () => runCtx(() => worker.fetch(update(msg(100000074, MENU_LABELS.LIBRARY)), env)),
  "webhook cb ECON_TODAY": () => runCtx(() => worker.fetch(update(cb(100000111, "ECON_TODAY")), env)),
  "webhook free text": () => runCtx(() => worker.fetch(update(msg(100000148, "سلام قیمت دوره چنده؟")), env)),
  "admin econ-digest round": () => runCtx(() => worker.fetch(admin("/admin/econ-digest?shard=0&of=6"), env)),
  "admin econ-sender status": () => runCtx(() => worker.fetch(admin("/admin/econ-sender"), env)),
  "cron */5 alerts+drains": () =>
    runCtx((c) => worker.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() }, env, c)),
  // بینِ دو پنجره‌ی یک خبرِ مهم: درِین هشدارِ همه را داده (claim شده) و
  // یک خبرِ کم‌اهمیت هم ده دقیقه دیگر است. پیش از ۱۱ نوامبر این تیک برای
  // هر مشترکِ موعدرسیده یک claimِ ناموفق می‌زد.
  "cron */5 بین دو پنجره": async (r) => {
    if (r === 0) {
      const db = env.DB.raw;
      const et = (min) => {
        const d = new Date(Date.now() + min * 60000);
        const f = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", hourCycle: "h23",
        }).formatToParts(d);
        const g = (t) => f.find((x) => x.type === t).value;
        return { date: g("year") + "-" + g("month") + "-" + g("day"), time: g("hour") + ":" + g("minute") };
      };
      const hi = et(22), lo = et(9);
      const ins = db.prepare(
        "INSERT OR REPLACE INTO econ_events (event_id, date, time, event, event_fa, currency, importance, forecast, previous, actual, status, source, last_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
      );
      ins.run("hiX", hi.date, hi.time, "CPI m/m", "تورم", "USD", "high", "0.3%", "0.2%", null, "scheduled", "ff", new Date().toISOString());
      ins.run("loX", lo.date, lo.time, "Redbook", "ردبوک", "USD", "low", "", "", null, "scheduled", "ff", new Date().toISOString());
      const subs = db.prepare("SELECT telegram_user_id FROM econ_subscriber").all();
      const claim = db.prepare("INSERT OR IGNORE INTO econ_sent_log (kind, ref, telegram_user_id, sent_at) VALUES ('alert', ?, ?, ?)");
      db.exec("BEGIN");
      for (const x of subs) claim.run("G:" + hi.date + " " + hi.time, x.telegram_user_id, new Date().toISOString());
      db.exec("COMMIT");
      const low = db.prepare("UPDATE econ_subscriber SET alert_levels = 'high,medium,low' WHERE telegram_user_id = ?");
      for (let i = 0; i < 52; i++) low.run(subs[i * 61].telegram_user_id);
      // خلاصه‌ی امروز تمام شده، تا فقط هشدار سنجیده شود.
      db.prepare("INSERT OR REPLACE INTO bot_config (key, value, updated_at) VALUES ('econ_digest_done', ?, '')").run(
        new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(new Date())
      );
    }
    return runCtx((c) => worker.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() }, env, c));
  },
  "cron */10 mirror": () =>
    runCtx((c) => worker.scheduled({ cron: "*/10 * * * *", scheduledTime: Date.now() }, env, c)),
  "cron 17 ingest": () => runCtx((c) => worker.scheduled({ cron: "17 * * * *", scheduledTime: Date.now() }, env, c)),
  "cron 30 17 sales": () => runCtx((c) => worker.scheduled({ cron: "30 17 * * *", scheduledTime: Date.now() }, env, c)),
};
for (const [k, fn] of Object.entries(S)) {
  if (only && !k.includes(only)) continue;
  await measure(k, fn, k.startsWith("admin econ-digest") ? 8 : 5);
}
