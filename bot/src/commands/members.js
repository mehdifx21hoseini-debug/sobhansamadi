// /members - چند نفر عضو ربات‌اند. فقط برای مدیر.
//
// «عضو ربات» در تلگرام مفهوم رسمی ندارد: تلگرام API‌ای برای شمردن
// کاربران یک ربات نمی‌دهد. پس عدد از D1 می‌آید - از جدول user_state، که
// حالا برای هر کسی که با ربات کار می‌کند یک ردیف دارد.
//
// یک هشدارِ صادقانه همراه گزارش می‌رود: تا پیش از این، ردیف فقط وقتی
// ساخته می‌شد که کاربر وارد یک فرم شود (ثبت‌نام، مشاوره، پشتیبانی). کسی
// که فقط منو را می‌گشت هیچ ردی نمی‌گذاشت. پس عددِ «کل» برای گذشته کمتر
// از واقعیت است و از امروز به بعد کامل می‌شود.

import { isOwner } from "../owner.js";
import { GATE_CHANNEL } from "../membershipGate.js";

const FA = "۰۱۲۳۴۵۶۷۸۹";

// سه‌رقم سه‌رقم، با ارقام فارسی. Intl اینجا به کار نمی‌آید: روی
// Workers نمی‌شود به وجود داده‌های محلیِ کامل تکیه کرد.
function fa(n) {
  return String(n)
    .replace(/\B(?=(\d{3})+(?!\d))/g, "٬")
    .replace(/[0-9]/g, (d) => FA[d]);
}

function agoIso(ms) {
  return new Date(Date.now() - ms).toISOString();
}

const DAY = 24 * 60 * 60 * 1000;

async function count(env, sql, ...binds) {
  try {
    const q = env.DB.prepare(sql);
    const row = await (binds.length ? q.bind(...binds) : q).first();
    return row ? Number(Object.values(row)[0]) : null;
  } catch (err) {
    console.error("شمارش شکست خورد:", sql, err && err.message);
    return null;
  }
}

function line(label, n, unit) {
  return label + ": " + (n === null ? "—" : "<b>" + fa(n) + "</b>" + (unit ? " " + unit : ""));
}

export async function handleMembers(ctx) {
  if (!isOwner(ctx)) return;

  const env = ctx.env;
  const d1 = agoIso(DAY);
  const d7 = agoIso(7 * DAY);
  const d30 = agoIso(30 * DAY);

  const [total, a1, a7, a30, new7, new30, subs, phones] = await Promise.all([
    count(env, "SELECT COUNT(*) FROM user_state"),
    count(env, "SELECT COUNT(*) FROM user_state WHERE last_interaction_at >= ?", d1),
    count(env, "SELECT COUNT(*) FROM user_state WHERE last_interaction_at >= ?", d7),
    count(env, "SELECT COUNT(*) FROM user_state WHERE last_interaction_at >= ?", d30),
    count(env, "SELECT COUNT(*) FROM user_state WHERE source_first_seen >= ?", d7),
    count(env, "SELECT COUNT(*) FROM user_state WHERE source_first_seen >= ?", d30),
    count(env, "SELECT COUNT(*) FROM econ_subscriber WHERE subscribed = 1"),
    count(env, "SELECT COUNT(*) FROM phone_book"),
  ]);

  const lines = ["👥 <b>اعضای ربات</b>", ""];
  lines.push(line("کل کاربران", total, "نفر"));
  lines.push("");
  lines.push("<b>فعال اخیر</b>");
  lines.push(line("۲۴ ساعت گذشته", a1, "نفر"));
  lines.push(line("۷ روز گذشته", a7, "نفر"));
  lines.push(line("۳۰ روز گذشته", a30, "نفر"));
  lines.push("");
  lines.push("<b>تازه‌وارد</b>");
  lines.push(line("۷ روز گذشته", new7, "نفر"));
  lines.push(line("۳۰ روز گذشته", new30, "نفر"));
  lines.push("");
  lines.push(line("مشترک هشدار تقویم", subs, "نفر"));
  lines.push(line("شماره‌ی ثبت‌شده", phones, "نفر"));

  // کانال، برای مقایسه. دو عدد کاملاً جدا هستند و جمعشان معنی ندارد.
  lines.push("");
  lines.push("📢 <b>کانال</b> <code>" + GATE_CHANNEL + "</code>");
  try {
    lines.push(line("عضو کانال", await ctx.api.getChatMemberCount(GATE_CHANNEL), "نفر"));
    const me = await ctx.api.getMe();
    const m = await ctx.api.getChatMember(GATE_CHANNEL, me.id);
    const isAdmin = m.status === "administrator" || m.status === "creator";
    if (!isAdmin) {
      lines.push("⚠️ ربات در کانال ادمین نیست (" + m.status + ") — دروازه‌ی عضویت برای همه باز است.");
    }
  } catch (err) {
    lines.push("⚠️ خوانده نشد: <code>" + String(err && err.message).slice(0, 120) + "</code>");
    lines.push("یعنی دروازه‌ی عضویت هم همین خطا را می‌گیرد و برای همه باز است.");
  }

  lines.push("");
  lines.push(
    "<i>«کل کاربران» برای گذشته کمتر از واقعیت است: تا پیش از این نسخه، فقط کسانی ثبت می‌شدند که وارد یک فرم شده بودند. از حالا هرکسی که با ربات کار کند شمرده می‌شود.</i>"
  );

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}
