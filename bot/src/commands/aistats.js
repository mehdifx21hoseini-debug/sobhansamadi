// گزارش کارکرد دستیار — فقط برای مدیر.
//
// هدفش یک عدد نیست، یک فهرست کار است: کدام سوال‌ها را دستیار نتوانست
// جواب بدهد، و کدام جواب‌ها را کاربر رد کرد. هر سطر این دو فهرست، یک
// /kbadd است که هنوز نوشته نشده.

import { isOwner } from "../owner.js";
import { aiStats } from "../ai/log.js";

const FA = "۰۱۲۳۴۵۶۷۸۹";
const fa = (n) => String(n).replace(/\d/g, (d) => FA[Number(d)]);
const esc = (s) =>
  String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (n, of) => (of > 0 ? fa(Math.round((n / of) * 100)) + "٪" : "—");
const cut = (s, n) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};

// چرا هر ارجاع اتفاق افتاد. کدهای انگلیسی از خود مدل می‌آیند و برای
// مدیر معنایی ندارند.
const REASONS = {
  off_topic: "بی‌ربط به آکادمی",
  ai_flagged_sensitive: "دستیار خودش انسان خواست",
  no_answer: "در پایگاه دانش نبود",
};

export async function handleAiStats(ctx) {
  if (!isOwner(ctx)) return;

  let s;
  try {
    s = await aiStats(ctx.env);
  } catch (err) {
    console.error("گزارش دستیار ساخته نشد:", err && (err.stack || err.message));
    await ctx.reply("⚠️ گزارش ساخته نشد: " + (err && err.message));
    return;
  }

  if (s.total === 0) {
    await ctx.reply(
      "🤖 <b>کارکرد دستیار</b> — ۳۰ روز گذشته\n\nهنوز سوالی ثبت نشده. از اولین سوالی که کاربران بپرسند، اینجا پر می‌شود.",
      { parse_mode: "HTML" }
    );
    return;
  }

  const lines = [
    "🤖 <b>کارکرد دستیار</b> — ۳۰ روز گذشته",
    "",
    "کل سوال‌ها: " + fa(s.total),
    "خودش جواب داد: " + fa(s.answered) + " (" + pct(s.answered, s.total) + ")",
    "به پشتیبانی رفت: " + fa(s.escalated) + " (" + pct(s.escalated, s.total) + ")",
  ];

  const votes = s.up + s.down;
  lines.push("");
  lines.push(
    votes > 0
      ? "بازخورد کاربران: 👍 " + fa(s.up) + " / 👎 " + fa(s.down) + " (" + pct(s.up, votes) + " مثبت)"
      : "بازخورد کاربران: هنوز کسی رأی نداده"
  );

  if (s.reasons.length > 0) {
    lines.push("");
    lines.push("<b>چرا به پشتیبانی رفتند</b>");
    for (const r of s.reasons) {
      lines.push("• " + esc(REASONS[r.reason] || r.reason) + ": " + fa(r.n));
    }
  }

  if (s.unanswered.length > 0) {
    lines.push("");
    lines.push("<b>سوال‌های بی‌جواب</b> — این‌ها را با <code>/kbadd</code> اضافه کنید");
    for (const q of s.unanswered) {
      lines.push("• " + esc(cut(q.question, 90)) + (q.n > 1 ? " (" + fa(q.n) + " بار)" : ""));
    }
  }

  if (s.weak.length > 0) {
    lines.push("");
    lines.push("<b>جواب‌هایی که کاربر رد کرد</b> 👎");
    for (const w of s.weak) lines.push("• " + esc(cut(w.question, 90)));
  }

  lines.push("");
  lines.push("بعد از هر <code>/kbadd</code>، یک‌بار <code>/kbsync</code> بزنید.");

  await ctx.reply(lines.join("\n").slice(0, 4000), { parse_mode: "HTML" });
}
