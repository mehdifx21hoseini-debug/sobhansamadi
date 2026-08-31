// /members - چند نفر عضو کانال‌اند. فقط برای مدیر.
//
// عدد از تلگرام می‌آید نه از دیتابیس: دیتابیس فقط کسانی را می‌شناسد که
// با ربات حرف زده‌اند، و آن‌ها زیرمجموعه‌ی اعضای کانال‌اند نه خودشان.
//
// وضعیت ادمین بودنِ ربات هم همین‌جا گفته می‌شود، چون همان یک چیز است که
// دروازه‌ی عضویت به آن بند است: اگر ربات از ادمینیِ کانال بیفتد،
// getChatMember خطا می‌دهد و دروازه بی‌سروصدا برای همه باز می‌شود.

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

export async function handleMembers(ctx) {
  if (!isOwner(ctx)) return;

  const lines = ["👥 <b>اعضای کانال</b>", ""];

  let title = GATE_CHANNEL;
  try {
    const chat = await ctx.api.getChat(GATE_CHANNEL);
    if (chat.title) title = chat.title;
  } catch {
    // اسم کانال چیز لازمی نیست؛ اگر نیامد، همان یوزرنیم نوشته می‌شود.
  }
  lines.push("کانال: «" + title + "» — <code>" + GATE_CHANNEL + "</code>");

  try {
    const count = await ctx.api.getChatMemberCount(GATE_CHANNEL);
    lines.push("تعداد اعضا: <b>" + fa(count) + "</b> نفر");
  } catch (err) {
    lines.push("تعداد اعضا: ⚠️ خوانده نشد");
    lines.push("<code>" + String(err && err.message).slice(0, 140) + "</code>");
  }

  // این سطر مهم‌تر از خودِ عدد است.
  try {
    const me = await ctx.api.getMe();
    const member = await ctx.api.getChatMember(GATE_CHANNEL, me.id);
    const isAdmin = member.status === "administrator" || member.status === "creator";
    lines.push("");
    lines.push("ربات در کانال ادمین است: " + (isAdmin ? "✅" : "❌") + " (" + member.status + ")");
    if (!isAdmin) {
      lines.push(
        "<i>تا وقتی ادمین نباشد، چک عضویت خطا می‌دهد و دروازه برای همه باز می‌ماند.</i>"
      );
    }
  } catch (err) {
    lines.push("");
    lines.push("ربات در کانال ادمین است: ⚠️ بررسی نشد");
    lines.push("<code>" + String(err && err.message).slice(0, 140) + "</code>");
    lines.push("<i>یعنی دروازه‌ی عضویت هم همین خطا را می‌گیرد و برای همه باز است.</i>");
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}
