// /diag - گزارش وضعیت، فقط برای مدیر.
//
// چرا لازم است: وقتی محتوای کانال ثبت نمی‌شود، دست‌کم پنج علت ممکن وجود
// دارد که از بیرون همه یک شکل‌اند - هیچ اتفاقی نمی‌افتد. لاگ ورکر هم
// همیشه در دسترس نیست و مسیرهای /admin کلید می‌خواهند.
//
// این دستور همه‌ی آن پنج مورد را یک‌جا و داخل خود تلگرام جواب می‌دهد.

import { resolveAllowedChannel } from "../content/ingest.js";
import { clearContentChannel, writeConfig } from "../content/channel.js";
import { deactivateContent, deactivateTextContent } from "../content/store.js";
import { isOwner, OWNER_IDS, OWNER_USERNAMES } from "../owner.js";
import { SENDER_FLAG, senderStatus } from "../econ/sender.js";
import { GATE_CHANNEL } from "../membershipGate.js";

function yes(v) {
  return v ? "✅" : "❌";
}

export async function handleDiag(ctx, build) {
  // برای غیرمدیر، گزارش فرستاده نمی‌شود - ولی سکوت هم نه: آیدی خودش را
  // می‌گیرد. بدون این، کسی که نمی‌داند با کدام حساب باید پیام بدهد هیچ
  // راهی برای فهمیدنش ندارد جز فرستادن پیام به یک ربات ناشناس.
  // آیدی خودِ فرد برای خودش راز نیست.
  if (!isOwner(ctx)) {
    await ctx.reply(
      [
        "این دستور فقط برای مدیر است.",
        "",
        "آیدی عددی شما: <code>" + ctx.from.id + "</code>",
        "نام کاربری شما: <code>" + (ctx.from.username ? "@" + ctx.from.username : "ندارد") + "</code>",
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
    // فهرست خالی یعنی «همه‌ی انواع پیش‌فرض»، که هر دو را شامل می‌شود.
    const has = (t) => allowed.length === 0 || allowed.includes(t);
    lines.push("");
    lines.push("📡 <b>وبهوک</b>");
    lines.push("پست کانال فرستاده می‌شود: " + yes(has("channel_post")));
    // بدون این، ویرایش کپشن به ربات نمی‌رسد و «حذف با هشتگ #حذف» بی‌صدا
    // کار نمی‌کند - بدون هیچ خطایی، چون تلگرام اصلاً چیزی نمی‌فرستد.
    lines.push("ویرایش پست کانال (برای حذف): " + yes(has("edited_channel_post")));
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
  const allowed = await resolveAllowedChannel(env).catch(() => ({ id: "", source: "" }));

  if (!allowed.id) {
    lines.push("هنوز ثبت نشده.");
    lines.push("کافی است یک فایل با هشتگ در کانال بگذارید؛ همان لحظه ثبت می‌شود.");
  } else {
    lines.push("آیدی: <code>" + allowed.id + "</code> (" + allowed.source + ")");
    try {
      const chat = await ctx.api.getChat(allowed.id);
      lines.push("کانال: «" + (chat.title || "?") + "»");
      const me = await ctx.api.getMe();
      const member = await ctx.api.getChatMember(chat.id, me.id);
      const isAdmin = member.status === "administrator" || member.status === "creator";
      lines.push("بات ادمین است: " + yes(isAdmin) + " (" + member.status + ")");
    } catch (err) {
      lines.push("⚠️ بررسی نشد: <code>" + String(err && err.message).slice(0, 120) + "</code>");
      lines.push("اگر فایل‌ها ثبت می‌شوند، این خطا اهمیتی ندارد.");
    }
    lines.push("برای عوض کردن کانال: /resetchannel");
  }

  // ۳.۵) کانال دروازه - جدا از کانال محتوا. این دو می‌توانند یکی نباشند
  // و معمولاً هم نیستند: یکی جایی است که فایل‌ها از آن می‌آیند، این یکی
  // جایی است که کاربر باید عضوش باشد.
  lines.push("");
  lines.push("🔒 <b>کانال دروازه‌ی عضویت</b>");
  lines.push("کانال: <code>" + GATE_CHANNEL + "</code>");
  try {
    const count = await ctx.api.getChatMemberCount(GATE_CHANNEL);
    lines.push("تعداد اعضا: <b>" + count.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "٬") + "</b>");
    const me = await ctx.api.getMe();
    const member = await ctx.api.getChatMember(GATE_CHANNEL, me.id);
    const isAdmin = member.status === "administrator" || member.status === "creator";
    lines.push("بات ادمین است: " + yes(isAdmin) + " (" + member.status + ")");
    if (!isAdmin) lines.push("⚠️ بدون ادمینی، چک عضویت خطا می‌دهد و دروازه برای همه باز است.");
  } catch (err) {
    lines.push("⚠️ خوانده نشد: <code>" + String(err && err.message).slice(0, 120) + "</code>");
    lines.push("یعنی دروازه‌ی عضویت هم همین خطا را می‌گیرد و برای همه باز است.");
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

  // ۵) چه کسانی مدیرند - و مهم‌تر، عددِ خودِ کسی که الان دستور را زده.
  //
  // دسترسی با نام کاربری موقتی است و باید به عدد تبدیل شود؛ بدون دیدن
  // این عدد، هیچ راهی برای انجام آن تبدیل نیست.
  lines.push("");
  lines.push("👤 <b>مدیران</b>");
  lines.push("شما: <code>" + ctx.from.id + "</code>" + (ctx.from.username ? " (@" + ctx.from.username + ")" : ""));
  lines.push("با آیدی عددی: <code>" + OWNER_IDS.join(", ") + "</code>");
  if (OWNER_USERNAMES.length) {
    lines.push("با نام کاربری: <code>@" + OWNER_USERNAMES.join(", @") + "</code>");
    lines.push("<i>دسترسی با نام کاربری موقتی است - عدد بالا را بدهید تا ثابت شود.</i>");
  }

  // ۶) کلیدها - فقط بودن یا نبودن، هرگز مقدارشان.
  lines.push("");
  lines.push("🔑 <b>کلیدها</b>");
  lines.push("Gemini: " + yes(!!env.GEMINI_API_KEY));
  lines.push("کلید تقویم: " + yes(!!env.ECON_EXPORT_KEY));

  lines.push("");
  lines.push("🛠 <b>دستورهای مدیر</b>");
  lines.push("/members — تعداد کاربران ربات");
  lines.push("/edit — ویرایش متن و عکس بخش‌ها");
  lines.push("/delete — حذف یک محتوا با شناسه");
  lines.push("/kbsync — ساختن پایگاه دانش دستیار");
  lines.push("/resetchannel — عوض کردن کانال محتوا");

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}

// راه دوم حذف، برای وقتی راه اول در دسترس نیست.
//
// راه اصلی، افزودن #حذف به کپشن همان پست در کانال است. ولی آن راه به
// پستِ اصلی نیاز دارد: اگر پست پاک شده باشد - یا مدخل با نسل قدیمیِ
// شناسه ساخته شده باشد که به شماره‌ی پیام گره نمی‌خورد - دیگر چیزی برای
// ویرایش نمانده و بدون این دستور، آن مدخل تا ابد در ربات می‌ماند.
//
// شناسه در همان پیام «✅ ثبت شد: ...» که ربات در کانال داده بود هست.
export async function handleDeleteContent(ctx) {
  if (!isOwner(ctx)) return;

  const id = String(ctx.match || "").trim();
  if (!id) {
    await ctx.reply(
      [
        "شناسه‌ی محتوا را بعد از دستور بنویسید:",
        "<code>/delete PSY_VOICE_000000203</code>",
        "",
        "شناسه، همانی است که ربات موقع ثبت در کانال جواب داده بود.",
        "",
        "راه ساده‌تر: کپشن همان پست در کانال را ویرایش کنید و #حذف را به آن اضافه کنید.",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return;
  }

  const removed =
    (await deactivateContent(ctx.env, id)) + (await deactivateTextContent(ctx.env, id));

  await ctx.reply(
    removed > 0
      ? "🗑 حذف شد: <code>" + id + "</code>"
      : "چیزی با این شناسه پیدا نشد: <code>" + id + "</code>",
    { parse_mode: "HTML" }
  );
}

// «/setquiz» اینجا بود و برداشته شد.
//
// تنها دکمه‌ای که آن آدرس را نشان می‌داد، «آزمون تعیین سطح» در پایان
// دوره‌ی مقدماتی بود و آن دکمه حذف شده. یک دستور مدیر که وعده‌ی عوض
// کردن دکمه‌ای را می‌دهد که دیگر وجود ندارد، بدتر از نبودنش است: مدیر
// آدرس را ثبت می‌کند، پیام «✅ ثبت شد» می‌گیرد و هیچ‌جا چیزی عوض
// نمی‌شود. خواننده‌ی آدرس (readQuizUrl در content/channel.js) سر جایش
// مانده تا اگر روزی دکمه برگشت، همه‌چیز یک import فاصله داشته باشد.

// کانال ثبت‌شده را باز می‌کند تا کانال بعدی که پست بگذارد جایش بنشیند.
export async function handleResetChannel(ctx) {
  if (!isOwner(ctx)) return;
  await clearContentChannel(ctx.env);
  await ctx.reply(
    [
      "🔄 کانال محتوا پاک شد.",
      "",
      "حالا در کانال درست یک فایل با هشتگ بگذارید؛ همان کانال ثبت می‌شود.",
    ].join("\n")
  );
}

// /econsender - کلید ارسال تقویم از ورکر.
//
// این تنها چیزی است که در لحظه‌ی انتقال باید تغییر کند، و عمداً یک
// دستور است نه یک متغیر محیطی: انتقال باید بدون دیپلوی انجام شود، چون
// اگر پیامی دو بار رفت یا اصلاً نرفت، برگرداندنش باید چند ثانیه طول
// بکشد نه چند دقیقه.
//
// ترتیب درست: اول شاخه‌های ارسالِ n8n خاموش، بعد این روشن. عکسِ آن یعنی
// همه‌ی مشترکین هر پیام را دو بار می‌گیرند.
export async function handleEconSender(ctx) {
  if (!isOwner(ctx)) return;

  const arg = String(ctx.match || "").trim().toLowerCase();
  const status = await senderStatus(ctx.env);

  if (arg !== "on" && arg !== "off") {
    await ctx.reply(
      [
        "🔔 ارسال تقویم از ورکر",
        "",
        "وضعیت: " + (status.enabled ? "✅ روشن" : "⛔️ خاموش"),
        "پیام‌های ۲۴ ساعت گذشته: " + status.sent_24h,
        "",
        "روشن کردن: <code>/econsender on</code>",
        "خاموش کردن: <code>/econsender off</code>",
        "",
        "تا وقتی خاموش است، ارسال با n8n است. پیش از روشن کردن، شاخه‌های",
        "ارسال n8n را خاموش کنید وگرنه هر پیام دو بار می‌رود.",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return;
  }

  await writeConfig(ctx.env, SENDER_FLAG, arg);
  await ctx.reply(
    arg === "on"
      ? "✅ ارسال تقویم از ورکر روشن شد.\n\nخلاصه‌ی روزانه ساعت ۸ صبح تهران می‌رود؛ هشدارها هر پنج دقیقه بررسی می‌شوند."
      : "⛔️ ارسال تقویم از ورکر خاموش شد."
  );
}
