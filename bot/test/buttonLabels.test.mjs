// ویرایشگر نامِ دکمه‌ها.
//
// بیشترِ این ادعاها درباره‌ی یک چیزند: وقتی نامِ دکمه عوض می‌شود،
// نامِ قبلی باید همچنان مسیریابی شود. منوی اصلی reply keyboard است و
// سمتِ کاربر کش می‌شود؛ بدونِ این، تغییرِ نام یعنی از کار افتادنِ
// بی‌صدای دکمه برای هر کسی که هنوز /start نزده - و این همان اشکالی
// است که با چشم دیده نمی‌شود، چون برای خودِ مدیر (که تازه منو گرفته)
// درست کار می‌کند.

import { MENU_LABELS, mainMenuKeyboard, resolveMenuAction } from "../src/menu.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EDITABLE_BUTTONS,
  INLINE_GROUPS,
  INLINE_DEFAULTS,
  inlineRewrites,
  inlineState,
  LABEL_MAX,
  getLabels,
  labelRoutes,
  labelState,
  setLabel,
  resetLabel,
  conflictingKey,
} from "../src/content/buttonLabels.js";
import { clearAll } from "../src/cache.js";

let n = 0;
const ok = (c, m, x) => {
  if (!c) { console.log("❌ " + m + (x !== undefined ? " → " + JSON.stringify(x) : "")); process.exitCode = 1; }
  else { console.log("✅ " + m); n++; }
};

// ── یک D1 قلابی، فقط آن‌قدر که این ماژول لازم دارد ───────────────
function fakeDb() {
  const rows = new Map();
  const db = {
    queries: 0,
    prepare(sql) {
      const stmt = {
        _args: [],
        bind(...a) { stmt._args = a; return stmt; },
        async run() {
          if (/CREATE TABLE/i.test(sql)) return { success: true };
          if (/INSERT INTO button_labels/i.test(sql)) {
            // دو شکلِ کوئری: با label در آرگومان‌ها، و با '' ثابت.
            const withLabel = /VALUES \(\?, \?, \?, \?\)/.test(sql);
            const [key, ...rest] = stmt._args;
            const label = withLabel ? rest[0] : "";
            const past = withLabel ? rest[1] : rest[0];
            rows.set(key, { key, label, past });
            return { success: true };
          }
          throw new Error("کوئریِ پیش‌بینی‌نشده: " + sql);
        },
        async all() {
          db.queries++;
          return { results: [...rows.values()] };
        },
      };
      return stmt;
    },
  };
  return { DB: db, _rows: rows, _db: db };
}

const fresh = () => { clearAll(); return fakeDb(); };

// ── پیش‌فرض‌ها ───────────────────────────────────────────────────
{
  const env = fresh();
  const L = await getLabels(env);
  ok(L.LIVE_TRADE === MENU_LABELS.LIVE_TRADE, "بدونِ ویرایش، نامِ پیش‌فرض می‌آید", L.LIVE_TRADE);
  ok(Object.keys(L).length === Object.keys(MENU_LABELS).length,
     "همه‌ی کلیدها هستند، پس صداکننده لازم نیست fallback بنویسد");

  const kb = await mainMenuKeyboard(env);
  const texts = kb.keyboard.flat().map((b) => b.text);
  ok(texts.includes(MENU_LABELS.PSY_VOICES), "منو با نام‌های پیش‌فرض ساخته می‌شود");
  ok(texts.length === 10, "هر ده دکمه سرِ جایشان‌اند", texts.length);

  // ایموجیِ پرمیوم نباید با تغییرِ نام گم شود.
  const live = kb.keyboard.flat().find((b) => b.text === MENU_LABELS.LIVE_TRADE);
  ok(!!live.icon_custom_emoji_id, "ایموجیِ پرمیوم روی دکمه هست");
}

// ── تغییر نام، و تضمینِ اصلی ────────────────────────────────────
{
  const env = fresh();
  const OLD = MENU_LABELS.LIVE_TRADE;
  await setLabel(env, "LIVE_TRADE", "🎬 لایو تریدهای من");

  const L = await getLabels(env);
  ok(L.LIVE_TRADE === "🎬 لایو تریدهای من", "نامِ تازه در منو می‌نشیند", L.LIVE_TRADE);

  const kb = await mainMenuKeyboard(env);
  ok(kb.keyboard.flat().some((b) => b.text === "🎬 لایو تریدهای من"),
     "و کیبورد با همان ساخته می‌شود");

  ok(await resolveMenuAction(env, "🎬 لایو تریدهای من") === "LIVE_TRADE",
     "نامِ تازه مسیریابی می‌شود");
  ok(await resolveMenuAction(env, OLD) === "LIVE_TRADE",
     "و نامِ قبلی هم - همان چیزی که کیبوردهای کش‌شده می‌فرستند", OLD);

  // زنجیره‌ی دو تغییر: هر سه نام باید زنده بمانند.
  await setLabel(env, "LIVE_TRADE", "📹 ویدیوها");
  ok(await resolveMenuAction(env, "📹 ویدیوها") === "LIVE_TRADE", "نامِ سوم کار می‌کند");
  ok(await resolveMenuAction(env, "🎬 لایو تریدهای من") === "LIVE_TRADE", "نامِ دوم هنوز کار می‌کند");
  ok(await resolveMenuAction(env, OLD) === "LIVE_TRADE", "و نامِ اولِ پیش‌فرض هم");

  const st = await labelState(env, "LIVE_TRADE");
  ok(st.custom === true, "وضعیت «عوض شده» است");
  ok(st.past.length === 2, "دو نامِ قبلی ثبت شده", st.past);
  ok(!st.past.includes("📹 ویدیوها"), "نامِ فعلی جزوِ «قبلی‌ها» نیست", st.past);
}

// ── بازگشت به پیش‌فرض ────────────────────────────────────────────
{
  const env = fresh();
  await setLabel(env, "SUPPORT", "☎️ ارتباط با ما");
  await resetLabel(env, "SUPPORT");

  const L = await getLabels(env);
  ok(L.SUPPORT === MENU_LABELS.SUPPORT, "به پیش‌فرض برگشت", L.SUPPORT);
  ok((await labelState(env, "SUPPORT")).custom === false, "و «عوض‌شده» نیست");
  ok(await resolveMenuAction(env, "☎️ ارتباط با ما") === "SUPPORT",
     "ولی نامِ میانی هنوز مسیریابی می‌شود - کاربری که کیبوردش روی آن گیر کرده به بن‌بست نمی‌خورد");
}

// ── دو دکمه‌ی هم‌نام ─────────────────────────────────────────────
{
  const env = fresh();
  const clash = await conflictingKey(env, "SUPPORT", MENU_LABELS.LIBRARY);
  ok(clash === "LIBRARY", "نامِ دکمه‌ی دیگر تشخیص داده می‌شود", clash);
  ok((await conflictingKey(env, "SUPPORT", MENU_LABELS.SUPPORT)) === null,
     "نامِ خودِ دکمه تعارض نیست");
  ok((await conflictingKey(env, "SUPPORT", "یک نامِ کاملاً تازه")) === null,
     "نامِ آزاد تعارض ندارد");

  // و بعد از تغییرِ نام، نامِ قدیمی هم باید تعارض بسازد: هنوز زنده است.
  await setLabel(env, "LIBRARY", "📚 کتابخانه");
  ok((await conflictingKey(env, "SUPPORT", MENU_LABELS.LIBRARY)) === "LIBRARY",
     "نامِ قدیمیِ یک دکمه هم برای دکمه‌ی دیگر آزاد نیست", MENU_LABELS.LIBRARY);
}

// ── نامِ قدیمیِ سخت‌کدشده (پیش از این ویرایشگر) ───────────────────
{
  const env = fresh();
  ok(await resolveMenuAction(env, "📅 تقویم اقتصادی") === "ECON_CALENDAR",
     "LEGACY_LABELS هنوز کار می‌کند");
  ok(await resolveMenuAction(env, "یک متنِ کاملاً بی‌ربط") === null,
     "متنِ نامربوط به هیچ کنشی نمی‌رسد");
}

// ── کش: مسیرِ داغ نباید هر پیام یک کوئری بزند ────────────────────
{
  const env = fresh();
  await resolveMenuAction(env, "الف");
  const after1 = env._db.queries;
  for (let i = 0; i < 40; i++) await resolveMenuAction(env, "متن " + i);
  ok(env._db.queries === after1,
     "چهل پیامِ پیاپی یک کوئریِ تازه هم نمی‌زند", { first: after1, now: env._db.queries });

  // ولی ذخیره باید کش را باطل کند، وگرنه مدیر تغییرش را نمی‌بیند.
  await setLabel(env, "ABOUT_US", "ℹ️ درباره‌ی آکادمی");
  ok((await getLabels(env)).ABOUT_US === "ℹ️ درباره‌ی آکادمی",
     "بعد از ذخیره، نامِ تازه بی‌درنگ خوانده می‌شود");
}

// ── وقتی دیتابیس می‌شکند ─────────────────────────────────────────
{
  clearAll();
  const env = { DB: { prepare() { throw new Error("D1 down"); } } };
  const L = await getLabels(env);
  ok(L.EXPERT === MENU_LABELS.EXPERT, "با دیتابیسِ خراب، نام‌های پیش‌فرض می‌آیند", L.EXPERT);
  const kb = await mainMenuKeyboard(env);
  ok(kb.keyboard.flat().length === 10, "و منو باز هم کامل بالا می‌آید");
  ok(await resolveMenuAction(env, MENU_LABELS.EXPERT) === "EXPERT",
     "و مسیریابی هم کار می‌کند - منو هیچ‌وقت به‌خاطرِ این قابلیت نمی‌افتد");
}

// ── فهرستِ ویرایش‌پذیرها ────────────────────────────────────────
{
  const keys = EDITABLE_BUTTONS.map((b) => b.key);
  ok(keys.length === Object.keys(MENU_LABELS).length,
     "هر دکمه‌ی منو یک ردیفِ ویرایش دارد", { editable: keys.length, menu: Object.keys(MENU_LABELS).length });
  const missing = Object.keys(MENU_LABELS).filter((k) => !keys.includes(k));
  ok(missing.length === 0, "و هیچ دکمه‌ای جا نمانده", missing);
  ok(EDITABLE_BUTTONS.every((b) => b.hint && b.hint.length > 3),
     "هر کدام توضیحِ «پشتش چیست» دارند");
  ok(LABEL_MAX > 0 && LABEL_MAX <= 64, "سقفِ طولِ نام معقول است", LABEL_MAX);
}

// ── نقشه‌ی دستیار هم نامِ زنده را می‌گیرد ─────────────────────────
{
  const { botMapText } = await import("../src/ai/botMap.js");
  const withDefault = botMapText();
  ok(withDefault.includes(MENU_LABELS.LIVE_TRADE), "بدونِ نام‌ها، پیش‌فرض را می‌نویسد");

  const custom = botMapText({ ...MENU_LABELS, LIVE_TRADE: "📹 ویدیوها" });
  // فقط جایگاهِ نامِ دکمه شمرده می‌شود، نه هر جای متن.
  //
  // بار اول کلِ متن را جست‌وجو کردم و تست قرمز شد: توضیحِ همان ردیف
  // «آرشیو ویدیوهای لایو ترید» است و خودش عینِ نامِ پیش‌فرض را در دلِ
  // یک جمله دارد. نام درست عوض شده بود؛ ادعا غلط بود.
  const names = [...custom.matchAll(/دکمه «([^»]+)»/g)].map((m) => m[1]);
  ok(names.includes("📹 ویدیوها"), "با نام‌های زنده، همان‌ها را می‌نویسد", names);
  ok(!names.includes(MENU_LABELS.LIVE_TRADE),
     "و نامِ قدیمی را دیگر به دستیار نمی‌دهد - وگرنه کاربر را دنبالِ دکمه‌ای می‌فرستد که نیست",
     names);
  // شمردنِ تطبیق‌ها معیار نیست: یازده‌تا درمی‌آید، چون توضیحِ یکی از
  // ردیف‌ها خودش از «دکمه ارسال شماره موبایل» حرف می‌زند - یک دکمه‌ی
  // واقعی، ولی نه ردیفِ نقشه. پس مجموعه سنجیده می‌شود نه تعداد.
  const missing = Object.values({ ...MENU_LABELS, LIVE_TRADE: "📹 ویدیوها" })
    .filter((v) => !names.includes(v));
  ok(missing.length === 0, "هر ده دکمه‌ی منو در نقشه هستند", missing);
}

// ── دکمه‌های زیرمجموعه ───────────────────────────────────────────
{
  const env = fresh();
  const keys = Object.keys(INLINE_DEFAULTS);
  ok(keys.length >= 30, "بیش از سی دکمه‌ی زیرمجموعه ویرایش‌پذیرند", keys.length);
  ok(new Set(keys).size === keys.length, "کلیدها تکراری نیستند");

  const defs = Object.values(INLINE_DEFAULTS);
  ok(new Set(defs).size === defs.length,
     "و هیچ دو کلیدی یک متنِ پیش‌فرض ندارند - وگرنه یکی‌شان هرگز تطبیق نمی‌خورد",
     defs.filter((d, i) => defs.indexOf(d) !== i));

  ok((await inlineRewrites(env)).size === 0, "بدونِ ویرایش، هیچ بازنویسی‌ای نیست");

  await setLabel(env, "INL_ECON_REFRESH", "🔄 تازه‌سازی");
  const map = await inlineRewrites(env);
  ok(map.size === 1, "یک بازنویسی", map.size);
  ok(map.get("🔄 بروزرسانی") === "🔄 تازه‌سازی",
     "از متنِ پیش‌فرض به متنِ تازه", [...map]);

  const st = await inlineState(env, "INL_ECON_REFRESH");
  ok(st.custom === true && st.label === "🔄 تازه‌سازی", "وضعیتش درست است", st);

  await resetLabel(env, "INL_ECON_REFRESH");
  ok((await inlineRewrites(env)).size === 0, "و بازگشت به پیش‌فرض پاکش می‌کند");
}

// ── تغییرِ نامِ زیرمجموعه نباید مسیریابیِ منو را آلوده کند ─────────
{
  const env = fresh();
  await setLabel(env, "INL_NAV_HOME", "🏠 خانه");
  ok(await resolveMenuAction(env, "🏠 خانه") === null,
     "نامِ یک دکمه‌ی inline به کنشِ منو مسیریابی نمی‌شود");
  const L = await getLabels(env);
  ok(Object.values(L).indexOf("🏠 خانه") === -1, "و در نام‌های منوی اصلی هم نمی‌نشیند");
}

// ── هر متنِ پیش‌فرض باید واقعاً در کد باشد ───────────────────────
//
// مهم‌ترین ادعای این فایل بعد از تضمینِ مسیریابی.
//
// تطبیقِ دکمه‌های زیرمجموعه از روی «متنِ پیش‌فرض» است. اگر کسی روزی
// همان متن را در کد عوض کند و اینجا به‌روز نشود، هیچ‌چیز نمی‌شکند و
// هیچ خطایی هم نمی‌دهد - فقط آن ورودیِ ویرایشگر بی‌صدا از کار
// می‌افتد: مدیر نام را عوض می‌کند، ذخیره می‌شود، و روی دکمه اثر
// نمی‌گذارد. این ادعا دقیقاً همان را می‌گیرد.
{
  // نسبت به خودِ این فایل، نه به پوشه‌ی جاری: تست هم از ریشه‌ی مخزن
  // اجرا می‌شود هم از داخلِ bot/، و مسیرِ نسبی به cwd در یکی‌شان
  // می‌شکست.
  const SRC = fileURLToPath(new URL("../src", import.meta.url));
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = dir + "/" + name;
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".js")) files.push(full);
    }
  })(SRC);
  const all = files.map((f) => readFileSync(f, "utf8")).join("\n");

  const orphans = [];
  for (const [key, def] of Object.entries(INLINE_DEFAULTS)) {
    if (!all.includes(def)) orphans.push(key + " → " + def);
  }
  ok(orphans.length === 0,
     "هر متنِ پیش‌فرضِ زیرمجموعه در کد پیدا می‌شود", orphans);

  for (const g of INLINE_GROUPS) {
    ok(g.items.length > 0, "دسته‌ی «" + g.title + "» خالی نیست");
  }
}

// ── سرتاسری: قلابِ createBot واقعاً کیبورد را بازنویسی می‌کند ─────
//
// این ادعا با خواندنِ کد جایگزین نمی‌شود. خودِ قلاب درست بود ولی دو
// چیز در آزمونِ اولش غلط از آب درآمد و هر دو فقط با اجرا معلوم شدند:
// امضای sendMessage در گرامی سه‌آرگومانی است نه یک شیء، و
// transformerها به ترتیبِ **معکوسِ** نصب اجرا می‌شوند.
//
// همان ترتیبِ معکوس اینجا به کار می‌آید: قلابی که بعد از createBot نصب
// شود زودتر اجرا می‌شود، پس payload را می‌گیریم، به پایین پاس می‌دهیم
// تا قلابِ اصلی رویش کار کند، و بعد همان شیء را می‌سنجیم - چون
// بازنویسی درجا انجام می‌شود.
{
  const { createBot } = await import("../src/bot.js");
  const env = fresh();
  await setLabel(env, "INL_EXP_MT4", "📥 نسخه متاتریدر ۴");
  await setLabel(env, "INL_NAV_HOME", "🏠 خانه");

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
    .sendMessage(1, "x", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎬 رونمایی و آموزش نصب", callback_data: "EXPERT_VIDEOS" }],
          [
            { text: "📥 فایل متاتریدر ۴", callback_data: "EXPERT_MT4" },
            { text: "📥 فایل متاتریدر ۵", callback_data: "EXPERT_MT5" },
          ],
          [{ text: "🏠 منوی اصلی", callback_data: "MENU_MAIN" }],
        ],
      },
    })
    .catch(() => {});

  const got = seen.reply_markup.inline_keyboard.flat().map((b) => b.text);
  ok(got[1] === "📥 نسخه متاتریدر ۴", "دکمه‌ی ویرایش‌شده بازنویسی شد", got);
  ok(got[3] === "🏠 خانه", "و دومی هم", got);
  ok(got[0] === "🎬 رونمایی و آموزش نصب", "دکمه‌ی دست‌نخورده دست‌نخورده ماند", got);
  ok(got[2] === "📥 فایل متاتریدر ۵", "و آن یکی هم", got);
  ok(seen.reply_markup.inline_keyboard.flat().every((b) => b.callback_data),
     "و هیچ callback_data‌ای گم نشد - مسیریابی همان است که بود");
}

console.log("\n" + n + " ادعا");
