// /cert - ساختِ گواهیِ دانشجو. فقط برای مدیر.
//
// جریان:
//   ۱. مدیر می‌نویسد: /cert
//   ۲. ربات می‌گوید «لیست را بفرستید»؛ هر خط یک نفر، با «آقا» یا «خانم» اول خط
//   ۳. مدیر لیست را می‌فرستد - یک نام یا ده نام یا سی نام
//   ۴. ربات همه را یک‌جا به صف می‌برد و ورک‌فلوی رندر راه می‌افتد
//   ۵. گواهی‌ها به ترتیبِ لیست، پشتِ سرِ هم، به‌صورتِ فایل در همین گفتگو می‌آیند
//
// میان‌بر: «/cert خانم راحیل غلامی» (یا چند خط، در همان پیام) بی‌مرحله‌ی «لیست
// را بفرستید» می‌سازد.
//
// جنسیت را مدیر مشخص می‌کند، نه ربات: از روی نام نمی‌شود حدسش زد و حدسِ غلط
// یعنی «جناب آقای» روی گواهیِ یک خانم. فرمتِ لیست در list.js شرح داده شده.
//
// همه یا هیچ: اگر حتی یک خط ایراد داشته باشد، هیچ گواهی‌ای ساخته نمی‌شود و
// همه‌ی ایراد‌ها یک‌جا گفته می‌شود. نیمه‌ساختنِ یک لیست یعنی مدیر باید بفهمد
// کدام‌ها ساخته شده، و دوباره‌فرستادنش نام‌های ساخته‌شده را تکراری می‌کرد.
//
// چرا فقط مدیر: دستور اصلاً برای دیگران وجود ندارد. جوابی نمی‌دهد، حتی «این
// دستور فقط برای مدیر است» - که خودش اعلامِ وجودِ آن می‌بود. در منوی «/» هم
// فقط برای مدیر ثبت می‌شود (registry.js).

import { isOwner } from "../owner.js";
import { getUserState, setUserState, clearUserState } from "../db.js";
import { parseList, MAX_BATCH } from "../certificate/list.js";
import { enqueueBatch, cancelBatch, countActive, MAX_ACTIVE } from "../certificate/store.js";
import {
  GENDER_LABEL,
  SLOTS,
  ASSET_MAX_BYTES,
  slotForFilename,
  saveAsset,
  readAsset,
  missingAssets,
  startRender,
  refreshBatch,
  fa,
} from "../certificate/service.js";

export const CERT_PREFIX = "CERT|";
// حالتِ «منتظرِ لیست» در user_state. همان الگوی ویرایشِ برچسب و لینک.
export const CERT_FLOW = "cert_list";
export const CERT_STEP = "ask_list";

const NO_KEYBOARD = { inline_keyboard: [] };

const HOW_TO =
  "🎓 ساخت گواهی\n\n" +
  "لیستِ نام‌ها را بفرستید؛ هر خط یک نفر، با «آقا» یا «خانم» اولِ خط:\n\n" +
  "خانم راحیل غلامی\n" +
  "آقا سید محمد سرآبادانی\n\n" +
  "اگر چند نفر هم‌جنس‌اند، یک خط «خانم» یا «آقا» بنویسید و نام‌ها را زیرش بیاورید:\n\n" +
  "خانم\n" +
  "راحیل غلامی\n" +
  "فاطمه محمدی\n" +
  "آقا\n" +
  "سید محمد سرآبادانی\n\n" +
  "تا " + fa(MAX_BATCH) + " نام در هر بار. همه به ترتیب ساخته و پشتِ سرِ هم فرستاده می‌شوند.";

function waitKeyboard() {
  return {
    inline_keyboard: [[{ text: "✖️ لغو", callback_data: CERT_PREFIX + "c", style: "danger" }]],
  };
}

// پیش از ساختن: فایل‌های گواهی بارگذاری شده‌اند و صف جا دارد؟ وگرنه مدیر یک
// دقیقه بعد با شکست روبه‌رو می‌شد.
async function preflight(ctx, need) {
  const missing = await missingAssets(ctx.env);
  if (missing.length > 0) {
    await ctx.reply(
      "⚠️ فایل‌های گواهی هنوز کامل بارگذاری نشده‌اند:\n" +
        missing.map((s) => "• " + SLOTS[s].title + " (" + SLOTS[s].hint + ")").join("\n") +
        "\n\nهرکدام را به‌صورت فایل (Document) همین‌جا بفرستید. وضعیت: /certassets"
    );
    return false;
  }
  if ((await countActive(ctx.env)) + need > MAX_ACTIVE) {
    await ctx.reply(
      "چند گواهی هنوز در حال ساختن است و این لیست در صف جا نمی‌شود. چند لحظه صبر کنید و دوباره بفرستید."
    );
    return false;
  }
  return true;
}

// مدیری که /cert را دوباره می‌زند نباید در «منتظرِ لیست»ِ قبلی گیر کند - ولی
// حالتِ فرآیندِ دیگری (ویرایشِ برچسب، لینک...) را هم نباید پاک کنیم.
async function leaveCertFlow(ctx) {
  const st = await getUserState(ctx.env, ctx.from.id).catch(() => null);
  if (st && st.current_flow === CERT_FLOW) await clearUserState(ctx.env, ctx.from.id);
}

function errorText(errors, again) {
  const lines = ["❌ هیچ گواهی‌ای ساخته نشد؛ این موردها ایراد دارند:", ""];
  for (const e of errors.slice(0, 10)) {
    lines.push(e.line ? "• خط " + fa(e.line) + " «" + e.text + "» — " + e.reason : "• " + e.reason);
  }
  if (errors.length > 10) lines.push("• و " + fa(errors.length - 10) + " ایرادِ دیگر");
  lines.push("", again);
  return lines.join("\n");
}

/**
 * متنِ لیست → دسته در صف.
 * @returns {Promise<"ok"|"retry"|"stop">}
 *   retry: لیست ایراد داشت و مدیر می‌تواند اصلاح‌شده را دوباره بفرستد.
 *   stop: پیش‌نیازها (فایل‌ها، جای صف) آماده نبود؛ حالت باید پاک شود.
 */
async function build(ctx, raw, again) {
  const parsed = parseList(raw);
  if (!parsed.ok) {
    await ctx.reply(errorText(parsed.errors, again));
    return "retry";
  }
  const items = parsed.items;
  if (!(await preflight(ctx, items.length))) return "stop";

  // پیامِ پیشرفت را اول می‌فرستیم تا شناسه‌اش را بدانیم: هر ردیفِ دسته
  // همین پیام را به‌روز می‌کند، نه پیامِ جدا برای هر نام.
  const converted = items.filter((i) => i.converted).length;
  const preview = items
    .slice(0, 15)
    .map((it, i) => fa(i + 1) + ". " + GENDER_LABEL[it.gender] + " " + it.name)
    .join("\n");
  const msg = await ctx.reply(
    "⏳ " + fa(items.length) + " گواهی در صف:\n\n" + preview +
      (items.length > 15 ? "\n… و " + fa(items.length - 15) + " نامِ دیگر" : "") +
      (converted ? "\n\n(حروفِ عربی در " + fa(converted) + " نام به فارسی تبدیل شد.)" : "")
  );

  const { batchId } = await enqueueBatch(ctx.env, {
    ownerId: ctx.from.id,
    chatId: ctx.chat && ctx.chat.id != null ? ctx.chat.id : ctx.from.id,
    messageId: msg && msg.message_id ? msg.message_id : null,
    items,
  });

  // اگر ورک‌فلو راه نیفتد، startRender خودش کلِ دسته را شکست‌خورده اعلام
  // و پیامِ پیشرفت را عوض می‌کند - اینجا کاری نمی‌ماند.
  await startRender(ctx.env, batchId);
  return "ok";
}

export async function handleCert(ctx) {
  // برای غیرمدیر انگار وجود ندارد.
  if (!isOwner(ctx)) return;

  const raw = String(ctx.match || "").trim();

  // دستورِ بی‌نام: لیست را بخواه و منتظر بمان.
  if (!raw) {
    if (!(await preflight(ctx, 0))) return;
    await setUserState(ctx.env, ctx.from.id, {
      current_flow: CERT_FLOW,
      current_step: CERT_STEP,
      temp_data: {},
    });
    await ctx.reply(HOW_TO, { reply_markup: waitKeyboard() });
    return;
  }

  // میان‌بر: لیست همراهِ خودِ دستور آمده.
  await leaveCertFlow(ctx);
  await build(ctx, raw, "اصلاح‌شده را دوباره بفرستید: /cert و لیست");
}

/**
 * مدیر لیست را فرستاده (پس از «/cert»).
 *
 * لیستِ ایراددار حالت را نمی‌بندد: مدیر اصلاح‌شده را دوباره می‌فرستد یا «لغو»
 * را می‌زند. ولی وقتی پیش‌نیازها آماده نیست حالت پاک می‌شود، تا مدیر برای
 * همیشه «وسطِ گواهی» نماند و پیام‌های بعدی‌اش بلعیده نشود.
 */
export async function handleCertListText(ctx) {
  if (!isOwner(ctx)) {
    await clearUserState(ctx.env, ctx.from.id);
    return;
  }
  const r = await build(ctx, ctx.message.text, "اصلاح‌شده را دوباره بفرستید، یا دکمه‌ی «لغو» را بزنید.");
  if (r !== "retry") await clearUserState(ctx.env, ctx.from.id);
}

/**
 * مسیریابیِ متنِ مدیر وقتی منتظرِ لیستِ گواهی هستیم.
 *
 * ضربه‌ی یک دکمه‌ی منو لیست حساب نمی‌شود: «تماس با ما» حروفِ فارسیِ مجاز است
 * و بی‌این بررسی همین عبارت به‌عنوانِ نام پردازش می‌شد (البته بی‌جنسیت و
 * رد می‌شد، ولی مدیر گیر می‌ماند). مدیر که دکمه‌ی منو را زده از گواهی بیرون
 * آمده - حالت پاک می‌شود و همان دکمه کارِ خودش را می‌کند.
 *
 * @param {(env: object, text: string) => Promise<unknown>} resolveMenuAction
 * @returns {Promise<boolean>} true یعنی متن مالِ گواهی بود و مصرف شد؛ false
 *   یعنی مسیریابیِ عادی باید ادامه بدهد.
 */
export async function routeCertList(ctx, state, resolveMenuAction) {
  if (await resolveMenuAction(ctx.env, ctx.message.text)) {
    await clearUserState(ctx.env, ctx.from.id);
    return false;
  }
  await handleCertListText(ctx, state);
  return true;
}

export async function handleCertCallback(ctx) {
  // غیرمدیر: دکمه را خنثی می‌کنیم و هیچ نشانی نمی‌دهیم.
  if (!isOwner(ctx)) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  const [, act, id] = String(ctx.callbackQuery.data || "").split("|");

  // لغوِ «منتظرِ لیست».
  if (act === "c") {
    await leaveCertFlow(ctx);
    await ctx.answerCallbackQuery({ text: "لغو شد" }).catch(() => {});
    await ctx.editMessageText("✖️ لغو شد.", { reply_markup: NO_KEYBOARD }).catch(() => {});
    return;
  }

  // لغوِ باقی‌ماندنی‌های یک دسته. آنچه همین حالا در حال رندر است تمام می‌شود.
  if (act === "k" && /^[0-9a-f]{12}$/.test(id || "")) {
    const n = await cancelBatch(ctx.env, id, ctx.from.id);
    await ctx
      .answerCallbackQuery({ text: n > 0 ? fa(n) + " مورد لغو شد" : "چیزی برای لغو نمانده" })
      .catch(() => {});
    await refreshBatch(ctx.env, id);
    return;
  }

  await ctx.answerCallbackQuery().catch(() => {});
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
