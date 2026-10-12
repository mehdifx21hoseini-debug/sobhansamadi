// Gemini خطای گذرا (503 «high demand») داد: دستیار نباید برای همه‌ی
// متن‌ها از کار بیفتد. دو بار مدل اصلی، بعد مدل جایگزین؛ خطای کلید/درخواست
// بی‌دلیل تکرار نمی‌شود.

import { generateStructured } from "../src/ai/gemini.js";

let n = 0;
const ok = (c, m, x) => {
  if (!c) { console.log("❌ " + m + (x !== undefined ? " → " + JSON.stringify(x) : "")); process.exitCode = 1; }
  else { console.log("✅ " + m); n++; }
};

const GOOD = { candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: "ok" }) }] } }] };
const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const env = { GEMINI_API_KEY: "k" };
const realLog = console.error;
console.error = () => {};

async function run(plan) {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url).replace(/.*models\//, ""));
    const step = plan[Math.min(urls.length - 1, plan.length - 1)];
    return step === "net" ? Promise.reject(new TypeError("fetch failed")) : res(step, step === 200 ? GOOD : { error: { code: step } });
  };
  let out, err;
  try { out = await generateStructured(env, "s", "q", {}); } catch (e) { err = e; }
  return { urls, out, err };
}

{
  const r = await run([200]);
  ok(r.urls.length === 1 && r.out.answer === "ok", "حالتِ عادی: یک درخواست");
}
{
  const r = await run([503, 200]);
  ok(r.urls.length === 2 && r.out.answer === "ok" && r.urls[0] === r.urls[1], "یک ۵۰۳: همان مدل دوباره، و جواب می‌آید", r.urls);
}
{
  const r = await run([503, 503, 200]);
  ok(r.urls.length === 3 && r.urls[2] !== r.urls[0] && r.out.answer === "ok", "دو ۵۰۳ پشتِ هم: مدل جایگزین جواب می‌دهد", r.urls);
}
{
  const r = await run(["net", 200]);
  ok(r.urls.length === 2 && r.out.answer === "ok", "قطعیِ شبکه هم دوباره امتحان می‌شود");
}
{
  const r = await run([503]);
  ok(r.urls.length === 3 && r.err && r.err.status === 503, "اگر هر سه شکست بخورد، خطا برمی‌گردد (نه سکوت) و بیش از سه تلاش نیست", r.urls);
}
{
  const r = await run([403]);
  ok(r.urls.length === 1 && r.err && r.err.status === 403, "۴۰۳ (کلید) تکرار نمی‌شود");
}
{
  const r = await run([400]);
  ok(r.urls.length === 1 && r.err, "۴۰۰ (درخواستِ غلط) تکرار نمی‌شود");
}
console.error = realLog;
console.log("\n" + n + " ادعا");
