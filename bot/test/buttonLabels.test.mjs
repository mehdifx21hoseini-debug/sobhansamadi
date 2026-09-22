// ویرایشگر نامِ دکمه‌ها.
//
// بیشترِ این ادعاها درباره‌ی یک چیزند: وقتی نامِ دکمه عوض می‌شود،
// نامِ قبلی باید همچنان مسیریابی شود. منوی اصلی reply keyboard است و
// سمتِ کاربر کش می‌شود؛ بدونِ این، تغییرِ نام یعنی از کار افتادنِ
// بی‌صدای دکمه برای هر کسی که هنوز /start نزده - و این همان اشکالی
// است که با چشم دیده نمی‌شود، چون برای خودِ مدیر (که تازه منو گرفته)
// درست کار می‌کند.

import { MENU_LABELS, mainMenuKeyboard, resolveMenuAction } from "../src/menu.js";
import {
  EDITABLE_BUTTONS,
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

console.log("\n" + n + " ادعا");
