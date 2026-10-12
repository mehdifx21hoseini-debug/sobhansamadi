// تبدیل فایل «پایگاه دانش SSProX» (متنِ ساختاریافته) به bot/src/ai/ssproxKb.js.
//
// استفاده:  node scripts/kb/ssprox-import.mjs <فایل.txt>
//
// قالب فایل: هر مدخل با یک خط «====» شروع می‌شود، بعد [SSPX-...] و
// فیلدهای «عنوان / پلتفرم / دسته / کلاس منبع / مخاطب / کلیدواژه‌ها»، سپس
// «سؤال‌های رایج:» و «پاسخ:». مدخل‌های «مخاطب: تیم پشتیبانی» یا کلاس
// staff_internal هرگز وارد ربات نمی‌شوند: دستیار با کاربر حرف می‌زند و
// آن‌ها برای تیم‌اند.

import fs from "node:fs";

const src = process.argv[2];
if (!src) {
  console.error("استفاده: node scripts/kb/ssprox-import.mjs <فایل.txt>");
  process.exit(1);
}
const raw = fs.readFileSync(src, "utf8").replace(/\r\n/g, "\n");

const version = (/نسخه‌ی محصول[ .]*:?\s*V\s*([\d.]+)/.exec(raw) || [])[1] || "";
const validUntil = (/تاریخ اعتبار نسخه[ .]*:?\s*(.+)/.exec(raw) || [])[1] || "";

const blocks = raw.split(/^={20,}\s*$/m).map((b) => b.trim()).filter((b) => /^\[SSPX-[A-Z]+-\d+\]/.test(b));

const entries = [];
const skipped = [];
for (const b of blocks) {
  const id = /^\[(SSPX-[A-Z]+-\d+)\]/.exec(b)[1];
  const field = (name) => {
    const m = new RegExp("^" + name + ":\\s*(.*)$", "m").exec(b);
    return m ? m[1].trim() : "";
  };
  const audience = field("مخاطب");
  const cls = field("کلاس منبع");
  if (audience !== "کاربر" || /staff_internal/.test(cls)) {
    skipped.push(id);
    continue;
  }
  const title = field("عنوان");
  const platform = field("پلتفرم");
  const keywords = field("کلیدواژه‌ها");
  // مدخل‌های «س: ... / ج: ...» (سؤالات کوتاه): هر زوج یک مدخل جدا می‌شود،
  // تا هر سؤال کوتاه با جوابِ خودش پیدا شود و در یک بلوک گم نشود.
  if (!/\nپاسخ:\n/.test(b) && /^س:/m.test(b)) {
    const pairs = [...b.matchAll(/^س:\s*(.+)\nج:\s*([\s\S]*?)(?=\n\s*\nس:|\s*$)/gm)];
    pairs.forEach((m, i) => {
      const q = m[1].trim();
      const a = m[2].split("\n").map((l) => l.trim()).join("\n").trim();
      entries.push({
        id: id + "-" + String(i + 1).padStart(2, "0"),
        category: "SSProX",
        question: q + " — " + title + (keywords ? " — کلیدواژه‌ها: " + keywords : ""),
        answer: a,
      });
    });
    if (pairs.length === 0) {
      console.error("مدخل س/ج بدون زوج:", id);
      process.exit(2);
    }
    continue;
  }
  const qBlock = /سؤال‌های رایج:\n([\s\S]*?)\nپاسخ:/.exec(b);
  const questions = qBlock
    ? qBlock[1].split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean)
    : [];
  const answerMatch = /\nپاسخ:\n([\s\S]*)$/.exec(b);
  const answer = answerMatch ? answerMatch[1].replace(/\n{3,}/g, "\n\n").trim() : "";
  if (!title || !answer) {
    console.error("مدخل ناقص:", id);
    process.exit(2);
  }
  // «سوال» در پایگاه دانش یک خط است: عنوان، سؤال‌های رایج و کلیدواژه‌ها.
  // رتبه‌بندی روی متنِ سوال + جواب انجام می‌شود، پس کلیدواژه‌ها (اسم‌های
  // مختلفِ اکسپرت، اصطلاح‌های دقیق) باید همین‌جا باشند.
  const parts = [title];
  if (questions.length) parts.push("سؤال‌های رایج: " + questions.join(" / "));
  if (keywords) parts.push("کلیدواژه‌ها: " + keywords);
  entries.push({
    id,
    category: "SSProX",
    question: parts.join(" — "),
    answer: (platform && platform !== "هر دو" ? "[" + platform + "]\n" : "") + answer,
  });
}

const out =
  "// پایگاه دانش اکسپرت SSProX - نسخه‌ی " + version + (validUntil ? " (اعتبار تا " + validUntil.trim() + ")" : "") + ".\n" +
  "//\n" +
  "// ساخته می‌شود، دستی ویرایش نکنید: node scripts/kb/ssprox-import.mjs <فایل.txt>\n" +
  "// مدخل‌های «تیم پشتیبانی» عمداً وارد نمی‌شوند: " + skipped.join("، ") + ".\n\n" +
  "export const SSPROX_VERSION = " + JSON.stringify(version) + ";\n\n" +
  "export const SSPROX = " + JSON.stringify(entries, null, 2) + ";\n";
fs.writeFileSync(new URL("../../bot/src/ai/ssproxKb.js", import.meta.url), out);
console.log("مدخل:", entries.length, " ردشده (تیم):", skipped.join(", "), " نسخه:", version);
