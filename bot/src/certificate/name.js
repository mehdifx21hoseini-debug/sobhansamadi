// نامِ روی گواهی: پاک‌سازی و اعتبارسنجی.
//
// مدیر نام را از هرجایی کپی می‌کند - پیام‌رسان، اکسل، یک فرمِ ثبت‌نام - و
// کیبوردِ عربی هم کم نیست. «ي» و «ك» عربی در فونتِ گواهی شکلِ دیگری دارند
// و کنارِ حروفِ فارسی بد دیده می‌شوند، پس پیش از رسم به فارسی برمی‌گردند.
//
// بر خلافِ پیامِ همگانی که متنش باید دقیقاً همان بماند، اینجا تبدیل
// خواسته‌ی صریحِ آکادمی است: «اگر عربی بود فارسی بفهمد و درستش بنویسد».

// حروفِ مخصوصِ عربی → معادلِ فارسی.
const MAP = {
  "ي": "ی", // ي → ی
  "ى": "ی", // ى → ی
  "ێ": "ی", // ێ → ی
  "ك": "ک", // ك → ک
  "ة": "ه", // ة → ه
  "ہ": "ه", // ہ → ه
  "ھ": "ه", // ھ → ه
  "ٱ": "ا", // ٱ → ا
};

// نشانه‌هایی که در نام جایی ندارند: کشیده، اعراب، علامت‌های قرآنی.
const STRIP =
  /[ـؐ-ًؚ-ٰٟۖ-ۭ​‍‎‏‪-‮⁦-⁩﻿]/g;

const ZWNJ = "‌";

// حروفِ مجاز: الفبای عربی-فارسی، نیم‌فاصله، فاصله و خط‌تیره.
const ALLOWED = /^[ء-غف-يپچژکگیۀ ‌-]+$/;
const LETTER = /[ء-غف-يپچژکگیۀ]/g;

export const NAME_MIN = 2;
export const NAME_MAX = 60;

/**
 * @returns {{ok: true, name: string, converted: boolean}
 *         | {ok: false, reason: string}}
 *   converted یعنی حروفِ عربی به فارسی تبدیل شد - برای اینکه ربات به
 *   مدیر بگوید چه چیزی را عوض کرده، نه بی‌صدا.
 */
export function normalizeName(raw) {
  let s = String(raw == null ? "" : raw);

  // شکل‌های نمایشیِ عربی (ﻣ ﺤ ...) را به حرفِ اصلی برمی‌گرداند.
  s = s.normalize("NFKC");

  let converted = false;
  s = s.replace(/[يىێكةہھٱ]/g, (c) => {
    converted = true;
    return MAP[c];
  });

  s = s.replace(STRIP, "");
  // هر نوع فاصله (NBSP، تب، خط‌شکن) → فاصله‌ی ساده.
  s = s.replace(/[\s  -   　]+/g, " ");
  // نیم‌فاصله‌ی چسبیده به فاصله یا سرِ و ته معنایی ندارد.
  s = s.replace(/ ?‌+ ?/g, (m) => (m.includes(" ") ? " " : ZWNJ));
  s = s.replace(/^[ ‌-]+|[ ‌-]+$/g, "");

  if (!s) return { ok: false, reason: "نام خالی است." };

  if (/[0-9۰-۹٠-٩]/.test(s)) {
    return { ok: false, reason: "نام نباید رقم داشته باشد." };
  }
  if (/[A-Za-z]/.test(s)) {
    return { ok: false, reason: "فقط حروف فارسی مجاز است؛ حرف لاتین پیدا شد." };
  }
  if (!ALLOWED.test(s)) {
    return { ok: false, reason: "نام فقط باید حروف فارسی و فاصله داشته باشد." };
  }

  const letters = (s.match(LETTER) || []).length;
  if (letters < NAME_MIN) return { ok: false, reason: "نام خیلی کوتاه است." };
  if (s.length > NAME_MAX) {
    return { ok: false, reason: "نام بیش از " + NAME_MAX + " نویسه است." };
  }

  return { ok: true, name: s, converted };
}
