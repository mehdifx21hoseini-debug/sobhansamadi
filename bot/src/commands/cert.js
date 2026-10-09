// /cert - ساختِ گواهیِ دانشجو. فقط برای مدیر.
//
// جریان:
//   ۱. مدیر می‌نویسد: /cert سید محمد سرآبادانی
//   ۲. ربات نام را پاک‌سازی می‌کند (ي و ك عربی → فارسی) و دو دکمه می‌دهد:
//      «سرکار خانم» و «جناب آقای»
//   ۳. با زدنِ دکمه، درخواست در صف می‌نشیند و ورک‌فلوی رندر راه می‌افتد
//   ۴. عکسِ باکیفیت به‌صورتِ فایل در همین گفتگو می‌آید (حدود یک دقیقه)
//
// چرا دکمه و نه دو دستورِ جدا: جنسیت تنها چیزی است که از روی نام نمی‌شود
// حدس زد، و حدسِ غلط یعنی «جناب آقای» برای یک خانم - روی یک گواهیِ
// رسمی. دکمه آن را یک انتخابِ صریح می‌کند.
//
// چرا فقط مدیر: دستور اصلاً برای دیگران وجود ندارد. جوابی نمی‌دهد،
// حتی «این دستور فقط برای مدیر است» - که خودش اعلامِ وجودِ آن می‌بود.
// در منوی «/» هم فقط برای مدیر ثبت می‌شود (registry.js).

import { isOwner } from "../owner.js";
import { normalizeName } from "../certificate/name.js";
import {
  createDraft,
  takeDraft,
  cancelDraft,
  countActive,
  MAX_ACTIVE,
} from "../certificate/store.js";
import {
  GENDER_LABEL,
  SLOTS,
  ASSET_MAX_BYTES,
  slotForFilename,
  saveAsset,
  readAsset,
  missingAssets,
  startRender,
} from "../certificate/service.js";

export const CERT_PREFIX = "CERT|";

const NO_KEYBOARD = { inline_keyboard: [] };

function keyboard(id) {
  return {
    inline_keyboard: [
      [
        { text: "👨 جناب آقای", callback_data: CERT_PREFIX + "m|" + id, style: "primary" },
        { text: "👩 سرکار خانم", callback_data: CERT_PREFIX + "f|" + id, style: "primary" },
      ],
      [{ text: "✖️ لغو", callback_data: CERT_PREFIX + "x|" + id, style: "danger" }],
    ],
  };
}

export async function handleCert(ctx) {
  // برای غیرمدیر انگار وجود ندارد.
  if (!isOwner(ctx)) return;

  const raw = String(ctx.match || "").trim();
  if (!raw) {
    await ctx.reply(
      "🎓 برای ساختِ گواهی، نامِ دانشجو را بعد از دستور بنویسید:\n\n" +
        "<code>/cert سید محمد سرآبادانی</code>\n\n" +
        "بعد جنسیت را با دکمه انتخاب می‌کنید و عکس همین‌جا می‌آید.",
      { parse_mode: "HTML" }
    );
    return;
  }

  const n = normalizeName(raw);
  if (!n.ok) {
    await ctx.reply("❌ " + n.reason + "\nدوباره بنویسید: /cert نام و نام‌خانوادگی");
    return;
  }

  // پیش از نشان دادنِ دکمه‌ها: فایل‌های گواهی بارگذاری شده‌اند؟ وگرنه مدیر
  // دکمه را می‌زند و یک دقیقه بعد با شکست روبه‌رو می‌شود.
  const missing = await missingAssets(ctx.env);
  if (missing.length > 0) {
    await ctx.reply(
      "⚠️ فایل‌های گواهی هنوز کامل بارگذاری نشده‌اند:\n" +
        missing.map((s) => "• " + SLOTS[s].title + " (" + SLOTS[s].hint + ")").join("\n") +
        "\n\nهرکدام را به‌صورت فایل (Document) همین‌جا بفرستید. وضعیت: /certassets"
    );
    return;
  }

  if ((await countActive(ctx.env)) >= MAX_ACTIVE) {
    await ctx.reply("چند گواهی هنوز در حال ساختن است. چند لحظه صبر کنید و دوباره امتحان کنید.");
    return;
  }

  const id = await createDraft(ctx.env, ctx.from.id, n.name);
  const note = n.converted ? "\n(حروفِ عربی به فارسی تبدیل شد.)" : "";
  await ctx.reply("🎓 گواهی برای:\n«" + n.name + "»" + note + "\n\nجنسیت را انتخاب کنید 👇", {
    reply_markup: keyboard(id),
  });
}

const GONE_TEXT = {
  gone: "این درخواست قبلاً انجام یا لغو شده.",
  expired: "این درخواست منقضی شده؛ دوباره /cert را بزنید.",
  owner: "این درخواست مالِ شما نیست.",
};

export async function handleCertCallback(ctx) {
  // غیرمدیر: دکمه را خنثی می‌کنیم و هیچ نشانی نمی‌دهیم.
  if (!isOwner(ctx)) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  const [, act, id] = String(ctx.callbackQuery.data || "").split("|");
  if (!/^[0-9a-f]{12}$/.test(id || "")) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  if (act === "x") {
    const ok = await cancelDraft(ctx.env, id, ctx.from.id);
    await ctx.answerCallbackQuery({ text: ok ? "لغو شد" : GONE_TEXT.gone }).catch(() => {});
    await ctx.editMessageText("✖️ لغو شد.", { reply_markup: NO_KEYBOARD }).catch(() => {});
    return;
  }
  if (act !== "f" && act !== "m") {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  if ((await countActive(ctx.env)) >= MAX_ACTIVE) {
    await ctx.answerCallbackQuery({
      text: "چند گواهی در حال ساختن است؛ کمی صبر کنید.",
      show_alert: true,
    }).catch(() => {});
    return;
  }

  const msg = ctx.callbackQuery.message;
  const taken = await takeDraft(ctx.env, {
    id,
    ownerId: ctx.from.id,
    gender: act,
    chatId: msg && msg.chat ? msg.chat.id : ctx.from.id,
    messageId: msg ? msg.message_id : null,
  });

  if (!taken.ok) {
    // دکمه‌ها را هم برمی‌داریم تا دوباره زده نشوند.
    await ctx.answerCallbackQuery({ text: GONE_TEXT[taken.why] || GONE_TEXT.gone }).catch(() => {});
    await ctx.editMessageReplyMarkup({ reply_markup: NO_KEYBOARD }).catch(() => {});
    return;
  }

  const job = taken.job;
  await ctx.answerCallbackQuery({ text: "در حال ساخت…" }).catch(() => {});
  await ctx
    .editMessageText(
      "⏳ گواهیِ «" + job.name + "» (" + GENDER_LABEL[act] + ") در حال ساخت است.\n" +
        "حدود یک دقیقه طول می‌کشد و همین‌جا می‌آید.",
      { reply_markup: NO_KEYBOARD }
    )
    .catch(() => {});

  // اگر ورک‌فلو راه نیفتد، startRender خودش درخواست را شکست‌خورده اعلام
  // و به مدیر خبر می‌دهد - اینجا کاری نمی‌ماند.
  await startRender(ctx.env, job);
}

/**
 * فایلی که مدیر می‌فرستد، اگر مالِ گواهی بود ذخیره می‌شود.
 * @returns {Promise<boolean>} true یعنی این فایل مالِ گواهی بود و رسیدگی شد
 */
export async function handleCertAsset(ctx) {
  const doc = ctx.message && ctx.message.document;
  if (!doc || !isOwner(ctx)) return false;
  const slot = slotForFilename(doc.file_name);
  if (!slot) return false;

  if ((doc.file_size || 0) > ASSET_MAX_BYTES) {
    await ctx.reply("❌ این فایل از ۱۸ مگابایت بزرگ‌تر است؛ ربات نمی‌تواند آن را دوباره بخواند.");
    return true;
  }
  if (slot === "template" && doc.mime_type && doc.mime_type !== "image/png") {
    await ctx.reply("❌ قالب باید PNG باشد.");
    return true;
  }

  await saveAsset(ctx.env, slot, doc);
  const missing = await missingAssets(ctx.env);
  await ctx.reply(
    "✅ " + SLOTS[slot].title + " ذخیره شد.\n" +
      (missing.length === 0
        ? "همه‌ی فایل‌ها آماده‌اند؛ می‌توانید /cert بزنید."
        : "هنوز مانده: " + missing.map((s) => SLOTS[s].title).join("، "))
  );
  return true;
}

export async function handleCertAssets(ctx) {
  if (!isOwner(ctx)) return;
  const lines = ["🎓 <b>فایل‌های گواهی</b>", ""];
  for (const slot of Object.keys(SLOTS)) {
    const rec = await readAsset(ctx.env, slot);
    lines.push(
      (rec ? "✅ " : "❌ ") +
        SLOTS[slot].title +
        (rec
          ? " — " + Math.round((rec.size || 0) / 1024) + " کیلوبایت، " + String(rec.at).slice(0, 10)
          : " — بارگذاری نشده (" + SLOTS[slot].hint + ")")
    );
  }
  lines.push("", "هر فایل را به‌صورت Document برای ربات بفرستید؛ نامِ فایل جایگاهش را تعیین می‌کند.");
  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}
