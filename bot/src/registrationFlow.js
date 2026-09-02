import { InlineKeyboard, Keyboard } from "grammy";
import { getUserState, setUserState, clearUserState, createLead, readUserSource } from "./db.js";
import { upsertBotLead } from "./crm/intake.js";
import { ensureCrmSchema } from "./crm/schema.js";
import { mainMenuKeyboard } from "./menu.js";
import { sendSection, resolveSection, sendChannelFile } from "./content/sectionText.js";
import { supportChatUrl, supportPrefill, supportUsername } from "./supportContact.js";
import { savePhone } from "./phones.js";

const COURSE_LABELS = {
  COURSE_PSY: "🧠 دوره روانشناسی",
  COURSE_TECH: "📚 مجموعه آموزشی پیشرفته",
  COURSE_BOTH: "📘 هر دو دوره",
};

// شیء خام و نه سازنده‌ی InlineKeyboard: گرامی فیلد style را بی‌صدا دور
// می‌ریزد و دکمه‌ها بی‌رنگ می‌شوند.
//
// «هر دو دوره» سبز است و آن دو آبی: سه گزینه‌ی هم‌رنگ یعنی سه گزینه‌ی
// هم‌ارزش، در حالی که این یکی کامل‌ترین مسیر است و باید در یک نگاه
// معلوم باشد.
//
// ترتیب هم تصادفی نیست: «مجموعه آموزشی پیشرفته» اول می‌آید چون کاربر
// معمولاً از دکمه‌ی هم‌نامِ منو به اینجا رسیده و باید همان چیزی را که
// رویش زده، اول ببیند.
function courseChoiceKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📚 مجموعه آموزشی پیشرفته", callback_data: "COURSE_TECH", style: "primary" }],
      [{ text: "🧠 دوره روانشناسی", callback_data: "COURSE_PSY", style: "primary" }],
      [{ text: "📘 هر دو دوره", callback_data: "COURSE_BOTH", style: "success" }],
      [{ text: "🏠 منوی اصلی", callback_data: "MENU_MAIN" }],
    ],
  };
}

function cancelOnlyKeyboard() {
  return { inline_keyboard: [[{ text: "❌ لغو فرآیند", callback_data: "FLOW_CANCEL", style: "danger" }]] };
}

// پرسشِ حساب ریل دو جوابِ ممکن دارد و نه بیشتر، پس دکمه است نه متنِ
// آزاد: هم برای کاربر یک ضربه است، هم پاسخ در CRM یکدست می‌ماند و
// می‌شود رویش فیلتر گذاشت. با متنِ آزاد، «دارم» و «بله» و «آره» سه
// مقدارِ متفاوت می‌شدند.
function realAccountKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "✅ بله، دارم", callback_data: "REAL_YES", style: "success" }],
      [{ text: "❌ خیر، ندارم", callback_data: "REAL_NO" }],
      [{ text: "❌ لغو فرآیند", callback_data: "FLOW_CANCEL", style: "danger" }],
    ],
  };
}

/**
 * سه پرسشِ دیگر هم دکمه‌ای شدند، به همان دلیلِ حساب ریل.
 *
 * پاسخِ آزاد برای این‌ها هم گران بود: «۲ سال»، «دو سال»، «حدود ۲ سال»
 * و «۲۴ ماه» یک چیزند و در CRM چهار مقدارِ متفاوت می‌شدند - نه قابلِ
 * شمردن، نه قابلِ فیلتر. حالا مقدار از یک فهرستِ بسته می‌آید.
 *
 * ترتیبِ گزینه‌ها از کم به زیاد است تا کاربر بدون خواندنِ همه، جای
 * خودش را پیدا کند.
 *
 * متنِ دکمه همان چیزی است که ذخیره می‌شود؛ callback_data فقط یک اندیس
 * است چون تلگرام سقفِ ۶۴ بایت دارد و متنِ فارسی زود از آن رد می‌شود.
 */
const CHOICES = {
  level: {
    prefix: "LVL",
    field: "level",
    next: "ask_experience",
    options: [
      "🌱 مبتدی - تازه شروع کرده‌ام",
      "📗 مقدماتی - اصول را می‌دانم",
      "📘 متوسط - تحلیل می‌کنم ولی استراتژی ثابت ندارم",
      "📙 پیشرفته - استراتژی دارم و اجرا می‌کنم",
    ],
  },
  experience: {
    prefix: "EXP",
    field: "experience",
    next: "ask_real",
    options: [
      "کمتر از ۶ ماه",
      "۶ ماه تا ۱ سال",
      "۱ تا ۳ سال",
      "بیشتر از ۳ سال",
    ],
  },
  trade: {
    prefix: "TRD",
    field: "trade_status",
    next: "confirm",
    options: [
      "📉 بیشتر در ضرر بوده‌ام",
      "⚖️ تقریباً سربه‌سر",
      "📈 در مجموع سودده بوده‌ام",
      "🎢 نوسان زیاد دارد، ثابت نیست",
    ],
  },
};

function choiceKeyboard(kind) {
  const spec = CHOICES[kind];
  const rows = spec.options.map((text, i) => [
    { text, callback_data: spec.prefix + "|" + i },
  ]);
  rows.push([{ text: "❌ لغو فرآیند", callback_data: "FLOW_CANCEL", style: "danger" }]);
  return { inline_keyboard: rows };
}

// هر سه پرسشِ دکمه‌ای یک مسیر دارند، پس یک تابع - وگرنه سه نسخه‌ی
// تقریباً یکسان می‌شد که روزی یکی‌شان اصلاح می‌شد و دوتای دیگر نه.
const STEP_OF_CHOICE = { level: "ask_level", experience: "ask_experience", trade: "ask_trade" };
const SECTION_OF_STEP = {
  ask_level: "CONSULT_LEVEL",
  ask_experience: "CONSULT_EXPERIENCE",
  ask_trade: "CONSULT_TRADE",
};
const KIND_OF_STEP = { ask_level: "level", ask_experience: "experience", ask_trade: "trade" };

async function applyChoice(ctx, flow, temp, kind, value) {
  const spec = CHOICES[kind];
  const next = { ...temp, [spec.field]: value };
  await setUserState(ctx.env, ctx.from.id, { current_step: spec.next, temp_data: next });

  if (spec.next === "confirm") {
    await ctx.reply(buildConfirmText(flow, next), { reply_markup: confirmCancelKeyboard() });
    return;
  }
  if (spec.next === "ask_real") {
    await sendSection(ctx, "CONSULT_REAL", realAccountKeyboard());
    return;
  }
  const nextKind = KIND_OF_STEP[spec.next];
  await sendSection(ctx, SECTION_OF_STEP[spec.next], choiceKeyboard(nextKind));
}

export async function handleChoiceButton(ctx, data) {
  const [prefix, idxRaw] = String(data).split("|");
  const kind = Object.keys(CHOICES).find((k) => CHOICES[k].prefix === prefix);
  if (!kind) return;

  const state = await getUserState(ctx.env, ctx.from.id);
  // دکمه‌ی یک پیامِ قدیمی‌تر نباید فرم را به عقب برگرداند: فقط وقتی
  // پذیرفته می‌شود که کاربر واقعاً روی همین پرسش ایستاده باشد.
  if (!state || state.current_step !== STEP_OF_CHOICE[kind]) return;

  const value = CHOICES[kind].options[Number(idxRaw)];
  if (!value) return;

  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  await applyChoice(ctx, state.current_flow, state.temp_data || {}, kind, value);
}

/**
 * پاسخِ حساب ریل، از هر دو راه (دکمه یا متن).
 *
 * «ندارم» یعنی پرسشِ وضعیتِ ترید معنی ندارد و پرسیدنش کاربر را گیج
 * می‌کند - پس مستقیم به تایید می‌رود. یک مرحله‌ی کمتر برای کسی که
 * تازه‌کار است، دقیقاً همان‌جایی که بیشترین ریزش را دارد.
 */
async function applyRealAnswer(ctx, flow, temp, yes) {
  const next = { ...temp, has_real_account: yes ? "بله" : "خیر" };
  if (!yes) {
    await setUserState(ctx.env, ctx.from.id, { current_step: "confirm", temp_data: next });
    await ctx.reply(buildConfirmText(flow, next), { reply_markup: confirmCancelKeyboard() });
    return;
  }
  await setUserState(ctx.env, ctx.from.id, { current_step: "ask_trade", temp_data: next });
  await sendSection(ctx, "CONSULT_TRADE", choiceKeyboard("trade"));
}

function requestContactKeyboard() {
  return new Keyboard()
    .requestContact("ارسال شماره موبایل ☎️")
    .row()
    .text("🔙 برگشت")
    .resized();
}

// تایید سبز و انصراف قرمز: در مرحله‌ی آخر یک ثبت‌نام، ضربه‌ی اشتباه
// گران‌ترین جای کل مسیر است.
function confirmCancelKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "✅ تایید نهایی", callback_data: "CONFIRM_YES", style: "success" }],
      [{ text: "❌ انصراف", callback_data: "FLOW_CANCEL", style: "danger" }],
    ],
  };
}

function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("98")) return "0" + digits.slice(2);
  if (digits.length === 10 && digits.startsWith("9")) return "0" + digits;
  return digits;
}

// یک متن تایید برای هر دو مسیر.
//
// پیش‌تر مسیر ثبت‌نام متن جداگانه‌ای داشت که فقط نام و شماره و دوره را
// نشان می‌داد - چون آن مسیر هم فقط همان‌ها را می‌پرسید. حالا که هر دو
// یک سوال‌نامه دارند، دو متن یعنی دو جای دیگر که باید هم‌گام بمانند.
//
// هر فیلدی که پر نشده باشد اصلاً نمایش داده نمی‌شود، نه با «undefined»
// روبه‌روی برچسبش.
function buildConfirmText(flow, temp) {
  // «✅ اطلاعات شما ثبت شد» اینجا بود و برداشته شد: هنوز چیزی ثبت نشده و
  // کاربر باید تایید کند. کسی که آن جمله را می‌خواند فکر می‌کرد کارش
  // تمام است و دکمه‌ی تایید را نمی‌زد - لیدی که تا آخر آمده بود و در
  // آخرین قدم گم می‌شد، بدون اینکه هیچ‌جا دیده شود.
  const lines = ["📋 لطفاً اطلاعات زیر را بررسی کنید:", ""];

  const fields = [
    ["👤 نام", temp.name],
    ["📱 موبایل", temp.phone],
    ["🎯 دوره موردنظر", temp.course],
    ["📊 دانش در مارکت", temp.level],
    ["⏳ مدت فعالیت", temp.experience],
    ["💼 حساب ریل", temp.has_real_account],
    ["📈 وضعیت ترید", temp.trade_status],
  ];
  for (const [label, value] of fields) {
    if (value) lines.push(label + ": " + value);
  }

  lines.push("");
  lines.push("اگر اطلاعات صحیح است، روی «✅ تایید نهایی» بزنید.");
  return lines.join("\n");
}

/**
 * @param {object} opts
 * @param {boolean} opts.skipCourseChoice پرسیدن دوره را رد کن و مستقیم
 *   سراغ فرم برو. فقط ورودیِ پایان دوره‌ی مقدماتی این را می‌دهد: آنجا
 *   کاربر تازه یک دوره را تمام کرده و روی دکمه‌ای زده که اسم دوره‌ی بعدی
 *   رویش نوشته - پرسیدن دوباره‌اش یک قدم اضافه است بین «بله می‌خواهم» و
 *   «اینم مشخصاتم».
 *
 *   ورودی منوی اصلی این را نمی‌دهد و هر سه گزینه را نشان می‌دهد، چون
 *   کسی که از منو می‌آید هنوز چیزی انتخاب نکرده.
 */
export async function startFlow(ctx, flow, promptOverride, { skipCourseChoice = false } = {}) {
  if (skipCourseChoice) {
    // دوره همین‌جا ثبت می‌شود تا آن سر ماجرا، در CRM، ستون دوره خالی نماند.
    await setUserState(ctx.env, ctx.from.id, {
      current_flow: flow,
      current_step: "ask_name",
      temp_data: { course: COURSE_LABELS.COURSE_TECH },
    });
    if (promptOverride) await ctx.reply(promptOverride);
    await ctx.reply("👤 نام و نام خانوادگی خود را وارد کنید:", {
      reply_markup: cancelOnlyKeyboard(),
    });
    return;
  }

  await setUserState(ctx.env, ctx.from.id, {
    current_flow: flow,
    current_step: "choose_course",
    temp_data: {},
  });

  if (promptOverride) {
    await ctx.reply(promptOverride, { reply_markup: courseChoiceKeyboard() });
    return;
  }
  if (flow === "registration") {
    await ctx.reply("برای ثبت‌نام، لطفاً دوره موردنظر خود را انتخاب کنید:", {
      reply_markup: courseChoiceKeyboard(),
    });
    return;
  }
  await sendSection(ctx, "CONSULT_START", courseChoiceKeyboard());
}

// ویسِ توضیحاتِ استاد برای هر دوره. از کانال می‌آید (هشتگِ هم‌نام)، پس
// عوض کردنش یک پستِ تازه است نه یک دیپلوی.
//
// «هر دو دوره» هر دو ویس را می‌گیرد - کسی که هر دو را می‌خواهد، درباره‌ی
// هر دو هم باید بشنود.
const COURSE_VOICES = {
  COURSE_TECH: ["COURSE_TECH_VOICE"],
  COURSE_PSY: ["COURSE_PSY_VOICE"],
  COURSE_BOTH: ["COURSE_TECH_VOICE", "COURSE_PSY_VOICE"],
};

export async function handleCourseChoice(ctx, cb) {
  const state = await getUserState(ctx.env, ctx.from.id);
  if (!state || !COURSE_LABELS[cb]) return;
  const temp = { ...state.temp_data, course: COURSE_LABELS[cb] };

  // دکمه‌ها از پیامِ انتخاب برداشته می‌شوند تا کسی وسطِ فرم دوره را عوض
  // نکند و دو نیمه‌ی ناهمخوان بسازد.
  await ctx.editMessageText("🎯 دوره‌ی انتخابی شما: " + COURSE_LABELS[cb], { reply_markup: undefined })
    .catch(() => {});

  // ویسِ استاد پیش از فرم می‌رود: کسی که هنوز نمی‌داند دوره چیست، فرم پر
  // نمی‌کند. نبودنش فرم را متوقف نمی‌کند - تا وقتی آکادمی ویس را در
  // کانال نگذاشته، مسیر مثل قبل ادامه پیدا می‌کند.
  await sendCourseVoices(ctx, cb);

  await setUserState(ctx.env, ctx.from.id, { current_step: "ask_name", temp_data: temp });
  await sendSection(ctx, "CONSULT_INTRO");
  await ctx.reply("👤 نام و نام خانوادگی خود را وارد کنید:", {
    reply_markup: cancelOnlyKeyboard(),
  });
}

async function sendCourseVoices(ctx, cb) {
  for (const id of COURSE_VOICES[cb] || []) {
    await sendChannelFile(ctx, id).catch((err) =>
      console.error("ارسال ویسِ دوره شکست خورد:", id, err && err.message)
    );
  }
}

export async function handleRealChoice(ctx, cb) {
  const state = await getUserState(ctx.env, ctx.from.id);
  if (!state || state.current_step !== "ask_real") return;
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  await applyRealAnswer(ctx, state.current_flow, state.temp_data || {}, cb === "REAL_YES");
}

export async function handleText(ctx, state) {
  const step = state.current_step;
  const flow = state.current_flow;
  const text = ctx.message.text.trim();
  const temp = { ...state.temp_data };

  if (step === "ask_name") {
    temp.name = text;
    await setUserState(ctx.env, ctx.from.id, { current_step: "ask_phone", temp_data: temp });
    const promptText =
      flow === "consultation"
        ? "☎️ شماره موبایل خود را برای هماهنگی مشاوره ارسال کنید.\n\nلطفاً روی دکمه «☎️ ارسال شماره موبایل» بزنید تا شماره شما به‌صورت خودکار برای ما ارسال شود."
        : "📌 برای وارد کردن شماره، روی دکمه «☎️ ارسال شماره موبایل» در پایین صفحه کلیک کنید 👇\n\n⚠️ توجه: لطفاً شماره خود را دستی تایپ نکنید!";
    await ctx.reply(promptText, { reply_markup: requestContactKeyboard() });
    return;
  }

  if (step === "ask_phone") {
    if (text === "🔙 برگشت") {
      await setUserState(ctx.env, ctx.from.id, { current_step: "ask_name" });
      await ctx.reply("نام و نام خانوادگی خود را وارد کنید:", { reply_markup: { remove_keyboard: true } });
      await ctx.reply("👆", { reply_markup: cancelOnlyKeyboard() }).catch(() => {});
      return;
    }
    await ctx.reply("❗️ لطفاً فقط از دکمه «ارسال شماره موبایل ☎️» استفاده کنید؛ شماره تایپ‌شده پذیرفته نمی‌شود.", {
      reply_markup: requestContactKeyboard(),
    });
    return;
  }

  // چهار پرسشِ آخر دکمه دارند. اگر کاربر به‌جای زدنِ دکمه تایپ کند،
  // متنش با گزینه‌ها تطبیق داده می‌شود - وگرنه پرسش دوباره می‌آید.
  //
  // بدونِ این تطبیق، کسی که «متوسط» را تایپ می‌کرد پشتِ پرسشی گیر
  // می‌افتاد که جوابش را داده بود.
  if (KIND_OF_STEP[step]) {
    const kind = KIND_OF_STEP[step];
    const match = CHOICES[kind].options.find(
      (o) => o === text || o.replace(/^[^؀-ۿ]+/, "").startsWith(text)
    );
    if (!match) {
      await ctx.reply("لطفاً یکی از گزینه‌های زیر را بزنید 👇", {
        reply_markup: choiceKeyboard(kind),
      });
      return;
    }
    await applyChoice(ctx, flow, temp, kind, match);
    return;
  }

  // پرسش حساب ریل دکمه دارد، ولی کاربر ممکن است به‌جای زدنِ دکمه تایپ
  // کند. «بله/آره/دارم» و «نه/ندارم» شناخته می‌شوند تا کسی پشتِ یک
  // پرسشِ دوگزینه‌ای گیر نکند.
  if (step === "ask_real") {
    const yes = /^(بله|بلی|آره|اره|دارم|yes|y)$/i.test(text);
    const no = /^(خیر|نه|ندارم|no|n)$/i.test(text);
    if (!yes && !no) {
      await ctx.reply("لطفاً یکی از دو دکمه‌ی زیر را بزنید 👇", { reply_markup: realAccountKeyboard() });
      return;
    }
    await applyRealAnswer(ctx, flow, temp, yes);
    return;
  }

  // موضوع، آخرین پرسش است. پیش‌تر یک پرسش «زمان مناسب تماس» هم بعدش
  // بود؛ برداشته شد چون تیم فروش در هر ساعتی که برسد زنگ می‌زند و آن
  // پاسخ عملاً استفاده نمی‌شد - یک مرحله‌ی اضافه در انتهای فرم، درست
  // همان‌جایی که بیشترین ریزش را دارد.
  //
  // «ask_time» هنوز پذیرفته می‌شود: کاربری که لحظه‌ی انتشار وسط همین
  // مرحله بود، وگرنه به یک بن‌بستِ بی‌پاسخ می‌خورد.
  if (step === "ask_topic" || step === "ask_time") {
    if (step === "ask_topic") temp.topic = text;
    await setUserState(ctx.env, ctx.from.id, { current_step: "confirm", temp_data: temp });
    // بدون parse_mode: متن هیچ تگی ندارد و نام کاربر مستقیم داخلش
    // می‌نشیند. با HTML، نامی که یک < داشته باشد کل پیام را از سمت
    // تلگرام رد می‌کرد و کاربر در انتهای فرم به دیوار می‌خورد.
    await ctx.reply(buildConfirmText(flow, temp), { reply_markup: confirmCancelKeyboard() });
    return;
  }
}

export async function handleContact(ctx) {
  const state = await getUserState(ctx.env, ctx.from.id);
  if (!state || state.current_step !== "ask_phone") return;

  const phone = normalizePhone(ctx.message.contact.phone_number);
  const temp = { ...state.temp_data, phone };
  await setUserState(ctx.env, ctx.from.id, { phone, temp_data: temp });

  // همان شماره در دفترچه هم می‌نشیند.
  //
  // دو دلیل: خروجی شماره‌ها باید همه‌ی شماره‌هایی را داشته باشد که
  // داریم، نه فقط آن‌هایی که از دروازه‌ی دوره‌ها آمده‌اند؛ و کسی که
  // اینجا شماره داده نباید چند دقیقه بعد سر دوره‌ی مقدماتی دوباره
  // پرسیده شود. شکستش نباید جلوی ثبت‌نام را بگیرد - رکورد اصلی لید است.
  await savePhone(ctx.env, {
    telegramUserId: ctx.from.id,
    phone,
    name: temp.name || ctx.from.first_name || "",
    username: ctx.from.username || "",
    source: state.current_flow === "registration" ? "ثبت‌نام" : "مشاوره",
  }).catch((err) => console.error("ثبت شماره در دفترچه شکست خورد:", err && err.message));

  await ctx.reply("✅ شماره شما با موفقیت ثبت شد.", { reply_markup: { remove_keyboard: true } });

  // هر دو مسیر از اینجا یک راه می‌روند.
  //
  // پیش‌تر مسیر ثبت‌نام (دکمه‌ی «مجموعه آموزشی پیشرفته» در پایان دوره‌ی
  // مقدماتی) مستقیم به تایید می‌رفت و سه سوال بعدی را نمی‌پرسید. نتیجه‌اش
  // این بود که هر لیدی که از آن دکمه می‌آمد، در CRM ستون‌های سطح، موضوع
  // و زمان تماسش خالی بود - و مشاور بدون هیچ زمینه‌ای زنگ می‌زد، آن هم
  // به کسی که تازه شانزده جلسه را تمام کرده و آماده‌ترین مشتری است.
  await setUserState(ctx.env, ctx.from.id, { current_step: "ask_level" });
  await sendSection(ctx, "CONSULT_LEVEL", choiceKeyboard("level"));
}

export async function handleConfirm(ctx) {
  const state = await getUserState(ctx.env, ctx.from.id);
  if (!state) return;
  const temp = state.temp_data;
  const acqSource = await readUserSource(ctx.env, ctx.from.id).catch(() => null);

  const lead = {
    request_type: state.current_flow === "registration" ? "ثبت‌نام" : "مشاوره",
    telegram_user_id: ctx.from.id,
    username: ctx.from.username,
    name: temp.name,
    phone: temp.phone,
    course: temp.course,
    level: temp.level,
    topic: temp.topic,
    experience: temp.experience,
    has_real_account: temp.has_real_account,
    trade_status: temp.trade_status,
    // دیگر پرسیده نمی‌شود، ولی کلید می‌ماند: JSON.stringify کلیدِ
    // undefined را حذف می‌کند و آن‌طرف در n8n ستونِ غایب با ستونِ خالی
    // یکی نیست.
    preferred_time: temp.preferred_time || "",
    confirmed: "true",
    // اگر کاربر از یک لینک عمیق آمده بود، همان کمپین روی لید می‌نشیند -
    // این‌طور در CRM معلوم است هر مشتری از کجا آمده، نه فقط «تلگرام».
    source: acqSource ? "telegram_bot:" + acqSource : "telegram_bot",
  };

  await createLead(ctx.env, lead);

  // پنل CRM حالا از crm_leads در D1 می‌خواند، پس لید باید همان‌جا هم
  // بنشیند - وگرنه مشتری‌ای که همین حالا ثبت‌نام کرده در فهرست مشاورها
  // دیده نمی‌شود. خطایش بلعیده می‌شود چون رکورد اصلی در جدول leads است.
  //
  // upsert است نه insert: اگر همین شماره لید قبلی داشته باشد، یادداشت
  // تازه به همان پرونده می‌چسبد. بدون این، مشتریِ برگشته یک ردیف دوم
  // می‌سازد و دو مشاور به یک نفر زنگ می‌زنند - قاعده‌ای که n8n داشت.
  const saved = await ensureCrmSchema(ctx.env)
    .then(() => upsertBotLead(ctx.env, lead))
    .catch((err) => {
      console.error("نوشتن لید در crm_leads شکست خورد:", err && err.message);
      return null;
    });

  await clearUserState(ctx.env, ctx.from.id);

  await ctx.editMessageText("✅ اطلاعات شما تایید و ثبت شد.", { reply_markup: undefined });
  await sendLeadDone(ctx);
  await sendSupportInvite(ctx, {
    leadId: saved && saved.lead_id,
    name: temp.name,
    course: temp.course,
    level: temp.level,
    experience: temp.experience,
    hasRealAccount: temp.has_real_account,
    tradeStatus: temp.trade_status,
  });
}

export async function handleCancel(ctx) {
  await clearUserState(ctx.env, ctx.from.id);
  await ctx.reply("فرآیند لغو شد. به منوی اصلی برگشتید.", { reply_markup: mainMenuKeyboard() });
}

// پیام پایان، بدون parse_mode: متنش قابل ویرایش است و یک «<» در چیزی که
// مدیر می‌نویسد کل پیام را رد می‌کند.
async function sendLeadDone(ctx) {
  const { text } = await resolveSection(ctx.env, "LEAD_DONE");
  await ctx.reply(text, { reply_markup: mainMenuKeyboard() });
}

/**
 * دعوت به پشتیبانی، درست بعد از «ثبت شد».
 *
 * دکمه چت پشتیبانی را با پیامِ آماده باز می‌کند. رنگ دکمه دستِ ما نیست -
 * تلگرام همه‌شان را هم‌رنگ تمِ کاربر می‌کشد - پس ✅ کارِ رنگ سبز را
 * می‌کند.
 *
 * شکستش بلعیده می‌شود: لید ثبت شده و کاربر «ثبت شد» را گرفته؛ یک پیامِ
 * تکمیلی نباید آن لحظه را به خطا تبدیل کند.
 */
async function sendSupportInvite(ctx, info) {
  try {
    const { text } = await resolveSection(ctx.env, "LEAD_SUPPORT");
    const url = supportChatUrl(ctx.env, supportPrefill(info));
    const body = text + "\n\n🆔 @" + supportUsername(ctx.env);
    await ctx.reply(body, {
      reply_markup: new InlineKeyboard().url("✅ پیام به پشتیبانی آکادمی", url),
      // پیش‌نمایشِ لینکِ t.me زیر پیام، دکمه را از چشم می‌اندازد.
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    console.error("ارسال دعوتِ پشتیبانی شکست خورد:", err && err.message);
  }
}
