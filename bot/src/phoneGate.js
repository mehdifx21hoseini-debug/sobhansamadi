// دروازه‌ی شماره: دو بخش که پیش از باز شدن، شماره‌ی کاربر را می‌خواهند.
//
// دوره‌ی مقدماتی و اکسپرت مدیریت سرمایه گران‌ترین چیزهایی هستند که
// آکادمی رایگان می‌دهد. تا امروز هر کسی آن‌ها را می‌گرفت و می‌رفت، بی
// آنکه راهی برای تماس دوباره بماند - نه شماره‌ای، نه فهرستی.
//
// یک بار پرسیده می‌شود، نه هر بار: کسی که شماره‌اش در دفترچه هست
// مستقیم رد می‌شود. کسی که در مسیر ثبت‌نام یا مشاوره شماره داده هم
// همان‌جا در دفترچه ثبت شده، پس اینجا دوباره معطل نمی‌شود.

import { Keyboard } from "grammy";
import { setUserState, clearUserState } from "./db.js";
import { hasPhone, savePhone } from "./phones.js";
import { mainMenuKeyboard } from "./menu.js";
import { sendFreeIntro, sendExpert } from "./contentMenus.js";

export const GATE_FLOW = "phone_gate";

// کلید مقصد → برچسبی که در دفترچه می‌نشیند و کاری که بعد از گرفتن
// شماره انجام می‌شود.
//
// برچسب فارسی است چون همان چیزی است که در خروجی CRM دیده می‌شود؛ یک
// کلید انگلیسی آنجا باید دوباره ترجمه می‌شد - یک جای دیگر که باید
// هم‌گام بماند.
const TARGETS = {
  INTRO_COURSE: { source: "دوره مقدماتی", run: sendFreeIntro },
  EXPERT: { source: "اکسپرت مدیریت سرمایه", run: sendExpert },
};

const BACK = "🔙 برگشت";

function contactKeyboard() {
  return new Keyboard().requestContact("ارسال شماره موبایل ☎️").row().text(BACK).resized();
}

function askText(source) {
  return [
    "☎️ برای دسترسی به «" + source + "» لطفاً شماره موبایل خود را ارسال کنید.",
    "",
    "روی دکمه «ارسال شماره موبایل ☎️» در پایین صفحه بزنید تا شماره‌تان به‌صورت خودکار ارسال شود.",
    "",
    "⚠️ شماره را دستی تایپ نکنید؛ فقط از همان دکمه استفاده کنید.",
  ].join("\n");
}

/**
 * اگر شماره را داریم true برمی‌گرداند و صداکننده بخش را باز می‌کند.
 * وگرنه خودش شماره را می‌خواهد و false می‌دهد.
 */
export async function requirePhone(ctx, target) {
  const gate = TARGETS[target];
  if (!gate) return true;

  if (await hasPhone(ctx.env, ctx.from.id)) return true;

  // اگر از راه یک دکمه آمده‌ایم، ساعت شنی باید همین‌جا برداشته شود.
  // خطایش نادیده گرفته می‌شود چون بعضی صداکننده‌ها خودشان قبلاً پاسخ
  // داده‌اند و پاسخ دوم را تلگرام رد می‌کند - که اشکالی ندارد.
  if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});

  await setUserState(ctx.env, ctx.from.id, {
    current_flow: GATE_FLOW,
    current_step: "ask_phone",
    temp_data: { target },
  });
  await ctx.reply(askText(gate.source), { reply_markup: contactKeyboard() });
  return false;
}

/**
 * شماره‌ای که کاربر با دکمه فرستاده.
 *
 * فقط شماره‌ی خودِ کاربر پذیرفته می‌شود: دکمه‌ی requestContact همیشه
 * شماره‌ی خود فرد را می‌فرستد، ولی کاربر می‌تواند به‌جایش مخاطبِ کس
 * دیگری را از منوی پیوست بفرستد - و آن‌وقت شماره‌ی یک آدم بی‌خبر در
 * فهرست تماس آکادمی می‌نشست.
 */
export async function handleGateContact(ctx, state) {
  const target = (state && state.temp_data && state.temp_data.target) || "";
  const gate = TARGETS[target];
  const contact = ctx.message.contact;

  if (!gate) {
    await clearUserState(ctx.env, ctx.from.id);
    await ctx.reply("منوی اصلی:", { reply_markup: mainMenuKeyboard() });
    return;
  }

  if (String(contact.user_id || "") !== String(ctx.from.id)) {
    await ctx.reply(
      "⚠️ لطفاً شماره‌ی خودتان را بفرستید، نه مخاطب دیگری.\n\nروی دکمه «ارسال شماره موبایل ☎️» بزنید.",
      { reply_markup: contactKeyboard() }
    );
    return;
  }

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim();
  await savePhone(ctx.env, {
    telegramUserId: ctx.from.id,
    phone: contact.phone_number,
    name: name || ctx.from.first_name || "",
    username: ctx.from.username || "",
    source: gate.source,
  }).catch((err) => console.error("ثبت شماره در دفترچه شکست خورد:", err && err.message));

  await clearUserState(ctx.env, ctx.from.id);

  // کیبورد شماره باید همین‌جا برداشته شود، وگرنه تا پیام بعدی جای منوی
  // اصلی را می‌گیرد و کاربر بعد از دیدن دوره راهی به منو ندارد.
  await ctx.reply("✅ شماره شما ثبت شد.", { reply_markup: { remove_keyboard: true } });
  await gate.run(ctx);
}

/**
 * متنی که کاربر به‌جای زدن دکمه می‌نویسد.
 *
 * شماره‌ی تایپ‌شده پذیرفته نمی‌شود - همان قاعده‌ی مسیر ثبت‌نام: شماره‌ی
 * دستی غلط تایپ می‌شود و تا وقتی کسی زنگ نزند معلوم نمی‌شود.
 */
export async function handleGateText(ctx, state) {
  if (ctx.message.text.trim() === BACK) {
    await clearUserState(ctx.env, ctx.from.id);
    await ctx.reply("منوی اصلی:", { reply_markup: mainMenuKeyboard() });
    return;
  }

  const target = (state && state.temp_data && state.temp_data.target) || "";
  const gate = TARGETS[target];
  await ctx.reply(
    "❗️ برای دسترسی به این بخش باید شماره‌تان را با همان دکمه بفرستید." +
      (gate ? "\n\n«" + gate.source + "» بعد از ثبت شماره باز می‌شود." : ""),
    { reply_markup: contactKeyboard() }
  );
}
