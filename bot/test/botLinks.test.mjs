// ویرایشگر لینک‌ها.
//
// سه چیز اینجا مهم‌تر از بقیه‌اند:
//
//   ۱. آدرسِ خراب هرگز ذخیره نشود. تلگرام دکمه‌ی با url نامعتبر را
//      قبول نمی‌کند و **کلِ کیبورد** را رد می‌کند، نه فقط همان دکمه -
//      یعنی یک اشتباهِ تایپی یک صفحه‌ی کامل را بی‌دکمه می‌کند.
//   ۲. لینکِ کانال و کانالِ دروازه‌ی عضویت همیشه یکی بمانند.
//   ۳. هر آدرسِ پیش‌فرض واقعاً در کد باشد - وگرنه ویرایش ذخیره می‌شود
//      و روی هیچ‌چیز اثر نمی‌گذارد.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  LINKS,
  LINK_MAX,
  getLinks,
  linkRewrites,
  linkState,
  setLink,
  resetLink,
  validateLink,
  gateChannel,
  usernameFromTelegramUrl,
} from "../src/content/botLinks.js";
import { clearAll } from "../src/cache.js";

let n = 0;
const ok = (c, m, x) => {
  if (!c) { console.log("❌ " + m + (x !== undefined ? " → " + JSON.stringify(x) : "")); process.exitCode = 1; }
  else { console.log("✅ " + m); n++; }
};

function fakeDb() {
  const rows = new Map();
  const db = {
    prepare(sql) {
      const st = {
        _a: [],
        bind(...a) { st._a = a; return st; },
        async run() {
          if (/CREATE TABLE/i.test(sql)) return {};
          if (/INSERT INTO bot_links/i.test(sql)) {
            rows.set(st._a[0], { key: st._a[0], url: st._a[1] });
            return {};
          }
          if (/DELETE FROM bot_links/i.test(sql)) { rows.delete(st._a[0]); return {}; }
          throw new Error("کوئریِ پیش‌بینی‌نشده: " + sql);
        },
        async all() { return { results: [...rows.values()] }; },
      };
      return st;
    },
  };
  return { DB: db };
}
const fresh = () => { clearAll(); return fakeDb(); };

const BROKER = LINKS.find((l) => l.key === "BROKER_SIGNUP").def;

// ── پیش‌فرض‌ها ───────────────────────────────────────────────────
{
  const env = fresh();
  const L = await getLinks(env);
  ok(L.BROKER_SIGNUP === BROKER, "لینکِ بروکر پیش‌فرض است", L.BROKER_SIGNUP);
  ok(Object.keys(L).length === LINKS.length, "همه‌ی کلیدها هستند", Object.keys(L).length);
  ok((await linkRewrites(env)).size === 0, "بدونِ ویرایش، هیچ بازنویسی‌ای نیست");
  ok(LINKS.every((l) => l.title && l.def), "هر لینک عنوان و مقدارِ پیش‌فرض دارد");
  const keys = LINKS.map((l) => l.key);
  ok(new Set(keys).size === keys.length, "کلیدها تکراری نیستند");
}

// ── عوض کردن و برگرداندن ────────────────────────────────────────
{
  const env = fresh();
  await setLink(env, "BROKER_SIGNUP", "https://broker.example.com/?pt=999");
  ok((await getLinks(env)).BROKER_SIGNUP === "https://broker.example.com/?pt=999",
     "آدرسِ تازه می‌نشیند");
  const map = await linkRewrites(env);
  ok(map.get(BROKER) === "https://broker.example.com/?pt=999",
     "و نقشه‌ی بازنویسی از پیش‌فرض به تازه است", [...map]);
  ok((await linkState(env, "BROKER_SIGNUP")).custom === true, "وضعیتش «عوض شده» است");

  await resetLink(env, "BROKER_SIGNUP");
  ok((await getLinks(env)).BROKER_SIGNUP === BROKER, "و بازگشت به پیش‌فرض کار می‌کند");
  ok((await linkRewrites(env)).size === 0, "و بازنویسی پاک می‌شود");
}

// ── اعتبارسنجی ─────────────────────────────────────────────────
{
  const bad = [
    ["", "خالی"],
    ["سلام", "بدونِ پروتکل"],
    ["example.com", "بدونِ https"],
    ["javascript:alert(1)", "پروتکلِ غیرِ http"],
    ["https://a b.com", "با فاصله"],
    ["https://" + "x".repeat(LINK_MAX), "بلندتر از سقف"],
  ];
  for (const [url, why] of bad) {
    ok(validateLink("BROKER_SIGNUP", url) !== null, "رد می‌شود: " + why, url.slice(0, 30));
  }
  ok(validateLink("BROKER_SIGNUP", "https://ok.example.com/a?b=1") === null,
     "و آدرسِ سالم پذیرفته می‌شود");
  ok(validateLink("NO_SUCH_KEY", "https://ok.example.com") !== null, "کلیدِ ناشناخته رد می‌شود");
}

// ── کانال: لینک و دروازه همیشه یکی ──────────────────────────────
{
  ok(usernameFromTelegramUrl("https://t.me/sobhanforex") === "@sobhanforex",
     "نامِ کانال از لینک درمی‌آید");
  ok(usernameFromTelegramUrl("https://www.t.me/abcd/") === "@abcd", "با www و اسلشِ آخر هم");
  ok(usernameFromTelegramUrl("https://t.me/joinchat/XXXX") === null,
     "لینکِ دعوتِ خصوصی نامِ کانال ندارد");
  ok(usernameFromTelegramUrl("https://example.com/x") === null, "و آدرسِ غیرِ تلگرام هم");

  ok(validateLink("TG_CHANNEL", "https://example.com/x") !== null,
     "برای کانال، آدرسِ غیرِ t.me رد می‌شود");
  ok(validateLink("TG_CHANNEL", "https://t.me/joinchat/XXXX") !== null,
     "و لینکِ دعوتِ خصوصی هم - چون دروازه با آن نمی‌تواند عضویت را چک کند");
  ok(validateLink("TG_CHANNEL", "https://t.me/newchannel") === null, "ولی t.me/username درست است");

  const env = fresh();
  ok(await gateChannel(env) === "@sobhanforex", "دروازه پیش‌فرض را می‌گیرد");
  await setLink(env, "TG_CHANNEL", "https://t.me/newchannel");
  ok(await gateChannel(env) === "@newchannel",
     "و با عوض شدنِ لینک، دروازه هم با آن عوض می‌شود - نه اینکه روی کانالِ قبلی جا بماند");
}

// ── وقتی دیتابیس می‌شکند ─────────────────────────────────────────
{
  clearAll();
  const env = { DB: { prepare() { throw new Error("D1 down"); } } };
  ok((await getLinks(env)).BROKER_SIGNUP === BROKER, "با دیتابیسِ خراب، پیش‌فرض‌ها می‌آیند");
  ok((await linkRewrites(env)).size === 0, "و هیچ بازنویسیِ نیم‌بندی انجام نمی‌شود");
  ok(await gateChannel(env) === "@sobhanforex", "و دروازه هم روی کانالِ درست می‌ماند");
}

// ── هر آدرسِ پیش‌فرض باید در کد باشد ─────────────────────────────
{
  const SRC = fileURLToPath(new URL("../src", import.meta.url));
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = dir + "/" + name;
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".js")) files.push(full);
    }
  })(SRC);
  // خودِ فهرست را کنار می‌گذاریم، وگرنه هر آدرسی «پیدا» می‌شود.
  const all = files
    .filter((f) => !f.endsWith("/content/botLinks.js"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  const orphans = LINKS.filter((l) => !all.includes(l.def)).map((l) => l.key);
  ok(orphans.length === 0,
     "هر آدرسِ پیش‌فرض جای دیگری در کد هم هست - وگرنه ویرایش بی‌اثر می‌شد", orphans);

  // و آدرس‌های زیرساخت نباید قابلِ ویرایش باشند.
  const forbidden = ["7host.cloud", "faireconomy.media", "date.nager.at", "workers.dev", "api.github.com"];
  const leaked = LINKS.filter((l) => forbidden.some((f) => l.def.includes(f))).map((l) => l.key);
  ok(leaked.length === 0, "هیچ آدرسِ زیرساختی در فهرستِ ویرایش نیست", leaked);
}

// ── سرتاسری: قلاب، هم دکمه هم متن ───────────────────────────────
{
  const { createBot } = await import("../src/bot.js");
  const env = fresh();
  await setLink(env, "BROKER_SIGNUP", "https://new.example.com/?pt=777");

  const bot = createBot("111:FAKE", env, {
    id: 1, is_bot: true, username: "t", first_name: "t",
    can_join_groups: true, can_read_all_group_messages: false,
    supports_inline_queries: false,
  });

  let seen = null;
  bot.api.config.use(async (prev, method, payload, signal) => {
    seen = payload;
    try { return await prev(method, payload, signal); } catch { return { ok: true, result: {} }; }
  });

  await bot.api
    .sendMessage(1, "🔗 لینک ثبت‌نام:\n" + BROKER, {
      reply_markup: {
        inline_keyboard: [[{ text: "🏦 لینک ثبت نام در بروکر معتمد", url: BROKER }]],
      },
    })
    .catch(() => {});

  ok(seen.reply_markup.inline_keyboard[0][0].url === "https://new.example.com/?pt=777",
     "آدرسِ دکمه بازنویسی شد", seen.reply_markup.inline_keyboard[0][0].url);
  ok(seen.text.includes("https://new.example.com/?pt=777"),
     "و آدرسِ داخلِ متن هم - همان‌جایی که کاربر کپی می‌کند", seen.text);
  ok(!seen.text.includes(BROKER), "و آدرسِ قدیمی در متن نماند", seen.text);
  ok(seen.reply_markup.inline_keyboard[0][0].text === "🏦 لینک ثبت نام در بروکر معتمد",
     "و نامِ دکمه دست‌نخورده ماند");
}

// ── آدرسِ درصدکدشده ─────────────────────────────────────────────
//
// این ادعا از یک باگِ واقعی آمد که تستِ «هر پیش‌فرض در کد هست» نگرفتش:
// صفحه‌ی دوره‌ی هوش هیجانی مسیرِ فارسی دارد و در کد با encodeURI پیچیده
// شده. یعنی رشته‌ای که در کد نوشته شده خام است - پس آن تست سبز بود -
// ولی چیزی که واقعاً روی دکمه می‌نشیند درصدکدشده است. تطبیقِ
// تک‌املایی بی‌صدا رد می‌شد: مدیر آدرس را عوض می‌کرد، ذخیره می‌شد، و
// دکمه همان‌جای قبلی می‌رفت.
{
  const env = fresh();
  const eq = LINKS.find((l) => l.key === "EQ_COURSE");
  ok(encodeURI(eq.def) !== eq.def,
     "آدرسِ این دوره واقعاً دو املا دارد", { raw: eq.def.slice(0, 40) });

  await setLink(env, "EQ_COURSE", "https://example.com/eq");
  const map = await linkRewrites(env);
  ok(map.get(eq.def) === "https://example.com/eq", "املای خام تطبیق می‌خورد");
  ok(map.get(encodeURI(eq.def)) === "https://example.com/eq",
     "و املای درصدکدشده هم - همان چیزی که واقعاً روی دکمه است");
}

// ── و خودِ تستِ یتیم‌ها بی‌اثر نباشد ──────────────────────────────
//
// یک ادعای سبز که هیچ‌وقت نمی‌تواند قرمز شود، بدتر از نداشتنِ ادعاست.
{
  const SRC = fileURLToPath(new URL("../src", import.meta.url));
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = dir + "/" + name;
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".js")) files.push(full);
    }
  })(SRC);
  const all = files
    .filter((f) => !f.endsWith("/content/botLinks.js"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  ok(!all.includes("https://this-url-is-not-in-the-code.example/"),
     "آدرسِ ساختگی در کد پیدا نمی‌شود - پس آن ادعا واقعاً می‌تواند قرمز شود");
}

console.log("\n" + n + " ادعا");
