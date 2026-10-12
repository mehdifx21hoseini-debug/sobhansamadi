// /unanswered - فهرستِ کاملِ سوال‌هایی که دستیار نتوانست جواب بدهد.
//
// فقط مدیرِ اصلی (isOwner). فایل اکسل مستقیم به گفتگوی خودِ مدیر می‌رود:
// متنِ سوال‌های کاربران ممکن است اطلاعاتِ شخصی داشته باشد، پس هیچ‌جا
// چاپ یا ذخیره نمی‌شود (نه لاگِ عمومیِ گیت‌هاب، نه مخزن). شناسه و نامِ
// کاربر هم در فایل نیست - فقط «چه پرسیدند».
//
// هدف: هر سطر یک مدخلِ پایگاه دانش است که هنوز نوشته نشده. ستونِ آخر
// خالی است تا مدیر جوابِ ساده‌اش را بنویسد (یا همان فایل را برای
// تکمیلِ پایگاه دانش بفرستد).

import { InputFile } from "grammy";
import { isOwner } from "../owner.js";
import { ensureLogSchema } from "../ai/log.js";
import { normalize } from "../ai/retrieval.js";
import { buildXlsx } from "../xlsx.js";

const REASONS = {
  off_topic: "بی‌ربط به آکادمی",
  ai_flagged_sensitive: "موضوعِ حساس (دستیار خودش انسان خواست)",
  no_answer: "در پایگاه دانش نبود",
};

// موضوعِ حدسی: فقط برای مرتب کردنِ کار. یک کلیدواژه‌ی ساده است نه تشخیصِ
// قطعی؛ هر سوال اولین موضوعی را می‌گیرد که کلیدواژه‌اش در آن باشد.
const TOPICS = [
  ["بازگشت وجه", /بازگشت|پس\s*(بد|می\s*د|گرفت)|ریفاند|مرجوع|برگرد/],
  ["نارضایتی و شکایت", /شکایت|ناراضی|افتضاح|کلاهبردار|فریب|جواب نمیده|جواب نمی‌ده|پاسخگو|ضرر کردم|دزد|مزخرف/],
  ["پرداخت", /پرداخت|واریز|درگاه|رسید|فاکتور|تایید نشد|پرداختم/],
  ["قیمت و تخفیف", /قیمت|هزینه|چنده|چقدر|تخفیف|اقساط|ارزون|گران|تومان|رایگان/],
  ["لایسنس و دسترسی", /لایسنس|دسترسی|لینک|فعال|اکانت|ورود|پسورد|رمز/],
  ["اکسپرت SSProX", /اکسپرت|ssprox|اس\s*اس\s*پرو|ریسک\s*فری|تریل|خط ریسک|پنل/],
  ["دوره و ثبت‌نام", /دوره|ثبت\s*نام|کلاس|مدرس|جلسه|آموزش|منتور|مشاوره/],
  ["بروکر و واریز", /بروکر|صرافی|تتر|usdt|برداشت|کیف پول|حساب ریل|پراپ/],
  ["متاتریدر و ابزار", /متاتریدر|mt4|mt5|اندیکاتور|چارت|نمودار|لات|حد ضرر|حد سود/],
];

function topicOf(text) {
  const t = String(text || "").toLowerCase();
  for (const [name, re] of TOPICS) if (re.test(t)) return name;
  return "سایر";
}

// کلیدِ گروه: همان سوال با نگارش‌های مختلف (ي/ی، فاصله، اعراب، رقم، نقطه)
// یکی حساب شود. نزدیک‌معنی‌ها (مثلاً «قیمت چنده» و «هزینه‌ی دوره چقدره») را
// عمداً یکی نمی‌کنیم؛ آن کار با خواندنِ فایل و قضاوت است نه با یک قاعده.
export function groupKey(q) {
  return normalize(q)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const when = (iso) => String(iso || "").replace("T", " ").slice(0, 16);

/**
 * @param {Array<{question:string, reason:string, needs_human:number, vote:number|null, created_at:string, telegram_user_id:string}>} logRows
 * @returns {Array<Array<string|number>>} ردیف‌های فایل، پرتکرارها اول
 */
export function buildUnansweredRows(logRows) {
  const groups = new Map();
  for (const r of logRows) {
    const key = groupKey(r.question);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      g = { sample: r.question, count: 0, users: new Set(), first: r.created_at, last: r.created_at, reasons: new Map(), refer: 0, down: 0 };
      groups.set(key, g);
    }
    g.count++;
    g.users.add(String(r.telegram_user_id));
    if (r.created_at < g.first) g.first = r.created_at;
    if (r.created_at >= g.last) { g.last = r.created_at; g.sample = r.question; }
    if (r.needs_human === 1) {
      g.refer++;
      const why = REASONS[r.reason] || r.reason || "نامشخص";
      g.reasons.set(why, (g.reasons.get(why) || 0) + 1);
    }
    if (r.vote === -1) g.down++;
  }
  const list = [...groups.values()].sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : -1));
  return list.map((g, i) => {
    const why = [...g.reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).join(" / ");
    const kind = g.refer > 0 && g.down > 0 ? "ارجاع و رأی منفی" : g.refer > 0 ? "ارجاع به پشتیبانی" : "رأی منفی (جواب داد ولی 👎)";
    return [i + 1, g.sample.replace(/\s+/g, " ").trim().slice(0, 400), g.count, g.users.size, when(g.first), when(g.last), kind, why, topicOf(g.sample), ""];
  });
}

const HEADERS = ["ردیف", "سؤال کاربر (نمونه)", "تعداد", "کاربر یکتا", "اولین بار", "آخرین بار", "نوع", "دلیلِ ارجاع", "موضوع (حدسی)", "جواب شما - اینجا بنویسید"];
const WIDTHS = [7, 60, 8, 10, 17, 17, 22, 28, 18, 60];

export async function handleUnanswered(ctx) {
  if (!isOwner(ctx)) return;

  let rows;
  try {
    await ensureLogSchema(ctx.env);
    // از ابتدای ثبت تا امروز. فقط ستون‌های لازم؛ پاسخِ خودِ دستیار خوانده نمی‌شود.
    const res = await ctx.env.DB
      .prepare(
        `SELECT question, reason, needs_human, vote, created_at, telegram_user_id
           FROM ai_log WHERE needs_human = 1 OR vote = -1 ORDER BY id`
      )
      .all();
    rows = res.results || [];
  } catch (err) {
    console.error("فهرستِ سوال‌های بی‌جواب ساخته نشد:", err && err.message);
    await ctx.reply("❌ خواندنِ گزارش ممکن نشد. چند لحظه‌ی دیگر دوباره بزنید.");
    return;
  }

  const data = buildUnansweredRows(rows);
  if (data.length === 0) {
    await ctx.reply("تا الان سوالی ثبت نشده که دستیار نتواند جوابش را بدهد.");
    return;
  }

  const bytes = buildXlsx({ sheetName: "سوال‌های بی‌جواب", headers: HEADERS, rows: data, widths: WIDTHS });
  const today = new Date().toISOString().slice(0, 10);
  const referred = rows.filter((r) => r.needs_human === 1).length;
  await ctx.replyWithDocument(new InputFile(bytes, "unanswered-" + today + ".xlsx"), {
    caption:
      "📋 " + data.length + " سؤالِ متفاوت، از " + rows.length + " پرسش (" + referred + " ارجاع به پشتیبانی).\n" +
      "پرتکرارها اول‌اند. ستونِ آخر را با جوابِ ساده‌تان پر کنید و همین فایل را برای من بفرستید تا پایگاه دانش را کامل کنم.\n" +
      "متنِ سوال‌های کاربران است؛ فوروارد یا منتشرش نکنید.",
  });
}
