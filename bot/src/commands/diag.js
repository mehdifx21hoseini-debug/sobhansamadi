// /diag - گزارش وضعیت، فقط برای مدیر.
//
// چرا لازم است: وقتی محتوای کانال ثبت نمی‌شود، دست‌کم پنج علت ممکن وجود
// دارد که از بیرون همه یک شکل‌اند - هیچ اتفاقی نمی‌افتد. لاگ ورکر هم
// همیشه در دسترس نیست و مسیرهای /admin کلید می‌خواهند.
//
// این دستور همه‌ی آن پنج مورد را یک‌جا و داخل خود تلگرام جواب می‌دهد.

import { normalizeChannelId } from "../content/ingest.js";

// همان آیدی معاف در دروازه‌ی عضویت: مدیر اصلی آکادمی.
const OWNER_ID = "6923823275";

function yes(v) {
  return v ? "✅" : "❌";
}

export async function handleDiag(ctx, build) {
  // برای غیرمدیر، گزارش فرستاده نمی‌شود - ولی سکوت هم نه: آیدی خودش را
  // می‌گیرد. بدون این، کسی که نمی‌داند با کدام حساب باید پیام بدهد هیچ
  // راهی برای فهمیدنش ندارد جز فرستادن پیام به یک ربات ناشناس.
  // آیدی خودِ فرد برای خودش راز نیست.
  if (String(ctx.from.id) !== OWNER_ID) {
    await ctx.reply(
      [
        "این دستور فقط برای مدیر است.",
        "",
        "آیدی عددی شما: <code>" + ctx.from.id + "</code>",
        "آیدی مدیر تنظیم‌شده: <code>" + OWNER_ID + "</code>",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return;
  }

  const env = ctx.env;
  const lines = ["🔧 <b>وضعیت ربات</b>", ""];
  lines.push("نسخه‌ی کد: <code>" + build + "</code>");
  lines.push("");

  // ۱) خود بات کیست. اگر توکن عوض شده باشد، آیدی و نامش هم عوض می‌شود -
  // و باتی که در کانال ادمین است شاید بات دیگری باشد.
  try {
    const me = await ctx.api.getMe();
    lines.push("🤖 بات: <code>@" + me.username + "</code> (آیدی <code>" + me.id + "</code>)");
  } catch (err) {
    lines.push("🤖 بات: خطا — " + (err && err.message));
  }

  // ۲) آیا تلگرام اصلاً پست کانال را می‌فرستد؟
  try {
    const info = await ctx.api.getWebhookInfo();
    const allowed = Array.isArray(info.allowed_updates) ? info.allowed_updates : [];
    const sendsChannel = allowed.length === 0 || allowed.includes("channel_post");
    lines.push("");
    lines.push("📡 <b>وبهوک</b>");
    lines.push("پست کانال فرستاده می‌شود: " + yes(sendsChannel));
    lines.push(
      "allowed_updates: <code>" + (allowed.length ? allowed.join(", ") : "پیش‌فرض (همه)") + "</code>"
    );
    if (info.pending_update_count) lines.push("در صف: " + info.pending_update_count);
    if (info.last_error_message) {
      lines.push("آخرین خطا: <code>" + String(info.last_error_message).slice(0, 120) + "</code>");
    }
  } catch (err) {
    lines.push("📡 وبهوک: خطا — " + (err && err.message));
  }

  // ۳) کانال محتوا: تنظیم شده؟ بات می‌بیندش؟ ادمین هست؟
  lines.push("");
  lines.push("📁 <b>کانال محتوا</b>");
  const chanId = env.CONTENT_CHANNEL_ID || env.CONTENT_CHANNEL_USERNAME;
  lines.push("تنظیم شده: " + yes(!!chanId));

  if (chanId) {
    // همان تبدیلی که خودِ مسیر دریافت انجام می‌دهد.
    //
    // این‌جا قبلاً مقدار خام فرستاده می‌شد و نتیجه گمراه‌کننده بود: کسی که
    // عدد را از لینک t.me/c برداشته (بدون پیشوند -100)، «chat not found»
    // می‌گرفت و فکر می‌کرد بات در کانال نیست - در حالی که خودِ دریافت
    // محتوا با همان مقدار درست کار می‌کرد. ابزار تشخیص باید همان چیزی را
    // ببیند که کد واقعی می‌بیند، وگرنه بدتر از نبودنش است.
    const target = env.CONTENT_CHANNEL_ID
      ? normalizeChannelId(env.CONTENT_CHANNEL_ID)
      : "@" + String(env.CONTENT_CHANNEL_USERNAME).trim().replace(/^@/, "");
    lines.push("مقدار استفاده‌شده: <code>" + target + "</code>");
    try {
      const chat = await ctx.api.getChat(target);
      lines.push("کانال پیدا شد: «" + (chat.title || "?") + "»");
      lines.push("آیدی واقعی: <code>" + chat.id + "</code>");
      try {
        const me = await ctx.api.getMe();
        const member = await ctx.api.getChatMember(chat.id, me.id);
        const isAdmin = member.status === "administrator" || member.status === "creator";
        lines.push("بات در این کانال ادمین است: " + yes(isAdmin) + " (" + member.status + ")");
        if (!isAdmin) {
          lines.push("");
          lines.push("⚠️ بدون ادمین بودن، تلگرام پست‌های کانال را به بات نمی‌دهد.");
        }
      } catch (err) {
        lines.push("وضعیت عضویت بات: خطا — " + (err && err.message));
      }
    } catch (err) {
      const msg = String(err && err.message);
      lines.push("❌ کانال پیدا نشد: <code>" + msg.slice(0, 140) + "</code>");
      // «chat not found» تقریباً همیشه یک معنی دارد: بات عضو آن کانال
      // نیست. تلگرام به باتی که در چتی نیست، حتی وجود آن چت را هم نشان
      // نمی‌دهد - پس این خطا با «آیدی اشتباه» یک شکل است.
      lines.push("");
      lines.push("محتمل‌ترین علت: این بات هنوز در آن کانال ادمین نشده.");
      try {
        const me = await ctx.api.getMe();
        lines.push("کانال را باز کنید و <code>@" + me.username + "</code> را ادمین کنید.");
      } catch {
        lines.push("کانال را باز کنید و همین بات را ادمین کنید.");
      }
      lines.push("بعدش دوباره /diag بزنید.");
    }
  }

  // ۴) چه چیزی تا حالا ثبت شده.
  lines.push("");
  lines.push("🗄 <b>پایگاه داده</b>");
  for (const [label, sql] of [
    ["فایل‌های محتوا", "SELECT COUNT(*) FROM content_library"],
    ["متن‌ها", "SELECT COUNT(*) FROM text_content"],
    ["پایگاه دانش", "SELECT COUNT(*) FROM ai_kb"],
    ["رویدادهای تقویم", "SELECT COUNT(*) FROM econ_events"],
  ]) {
    try {
      const row = await env.DB.prepare(sql).first();
      lines.push(label + ": " + (row ? Object.values(row)[0] : "?"));
    } catch {
      lines.push(label + ": جدول هنوز ساخته نشده");
    }
  }

  // ۵) کلیدها - فقط بودن یا نبودن، هرگز مقدارشان.
  lines.push("");
  lines.push("🔑 <b>کلیدها</b>");
  lines.push("Gemini: " + yes(!!env.GEMINI_API_KEY));
  lines.push("کلید تقویم: " + yes(!!env.ECON_EXPORT_KEY));

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}
