// دستورهای پایگاه دانش دستیار — فقط برای مدیر.
//
// دستیار هوش مصنوعی از اول کامل بود ولی هرگز جواب نداد، چون داده‌اش از
// n8n می‌آمد و n8n قطع است. این سه دستور همان داده را از داخل تلگرام
// می‌سازند.

import { isOwner } from "../owner.js";
import { syncAndRebuild, listSource, addSourceEntry, removeSourceEntry } from "../ai/source.js";

const FA = "۰۱۲۳۴۵۶۷۸۹";
const fa = (n) => String(n).replace(/\d/g, (d) => FA[Number(d)]);
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const HELP = [
  "🧠 <b>پایگاه دانش دستیار</b>",
  "",
  "<code>/kbsync</code> — ساختن دوباره‌ی پایگاه دانش از متن بخش‌ها و مدخل‌های دستی",
  "<code>/kblist</code> — دیدن مدخل‌ها",
  "<code>/kbadd سوال | جواب</code> — افزودن یک پرسش و پاسخ",
  "<code>/kbdel شماره</code> — برداشتن یک مدخل",
  "",
  "بعد از هر افزودن یا برداشتن، یک‌بار <code>/kbsync</code> بزنید تا دستیار تغییر را ببیند.",
].join("\n");

export async function handleKbSync(ctx) {
  if (!isOwner(ctx)) return;

  if (!ctx.env.GEMINI_API_KEY) {
    await ctx.reply("⚠️ کلید Gemini تنظیم نشده؛ بدون آن بردارها ساخته نمی‌شوند.");
    return;
  }

  // ساختن بردارها چند ثانیه طول می‌کشد و بدون این پیام، مدیر فکر می‌کند
  // دستور بی‌جواب مانده.
  await ctx.reply("⏳ در حال ساختن پایگاه دانش…");

  try {
    const { mirrored, embedded, pending } = await syncAndRebuild(ctx.env);
    await ctx.reply(
      [
        "✅ پایگاه دانش ساخته شد.",
        "",
        "کل مدخل‌ها: " + fa(mirrored),
        "بردار تازه ساخته شد: " + fa(embedded),
        pending > 0 ? "بدون بردار: " + fa(pending) : "همه با بردار معنایی ✓",
        "",
        pending === 0
          ? "دستیار فعال است؛ سوال‌های کاربران را همین‌جا جواب می‌دهد."
          : "چند مدخل بردار نگرفتند - احتمالاً خطای موقت سرویس. یک‌بار دیگر /kbsync بزنید تا همان‌ها دوباره تلاش شوند.",
      ].join("\n")
    );
  } catch (err) {
    console.error("ساخت پایگاه دانش شکست خورد:", err && (err.stack || err.message));
    await ctx.reply("⚠️ ساختن پایگاه دانش شکست خورد: " + (err && err.message));
  }
}

export async function handleKbList(ctx) {
  if (!isOwner(ctx)) return;

  const rows = await listSource(ctx.env).catch(() => []);
  if (rows.length === 0) {
    await ctx.reply(HELP + "\n\nهنوز هیچ مدخلی نیست. با <code>/kbsync</code> شروع کنید.", {
      parse_mode: "HTML",
    });
    return;
  }

  // ۲۵۰ سطر در یک پیام نه جا می‌شود نه خوانده. پس شمارش هر دسته، و
  // فهرست کاملِ فقط آن‌هایی که مدیر خودش اضافه کرده - چون همان‌ها
  // شماره‌شان لازم می‌شود تا بشود برشان داشت.
  const byCategory = new Map();
  const manual = [];
  for (const r of rows) {
    const cat = r.category || "بدون دسته";
    byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
    if (cat === "دستی") manual.push(r);
  }

  const lines = ["🧠 <b>پایگاه دانش دستیار</b> — " + fa(rows.length) + " مدخل", ""];
  for (const [cat, n] of [...byCategory].sort((a, b) => b[1] - a[1])) {
    lines.push("• " + esc(cat) + ": " + fa(n));
  }

  if (manual.length > 0) {
    lines.push("");
    lines.push("✍️ <b>مدخل‌های دستی</b>");
    for (const r of manual) lines.push(fa(r.id) + ". " + esc(r.question));
    lines.push("");
    lines.push("برای برداشتن: <code>/kbdel شماره</code>");
  } else {
    lines.push("");
    lines.push("هنوز مدخل دستی اضافه نشده. <code>/kbadd سوال | جواب</code>");
  }

  await ctx.reply(lines.join("\n").slice(0, 4000), { parse_mode: "HTML" });
}

export async function handleKbAdd(ctx) {
  if (!isOwner(ctx)) return;

  const raw = String(ctx.match || "").trim();
  // جداکننده عمداً | است نه خط تازه: سوال و جواب هر دو می‌توانند چندخطی
  // باشند و خط تازه آن‌ها را از هم جدا نمی‌کند.
  const at = raw.indexOf("|");
  if (at === -1) {
    await ctx.reply(
      HELP + "\n\nمثال:\n<code>/kbadd قیمت دوره پیشرفته چند است؟ | برای اطلاع از شهریه…</code>",
      { parse_mode: "HTML" }
    );
    return;
  }

  const question = raw.slice(0, at).trim();
  const answer = raw.slice(at + 1).trim();
  if (!question || !answer) {
    await ctx.reply("⚠️ هر دو طرف | باید پر باشند: سوال، بعد جواب.");
    return;
  }

  const id = await addSourceEntry(ctx.env, question, answer);
  await ctx.reply(
    "✅ مدخل " + fa(id) + " اضافه شد.\n\nبرای اینکه دستیار ببیندش، /kbsync را بزنید."
  );
}

export async function handleKbDel(ctx) {
  if (!isOwner(ctx)) return;

  const id = Number(String(ctx.match || "").trim());
  if (!Number.isInteger(id) || id <= 0) {
    await ctx.reply("شماره‌ی مدخل را بنویسید: <code>/kbdel 12</code>", { parse_mode: "HTML" });
    return;
  }

  const removed = await removeSourceEntry(ctx.env, id);
  await ctx.reply(
    removed > 0
      ? "🗑 مدخل " + fa(id) + " برداشته شد.\n\nبرای اعمال، /kbsync را بزنید."
      : "مدخلی با این شماره پیدا نشد."
  );
}
