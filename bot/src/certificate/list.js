// لیستِ نام‌های گواهی: «چه یکی چه ده تا» در یک پیام.
//
// فرمتِ ورودی همان چیزی است که مدیر طبیعی تایپ می‌کند:
//
//   خانم راحیل غلامی
//   آقا سید محمد سرآبادانی
//
// جنسیت را مدیر مشخص می‌کند، نه ربات - از روی نام نمی‌شود حدسش زد و حدسِ
// غلط یعنی «جناب آقای» روی گواهیِ یک خانم.
//
// برای چند نفرِ هم‌جنس لازم نیست هر خط را تکرار کند: خطی که فقط یک کلمه‌ی
// جنسیت است («خانم» یا «آقایان:») جنسیتِ خط‌های بعدی را تعیین می‌کند، تا
// خطِ جنسیتِ دیگری بیاید. جنسیتِ سرِ خود خط بر آن می‌چربد:
//
//   خانم
//   راحیل غلامی
//   فاطمه محمدی
//   آقا سید محمد سرآبادانی      ← این یکی آقا است، بقیه خانم
//
// همه یا هیچ: اگر حتی یک خط ایراد داشته باشد، هیچ گواهی‌ای ساخته نمی‌شود و
// همه‌ی ایراد‌ها یک‌جا گفته می‌شود. نیمه‌ساختنِ یک لیست یعنی مدیر باید
// بفهمد کدام‌ها ساخته شده و کدام‌ها نه، و دوباره‌فرستادنِ لیست نام‌های
// ساخته‌شده را تکراری می‌کرد.

import { normalizeName } from "./name.js";

export const MAX_BATCH = 30;

// «ي» و «ك» عربی و نیم‌فاصله پیش از مقایسه یکدست می‌شوند، تا «آقاي» و «خانم‌ها»
// هم شناخته شوند.
function plain(s) {
  return String(s)
    .normalize("NFKC")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[‌​]/g, " ")
    .replace(/[ً-ٰٟـ‎‏]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// بلندترین‌ها اول: «جناب آقای» باید پیش از «جناب» دیده شود.
const MALE = ["جناب آقای", "جناب", "آقای", "آقا", "اقا", "اقای"];
const FEMALE = ["سرکار خانم", "سرکار", "خانم", "بانو"];
// جمع‌ها فقط به‌عنوان سرخط: «آقایان:» یا «خانم‌ها».
const MALE_HEAD = ["آقایان", "آقایون", "اقایان"];
const FEMALE_HEAD = ["خانم ها", "خانمها", "خانوم ها", "خانوما", "بانوان"];

const WORDS = [
  ...MALE.map((w) => [w, "m"]),
  ...FEMALE.map((w) => [w, "f"]),
].sort((a, b) => b[0].length - a[0].length);

const HEADS = new Map([
  ...[...MALE, ...MALE_HEAD].map((w) => [w, "m"]),
  ...[...FEMALE, ...FEMALE_HEAD].map((w) => [w, "f"]),
]);

// شماره‌ی ردیف و گلوله‌ی ابتدای خط: «۱- »، «2) »، «- »، «• ».
const LEAD = /^(?:[\s\-–—•*·]+|[0-9۰-۹٠-٩]+\s*[-–.):،]\s*)+/;

function headOf(line) {
  const t = plain(line).replace(/[:：]+$/, "").trim();
  return HEADS.get(t) || null;
}

/**
 * @param {string} raw متنِ پیام (چند خط)
 * @returns {{ok: true, items: Array<{name: string, gender: "m"|"f", converted: boolean}>}
 *         | {ok: false, errors: Array<{line: number, text: string, reason: string}>}}
 */
export function parseList(raw) {
  const lines = String(raw == null ? "" : raw)
    .split(/\r?\n|[;؛]/)
    .map((l) => l.replace(LEAD, "").trim());

  const items = [];
  const errors = [];
  let current = null;

  lines.forEach((line, i) => {
    if (!line) return;
    const no = i + 1;
    const shown = line.length > 40 ? line.slice(0, 40) + "…" : line;

    // سرخطِ جنسیت: فقط یک کلمه (یا جمعش) و بس.
    const head = headOf(line);
    if (head) {
      current = head;
      return;
    }

    // جنسیتِ سرِ خط، با مرزِ کلمه: «آقا» در «آقازاده» نباید جنسیت حساب شود.
    const p = plain(line);
    let gender = null;
    let rest = line;
    for (const [word, g] of WORDS) {
      if (p === word) break; // خودِ کلمه را headOf گرفته
      if (p.startsWith(word + " ")) {
        gender = g;
        // همان تعداد «کلمه» را از متنِ اصلی برمی‌داریم (فاصله‌ها و نیم‌فاصله‌ی
        // اصلی دست‌نخورده می‌ماند تا normalizeName خودش پاک‌سازی کند).
        const n = word.split(" ").length;
        rest = line.split(/[\s‌]+/).slice(n).join(" ");
        break;
      }
    }
    if (!gender) gender = current;

    if (!gender) {
      errors.push({ line: no, text: shown, reason: "جنسیت مشخص نیست (اولِ خط «آقا» یا «خانم» بنویسید)" });
      return;
    }

    const r = normalizeName(rest);
    if (!r.ok) {
      errors.push({ line: no, text: shown, reason: r.reason });
      return;
    }
    items.push({ name: r.name, gender, converted: r.converted });
  });

  if (errors.length === 0 && items.length === 0) {
    return { ok: false, errors: [{ line: 0, text: "", reason: "نامی پیدا نشد." }] };
  }
  if (errors.length === 0 && items.length > MAX_BATCH) {
    return {
      ok: false,
      errors: [{ line: 0, text: "", reason: "حداکثر " + MAX_BATCH + " نام در هر بار؛ " + items.length + " نام فرستادید." }],
    };
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, items };
}
