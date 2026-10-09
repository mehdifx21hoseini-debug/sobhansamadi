// /cert - ساختِ گواهیِ دانشجو. فقط برای مدیر.
//
// جریان:
//   ۱. مدیر می‌نویسد: /cert
//   ۲. ربات دو دکمه می‌دهد: «جناب آقای» و «سرکار خانم»
//   ۳. مدیر یکی را می‌زند؛ ربات می‌گوید «حالا نامِ دانشجو را بنویسید»
//   ۴. مدیر نام را تایپ می‌کند (ي و ك عربی خودکار به فارسی برمی‌گردد)
//   ۵. درخواست در صف می‌نشیند و ورک‌فلوی رندر راه می‌افتد
//   ۶. عکسِ باکیفیت به‌صورتِ فایل در همین گفتگو می‌آید (حدود یک دقیقه)
//
// میان‌بر: «/cert نام» نام را همان‌جا می‌گیرد و فقط دکمه‌ی جنسیت را می‌پرسد.
//
// چرا دکمه و نه دو دستورِ جدا: جنسیت تنها چیزی است که از روی نام نمی‌شود
// حدس زد، و حدسِ غلط یعنی «جناب آقای» برای یک خانم - روی یک گواهیِ
// رسمی. دکمه آن را یک انتخابِ صریح می‌کند.
//
// چرا فقط مدیر: دستور اصلاً برای دیگران وجود ندارد. جوابی نمی‌دهد،
// حتی «این دستور فقط برای مدیر است» - که خودش اعلامِ وجودِ آن می‌بود.
// در منوی «/» هم فقط برای مدیر ثبت می‌شود (registry.js).

import { isOwner } from "../owner.js";
import { getUserState, setUserState, clearUserState } from "../db.js";
import { normalizeName } from "../certificate/name.js";
import {
  createDraft,
  takeDraft,
  submitName,
  getJob,
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
// حالتِ «منتظرِ نام» در user_state. همان الگوی ویرایشِ برچسب و لینک.
export const CERT_FLOW = "cert_name";
export const CERT_STEP = "ask_name";

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

// پیش از نشان دادنِ دکمه‌ها: فایل‌های گواهی بارگذاری شده‌اند و صف جا دارد؟
// وگرنه مدیر دکمه را می‌زند و یک دقیقه بعد با شکست روبه‌رو می‌شود.
async function preflight(ctx) {
  const missing = await missingAssets(ctx.env);
  if (missing.length > 0) {
    await ctx.reply(
      "⚠️ فایل‌های گواهی هنوز کامل بارگذاری نشده‌اند:\n" +
        missing.map((s) => "• " + SLOTS[s].title + " (" + SLOTS[s].hint + ")").join("\n") +
        "\n\nهرکدام را به‌صورت فایل (Document) همین‌جا بفرستید. وضعیت: /certassets"
    );
    return false;
  }
  if ((await countActive(ctx.env)) >= MAX_ACTIVE) {
    await ctx.reply("چند گواهی هنوز در حال ساختن است. چند لحظه صبر کنید و دوباره امتحان کنید.");
    return false;
  }
  return true;
}

// مدیری که /cert را دوباره می‌زند نباید در «منتظرِ نامِ» قبلی گیر کند - ولی
// حالتِ فرآیندِ دیگری (ویرایشِ برچسب، لینک...) را هم نباید پاک کنیم.
async function leaveCertFlow(ctx) {
  const st = await getUserState(ctx.env, ctx.from.id).catch(() => null);
  if (st && st.current_flow === CERT_FLOW) await clearUserState(ctx.env, ctx.from.id);
}

export async function handleCert(ctx) {
  // برای غیرمدیر انگار وجود ندارد.
  if (!isOwner(ctx)) return;

  const raw = String(ctx.match || "").trim();

  // دستورِ بی‌نام: اول جنسیت، بعد نام.
  if (!raw) {
    if (!(await preflight(ctx))) return;
    await leaveCertFlow(ctx);
    const id = await createDraft(ctx.env, ctx.from.id, "");
    await ctx.reply("🎓 ساخت گواهی\n\nجنسیتِ دانشجو را انتخاب کنید 👇", {
      reply_markup: keyboard(id),
    });
    return;
  }

  // میان‌بر: «/cert نام» - نام همین‌جاست، فقط جنسیت مانده.
  const n = normalizeName(raw);
  if (!n.ok) {
    await ctx.reply("❌ " + n.reason + "\nدوباره بنویسید: /cert نام و نام‌خانوادگی");
    return;
  }
  if (!(await preflight(ctx))) return;
  await leaveCertFlow(ctx);

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
    await leaveCertFlow(ctx);
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

  // دستورِ بی‌نام: جنسیت انتخاب شد، حالا منتظرِ نام می‌مانیم.
  if (job.status === "awaiting_name") {
    await setUserState(ctx.env, ctx.from.id, {
      current_flow: CERT_FLOW,
      current_step: CERT_STEP,
      temp_data: { job: job.id },
    });
    await ctx.answerCallbackQuery({ text: GENDER_LABEL[act] }).catch(() => {});
    await ctx
      .editMessageText(
        "✅ " + GENDER_LABEL[act] + "\n\nحالا نامِ دانشجو را بنویسید و بفرستید:\n(مثلاً: سید محمد سرآبادانی)",
        {
          reply_markup: {
            inline_keyboard: [[{ text: "✖️ لغو", callback_data: CERT_PREFIX + "x|" + job.id, style: "danger" }]],
          },
        }
      )
      .catch(() => {});
    return;
  }

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
 * مدیر نامِ دانشجو را تایپ کرده (پس از انتخابِ جنسیت).
 *
 * نامِ نامعتبر حالت را نمی‌بندد: مدیر دوباره می‌نویسد یا «لغو» را می‌زند.
 * ولی درخواستِ منقضی یا از دست رفته حالت را پاک می‌کند، تا مدیر برای
 * همیشه «وسطِ گواهی» نماند و پیام‌های بعدی‌اش بلعیده نشود.
 */
export async function handleCertNameText(ctx, state) {
  const leave = () => clearUserState(ctx.env, ctx.from.id);
  if (!isOwner(ctx)) {
    await leave();
    return;
  }

  const id = state && state.temp_data && state.temp_data.job;
  const job = id ? await getJob(ctx.env, id) : null;
  if (!job || job.owner_id !== String(ctx.from.id) || job.status !== "awaiting_name") {
    await leave();
    await ctx.reply("این درخواست دیگر معتبر نیست؛ دوباره /cert را بزنید.");
    return;
  }

  const n = normalizeName(ctx.message.text);
  if (!n.ok) {
    await ctx.reply("❌ " + n.reason + "\nدوباره نام را بنویسید، یا دکمه‌ی «لغو» را بزنید.");
    return;
  }

  if ((await countActive(ctx.env)) >= MAX_ACTIVE) {
    await ctx.reply("چند گواهی در حال ساختن است؛ چند لحظه صبر کنید و نام را دوباره بفرستید.");
    return;
  }

  const r = await submitName(ctx.env, { id, ownerId: ctx.from.id, name: n.name });
  await leave();
  if (!r.ok) {
    await ctx.reply(r.why === "expired" ? GONE_TEXT.expired : GONE_TEXT.gone);
    return;
  }

  const queued = r.job;
  const text =
    "⏳ گواهیِ «" + queued.name + "» (" + GENDER_LABEL[queued.gender] + ") در حال ساخت است." +
    (n.converted ? "\n(حروفِ عربی به فارسی تبدیل شد.)" : "") +
    "\nحدود یک دقیقه طول می‌کشد و همین‌جا می‌آید.";

  // همان پیامی که دکمه‌ی «لغو» داشت، به پیامِ وضعیت تبدیل می‌شود؛ شکستش
  // (مثلاً پیام پاک شده) پیامِ تازه می‌فرستد و بعدی‌ها هم از notify می‌آیند.
  let edited = false;
  if (queued.message_id) {
    try {
      await ctx.api.editMessageText(queued.chat_id, queued.message_id, text, {
        reply_markup: NO_KEYBOARD,
      });
      edited = true;
    } catch {
      edited = false;
    }
  }
  if (!edited) await ctx.reply(text);

  // اگر ورک‌فلو راه نیفتد، startRender خودش درخواست را شکست‌خورده اعلام
  // و به مدیر خبر می‌دهد.
  await startRender(ctx.env, queued);
}

/**
 * مسیریابیِ متنِ مدیر وقتی منتظرِ نامِ گواهی هستیم.
 *
 * ضربه‌ی یک دکمه‌ی منو نامِ دانشجو حساب نمی‌شود: «تماس با ما» حروفِ فارسیِ
 * مجاز است و بی‌این بررسی گواهی‌ای به نامِ «تماس با ما» ساخته می‌شد. مدیر که
 * دکمه‌ی منو را زده از گواهی بیرون آمده - حالت پاک می‌شود و همان دکمه کارِ
 * خودش را می‌کند.
 *
 * @param {(env: object, text: string) => Promise<unknown>} resolveMenuAction
 * @returns {Promise<boolean>} true یعنی متن مالِ گواهی بود و مصرف شد؛ false
 *   یعنی مسیریابیِ عادی باید ادامه بدهد.
 */
export async function routeCertName(ctx, state, resolveMenuAction) {
  if (await resolveMenuAction(ctx.env, ctx.message.text)) {
    await clearUserState(ctx.env, ctx.from.id);
    return false;
  }
  await handleCertNameText(ctx, state);
  return true;
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
