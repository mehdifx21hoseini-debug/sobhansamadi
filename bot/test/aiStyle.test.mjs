// جهتِ متن در پاسخ‌های دستیار + قوانینِ تازه‌ی پرامپت.

import { fixBidi } from "../src/ai/bidi.js";
import { buildSystemPrompt } from "../src/ai/prompt.js";

let n = 0;
const ok = (c, m, x) => {
  if (!c) { console.log("❌ " + m + (x !== undefined ? " → " + JSON.stringify(x) : "")); process.exitCode = 1; }
  else { console.log("✅ " + m); n++; }
};
const RLM = "‏";

const a = fixBidi("SSProX یک پنل است، با «Risk Free» و Trail TP کار می‌کند.");
ok(a.includes(RLM + "SSProX" + RLM) && a.includes(RLM + "Risk Free" + RLM) && a.includes(RLM + "Trail TP" + RLM), "هر تکه‌ی لاتین (حتی دوکلمه‌ای) دو طرف RLM می‌گیرد", a);
ok(fixBidi("سلام، خوبید؟") === "سلام، خوبید؟", "متنِ فارسیِ خالص دست نمی‌خورد");
ok(fixBidi(fixBidi("SSProX خوب است")) === fixBidi("SSProX خوب است"), "دوباره اجرا کردن چیزی اضافه نمی‌کند (idempotent)");
const link = "https://t.me/sobhan_academy?x=1";
ok(fixBidi("لینک: " + link + " بزنید").includes(link), "آدرس سالم می‌ماند (بدون نویسه‌ی نامرئی وسطش)");
ok(fixBidi("نسخه ۲.۱ و MT5").includes(RLM + "MT5" + RLM) && fixBidi("نسخه ۲.۱").includes("۲.۱"), "رقم فارسی دست نمی‌خورد و MT5 لنگر می‌گیرد");
ok(fixBidi(null) === "" && fixBidi("") === "", "ورودی خالی امن است");
ok(fixBidi("A").length === 3, "تک‌حرف هم لنگر می‌گیرد");

const p = buildSystemPrompt({ upd: {}, rows: [], labels: [] }).systemPrompt;
ok(/44\. نظم و خوانایی/.test(p) && /وی ۲\.۱/.test(p), "قانون ۴۴ (نظم، SSProX، فارسی‌نویسیِ شماره‌ی نسخه) در پرامپت است");
ok(/حداکثر سه تکه/.test(p) && /داخل « » بیاید/.test(p), "تکه‌بندی و گیومه‌ی اصطلاحِ لاتین در پرامپت است");
ok(/اقساط، چک و پیش‌پرداخت صریح و کوتاه بگو که نداریم/.test(p), "قانون ۳: اقساط صریحاً «نداریم»");
ok(/قیمت دوره تحت هیچ شرایطی توسط تو اعلام نشود/.test(p), "قانونِ «قیمت اعلام نشود» سرِ جایش است");
console.log("\n" + n + " ادعا");
