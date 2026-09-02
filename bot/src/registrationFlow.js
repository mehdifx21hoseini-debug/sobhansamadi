import { Keyboard } from "grammy";
import { getUserState, setUserState, clearUserState, createLead, readUserSource } from "./db.js";
import { upsertBotLead } from "./crm/intake.js";
import { ensureCrmSchema } from "./crm/schema.js";
import { mainMenuKeyboard } from "./menu.js";
import {
  sendSection,
  resolveSection,
  sendChannelFile,
  sendChannelMediaWithCaption,
  editWithText,
} from "./content/sectionText.js";
import { supportChatUrl, supportPrefill, stripLeadingIcon } from "./supportContact.js";
import { savePhone } from "./phones.js";

const COURSE_LABELS = {
  COURSE_PSY: "🧠 دوره روانشناسی",
  COURSE_TECH: "📚 مجموعه آموزشی پیشرفته",
  COURSE_BOTH: "📘 هر دو دوره",
};

// انتخابِ دوره، روی کیبوردِ پایین و نه دکمه‌ی شیشه‌ای.
//
// چرا: منوی اصلی هم یک کیبوردِ پایین است، و تا وقتی این‌ها شیشه‌ای بودند
// آن منو زیرشان باقی می‌ماند - یعنی وسطِ فرم، چهار راهِ خروج جلوی چشمِ
// کاربر. برداشتنِ آن منو هم ممکن نبود: تلگرام اجازه نمی‌دهد یک پیام هم
// کیبوردِ پایین را عوض کند هم دکمه‌ی شیشه‌ای داشته باشد، پس یک پیامِ
// اضافه لازم می‌شد. حالا خودِ این کیبورد جای منو را می‌گیرد.
//
// «هر دو دوره» سبز است و آن دو آبی: سه گزینه‌ی هم‌رنگ یعنی سه گزینه‌ی
// هم‌ارزش، در حالی که این یکی کامل‌ترین مسیر است و باید در یک نگاه
// معلوم باشد. (فیلدِ style را باید دستی نوشت؛ سازنده‌های گرامی بی‌صدا
// دورش می‌ریزند.)
//
// ترتیب هم تصادفی نیست: «مجموعه آموزشی پیشرفته» اول می‌آید چون کاربر
// معمولاً از دکمه‌ی هم‌نامِ منو به اینجا رسیده و باید همان چیزی را که
// رویش زده، اول ببیند.
const COURSE_BUTTONS = [
  { text: "📚 مجموعه آموزشی پیشرفته", code: "COURSE_TECH", style: "primary" },
  { text: "🧠 دوره روانشناسی", code: "COURSE_PSY", style: "primary" },
  { text: "📘 هر دو دوره", code: "COURSE_BOTH", style: "success" },
];

const BACK_TO_MENU = "🏠 منوی اصلی";

function courseChoiceKeyboard() {
  return {
    keyboard: [
      ...COURSE_BUTTONS.map((b) => [{ text: b.text, style: b.style }]),
      [{ text: BACK_TO_MENU }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

/**
 * متنِ دکمه → کدِ دوره.
 *
 * روتر با این تصمیم می‌گیرد که یک پیامِ متنی در مرحله‌ی انتخابِ دوره،
 * ضربه‌ی یکی از همین دکمه‌هاست یا سوالی که کاربر نوشته - چون حالا هر دو
 * از یک راه می‌آیند.
 */
export function courseCodeForLabel(text) {
  const hit = COURSE_BUTTONS.find((b) => b.text === String(text).trim());
  return hit ? hit.code : null;
}

export function isBackToMenu(text) {
  return String(text).trim() === BACK_TO_MENU;
}

// پرسشِ نام، یک جا.
//
// سه جا پرسیده می‌شود - شروعِ فرم، برگشت از پرسشِ شماره، و ویرایش از
// صفحه‌ی تایید - و پیشتر در دو نسخه نوشته شده بود، یکی با ایموجی و یکی
// بی‌آن.
const NAME_QUESTION = "👤 نام و نام خانوادگی خود را وارد کنید:";

function cancelOnlyKeyboard() {
  return { inline_keyboard: [[{ text: "❌ لغو فرآیند", callback_data: "FLOW_CANCEL", style: "danger" }]] };
}

// کارتِ معرفیِ دوره: یک قدم بینِ انتخاب و فرم.
//
// دو دکمه دارد و نه یکی: «شروع» برای کسی که دوره را می‌خواهد، و
// «انتخاب دوره‌ی دیگر» برای کسی که با خواندنِ کارت فهمید دوره‌ی دیگری
// به دردش می‌خورد. بدونِ دکمه‌ی دوم تنها راهش لغوِ کلِ فرآیند و شروعِ
// دوباره از منو بود.
function courseCardKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "✅ شروع تعیین سطح", callback_data: "COURSE_GO", style: "success" }],
      [{ text: "🔙 انتخاب دوره‌ی دیگر", callback_data: "COURSE_BACK" }],
      [{ text: "❌ لغو فرآیند", callback_data: "FLOW_CANCEL", style: "danger" }],
    ],
  };
}

// ردیفِ پایینِ هر پرسش: برگشت و لغو، کنارِ هم در یک ردیف.
//
// یک ردیف و نه دو، چون این‌ها دکمه‌های فرم نیستند و نباید هم‌وزنِ
// گزینه‌های پاسخ دیده شوند.
function navRow() {
  return [
    { text: "🔙 مرحله قبل", callback_data: "FLOW_BACK" },
    { text: "❌ لغو", callback_data: "FLOW_CANCEL", style: "danger" },
  ];
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
      navRow(),
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
    next: "ask_goal",
    options: [
      "📉 بیشتر در ضرر بوده‌ام",
      "⚖️ تقریباً سربه‌سر",
      "📈 در مجموع سودده بوده‌ام",
      "🎢 نوسان زیاد دارد، ثابت نیست",
    ],
  },
  // آخرین پرسش، و تنها پرسشِ کاملاً بازِ فرم.
  //
  // بقیه فهرستِ بسته دارند چون جوابشان باید قابلِ شمردن و فیلتر کردن
  // باشد. هدف فرق دارد: همان جمله‌ای که کاربر با زبانِ خودش می‌نویسد،
  // بهترین چیزی است که مشاور می‌تواند پیش از تماس بخواند.
  //
  // یک‌بار چهار گزینه‌ی آماده هم داشت و برداشته شد: دکمه‌ی آماده جلوی
  // چشمِ کسی که می‌خواست بنویسد، ساده‌ترین کار را «زدنِ نزدیک‌ترین
  // گزینه» می‌کرد - و به‌جای حرفِ خودِ مشتری، یکی از چهار جمله‌ی تکراری
  // به CRM می‌رسید. حالا هر کس هدفش را با زبانِ خودش می‌گوید.
  goal: {
    prefix: "GOL",
    field: "topic",
    next: "confirm",
    freeText: true,
    options: [],
  },
};

function choiceKeyboard(kind) {
  const spec = CHOICES[kind];
  const rows = spec.options.map((text, i) => [
    { text, callback_data: spec.prefix + "|" + i },
  ]);
  rows.push(navRow());
  return { inline_keyboard: rows };
}

// هر سه پرسشِ دکمه‌ای یک مسیر دارند، پس یک تابع - وگرنه سه نسخه‌ی
// تقریباً یکسان می‌شد که روزی یکی‌شان اصلاح می‌شد و دوتای دیگر نه.
const STEP_OF_CHOICE = { level: "ask_level", experience: "ask_experience", trade: "ask_trade", goal: "ask_goal" };
const SECTION_OF_STEP = {
  ask_level: "CONSULT_LEVEL",
  ask_experience: "CONSULT_EXPERIENCE",
  ask_trade: "CONSULT_TRADE",
  ask_goal: "CONSULT_TOPIC",
};
const KIND_OF_STEP = { ask_level: "level", ask_experience: "experience", ask_trade: "trade", ask_goal: "goal" };

/**
 * مرحله‌هایی که پاسخِ متنیِ کاربر را خودِ فرم می‌گیرد.
 *
 * چرا اینجا و نه در روتر: این فهرست پیش‌تر دستی در bot.js نوشته شده بود
 * و از چهار پرسشِ تازه عقب ماند. نتیجه‌اش این بود که متنِ کاربر در آن
 * مرحله‌ها به دستیارِ هوش مصنوعی می‌رفت - کسی که هدفش را می‌نوشت،
 * به‌جای رفتن به قدمِ بعد، جوابِ یک ربات را می‌گرفت و فرمش همان‌جا
 * می‌ماند. حالا فهرست کنارِ خودِ مرحله‌هاست و با اضافه شدنِ پرسشِ تازه
 * جا نمی‌ماند.
 *
 * ask_topic و ask_time دیگر پرسیده نمی‌شوند ولی می‌مانند: کاربری که
 * لحظه‌ی یک انتشار وسطشان بوده، وگرنه به بن‌بست می‌خورد.
 */
const TEXT_STEPS = new Set([
  "ask_name",
  "ask_phone",
  "ask_level",
  "ask_experience",
  "ask_real",
  "ask_trade",
  "ask_goal",
  "ask_topic",
  "ask_time",
]);

export function isFlowTextStep(step) {
  return TEXT_STEPS.has(step);
}

/**
 * مرحله‌ی قبلِ هر پرسش.
 *
 * چرا لازم است: تا امروز تنها راهِ اصلاحِ یک پاسخِ اشتباه، لغوِ کلِ
 * فرآیند و شروع از صفر بود. کسی که در پرسشِ ششم بفهمد پنجمی را اشتباه
 * زده، یا از اول شروع می‌کند یا - که بیشتر پیش می‌آید - رها می‌کند.
 *
 * ask_goal دو مرحله‌ی قبلِ ممکن دارد، چون اگر کاربر حسابِ ریل نداشته
 * باشد پرسشِ وضعیتِ ترید اصلاً پرسیده نشده و برگشت به آن یعنی پرت شدن
 * به پرسشی که هرگز ندیده.
 */
const BACK_OF_STEP = {
  ask_name: "course_card",
  ask_phone: "ask_name",
  ask_level: "ask_phone",
  ask_experience: "ask_level",
  ask_real: "ask_experience",
  ask_trade: "ask_real",
};

function backStepOf(step, temp) {
  if (step === "ask_goal") return temp.has_real_account === "بله" ? "ask_trade" : "ask_real";
  // ورودیِ «پایان دوره‌ی مقدماتی» انتخابِ دوره را رد می‌کند و کارتی هم
  // در کار نبوده؛ برگشت به کارتی که هرگز نیامده، بن‌بست است.
  if (step === "ask_name" && !temp.course_code) return null;
  return BACK_OF_STEP[step] || null;
}

// پاسخی که در هر مرحله ذخیره می‌شود - برای پاک کردنش هنگام برگشت.
//
// بدون این، کاربری که به پرسشِ قبل برمی‌گردد و آن را نیمه‌کاره رها
// می‌کند، پاسخِ قدیمی‌اش را در صفحه‌ی تایید می‌بیند و فکر می‌کند عوضش
// کرده.
const FIELD_OF_STEP = {
  ask_name: "name",
  ask_phone: "phone",
  ask_level: "level",
  ask_experience: "experience",
  ask_real: "has_real_account",
  ask_trade: "trade_status",
  ask_goal: "topic",
};

/**
 * یک مرحله را نشان می‌دهد - هر مرحله‌ای، از هر راهی.
 *
 * سه مسیر به اینجا می‌رسند: جریانِ عادیِ فرم، دکمه‌ی «مرحله قبل»، و
 * منوی ویرایشِ صفحه‌ی تایید. پیش‌تر هرکدام متن و کیبوردِ خودش را
 * می‌ساخت؛ یعنی سه جا که باید هم‌گام می‌ماندند و یکی‌شان نمی‌ماند.
 */
async function renderStep(ctx, step, flow, temp) {
  if (step === "choose_course") {
    await sendSection(ctx, "CONSULT_START", courseChoiceKeyboard());
    return;
  }
  if (step === "course_card") {
    await sendCourseCard(ctx, temp.course_code);
    return;
  }
  if (step === "ask_name") {
    await ctx.reply(NAME_QUESTION, { reply_markup: cancelOnlyKeyboard() });
    return;
  }
  if (step === "ask_phone") {
    await ctx.reply(phonePromptText(flow), { reply_markup: requestContactKeyboard() });
    return;
  }
  if (step === "ask_real") {
    await sendSection(ctx, "CONSULT_REAL", realAccountKeyboard());
    return;
  }
  if (step === "confirm") {
    await ctx.reply(buildConfirmText(flow, temp), { reply_markup: confirmCancelKeyboard() });
    return;
  }
  const kind = KIND_OF_STEP[step];
  if (kind) await sendSection(ctx, SECTION_OF_STEP[step], choiceKeyboard(kind));
}

/**
 * مرحله‌ی بعد از یک پاسخ.
 *
 * `_edit` یعنی کاربر از صفحه‌ی تایید آمده تا فقط همین یک مورد را عوض
 * کند - پس بعد از پاسخ نباید بقیه‌ی فرم را دوباره طی کند، مستقیم به
 * تایید برمی‌گردد.
 */
function nextAfter(temp, plannedNext) {
  return temp._edit ? "confirm" : plannedNext;
}

function clearEdit(temp) {
  const next = { ...temp };
  delete next._edit;
  return next;
}

async function applyChoice(ctx, flow, temp, kind, value) {
  const spec = CHOICES[kind];
  const next = { ...clearEdit(temp), [spec.field]: value };
  const step = nextAfter(temp, spec.next);

  await setUserState(ctx.env, ctx.from.id, { current_step: step, temp_data: next });
  await renderStep(ctx, step, flow, next);
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
  if (!value) {
    // دکمه‌ای که دیگر وجود ندارد - مثلاً گزینه‌های آماده‌ی پرسشِ هدف که
    // برداشته شدند و کاربری هنوز پیامِ قبل از انتشار را جلوی چشمش دارد.
    // بی‌جواب گذاشتنش یعنی او پشتِ فرم گیر می‌کند، پس پرسش دوباره
    // فرستاده می‌شود - این بار به شکلِ تازه‌اش.
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await renderStep(ctx, state.current_step, state.current_flow, state.temp_data || {});
    return;
  }

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
  const next = { ...clearEdit(temp), has_real_account: yes ? "بله" : "خیر" };

  if (!yes) {
    // «ندارم» یعنی وضعیتِ تریدی هم در کار نیست. اگر پیش‌تر پاسخی داشت -
    // مثلاً کاربر از صفحه‌ی تایید همین یک مورد را عوض کرده - باید پاک
    // شود، وگرنه لیدی به CRM می‌رسد که «حساب ریل: خیر» است ولی وضعیتِ
    // تریدِ حسابِ ریل هم دارد.
    delete next.trade_status;
    // پرسشِ وضعیتِ ترید رد می‌شود ولی هدف نه: هدف به داشتنِ حساب ربطی
    // ندارد و برای تازه‌کار حتی مهم‌تر است.
    const step = nextAfter(temp, "ask_goal");
    await setUserState(ctx.env, ctx.from.id, { current_step: step, temp_data: next });
    await renderStep(ctx, step, flow, next);
    return;
  }

  // در حالتِ ویرایش هم اگر وضعیتِ ترید هنوز خالی است باید پرسیده شود:
  // کاربری که تازه «بله» را زده، پاسخی برای آن پرسش ندارد و برگشتِ
  // مستقیم به تایید یعنی یک ستونِ خالی در CRM.
  const needsTrade = !temp._edit || !temp.trade_status;
  if (needsTrade) {
    const keep = temp._edit ? { ...next, _edit: "1" } : next;
    await setUserState(ctx.env, ctx.from.id, { current_step: "ask_trade", temp_data: keep });
    await renderStep(ctx, "ask_trade", flow, keep);
    return;
  }
  await setUserState(ctx.env, ctx.from.id, { current_step: "confirm", temp_data: next });
  await renderStep(ctx, "confirm", flow, next);
}

function requestContactKeyboard() {
  return new Keyboard()
    .requestContact("ارسال شماره موبایل ☎️")
    .row()
    .text("🔙 برگشت")
    .resized();
}

// متنِ پرسشِ شماره. یک جا، چون هم جریانِ عادی و هم برگشت و هم ویرایش
// همین را نشان می‌دهند.
//
// «دستی تایپ نکنید» از متن برداشته شد: شماره‌ی تایپ‌شده حالا پذیرفته
// می‌شود. دکمه همچنان راهِ پیشنهادی است چون شماره‌ی تلگرام از خودِ
// تلگرام می‌آید و غلطِ تایپی ندارد - ولی کاربری که می‌خواهد شماره‌ی
// دیگری بدهد (یا دکمه برایش کار نمی‌کند) دیگر به بن‌بست نمی‌خورد.
function phonePromptText(flow) {
  const lead =
    flow === "consultation"
      ? "☎️ شماره موبایل خود را برای هماهنگی مشاوره بفرستید."
      : "☎️ شماره موبایل خود را برای هماهنگی ثبت‌نام بفرستید.";
  return (
    lead +
    "\n\nساده‌ترین راه: دکمه‌ی «ارسال شماره موبایل ☎️» در پایین صفحه 👇" +
    "\n\nاگر می‌خواهید شماره‌ی دیگری بدهید، همین‌جا بنویسید - مثل ۰۹۱۲۱۲۳۴۵۶۷"
  );
}

// تایید سبز و انصراف قرمز: در مرحله‌ی آخر یک ثبت‌نام، ضربه‌ی اشتباه
// گران‌ترین جای کل مسیر است.
function confirmCancelKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "✅ تایید نهایی", callback_data: "CONFIRM_YES", style: "success" }],
      // پیش‌تر تنها راهِ اصلاحِ یک غلطِ تایپی در نام یا یک گزینه‌ی
      // اشتباه، «انصراف» و پر کردنِ دوباره‌ی کلِ فرم بود - در آخرین قدم،
      // جایی که کاربر کمترین حوصله را دارد.
      [{ text: "✏️ ویرایش اطلاعات", callback_data: "CONFIRM_EDIT" }],
      [{ text: "❌ انصراف", callback_data: "FLOW_CANCEL", style: "danger" }],
    ],
  };
}

/**
 * فهرستِ ویرایش: هر مورد، برچسبش، و مرحله‌ای که باید دوباره اجرا شود.
 *
 * ترتیب همان ترتیبِ صفحه‌ی تایید است تا چشم دنبالِ ردیف بگردد نه دنبالِ
 * دکمه.
 *
 * callback_data فقط اندیس است، چون سقفِ ۶۴ بایتِ تلگرام با برچسبِ فارسی
 * زود پر می‌شود.
 */
const EDIT_FIELDS = [
  { field: "name", label: "👤 نام", step: "ask_name" },
  { field: "phone", label: "📱 موبایل", step: "ask_phone" },
  { field: "course", label: "🎯 دوره", step: "choose_course" },
  { field: "level", label: "📊 دانش در مارکت", step: "ask_level" },
  { field: "experience", label: "⏳ مدت فعالیت", step: "ask_experience" },
  { field: "has_real_account", label: "💼 حساب ریل", step: "ask_real" },
  { field: "trade_status", label: "📈 وضعیت ترید", step: "ask_trade" },
  { field: "topic", label: "🎯 هدف از دوره", step: "ask_goal" },
];

// فقط چیزهایی که واقعاً پرسیده شده‌اند.
//
// «وضعیت ترید» برای کسی که حسابِ ریل ندارد هرگز پرسیده نشده؛ نشان دادنش
// در فهرستِ ویرایش یعنی دکمه‌ای که به پرسشی می‌برد که کاربر نمی‌فهمد
// چرا آمده.
function editKeyboard(temp) {
  const rows = EDIT_FIELDS.map((f, i) => ({ f, i }))
    .filter(({ f }) => f.field !== "trade_status" || temp.has_real_account === "بله")
    .map(({ f, i }) => [{ text: f.label, callback_data: "EDIT|" + i }]);
  rows.push([{ text: "🔙 برگشت به تایید", callback_data: "EDIT_BACK" }]);
  return { inline_keyboard: rows };
}

// ارقامِ فارسی و عربی به لاتین.
//
// \d در جاوااسکریپت فقط ۰ تا ۹ لاتین است، پس بدون این تبدیل شماره‌ای که
// کاربر با کیبوردِ فارسی تایپ کرده به رشته‌ی خالی می‌رسید و «شماره
// نامعتبر» می‌گرفت - در حالی که درست نوشته بودش.
function latinDigits(raw) {
  return String(raw)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function normalizePhone(raw) {
  const digits = latinDigits(raw).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("98")) return "0" + digits.slice(2);
  if (digits.length === 10 && digits.startsWith("9")) return "0" + digits;
  return digits;
}

// موبایلِ ایران: ۱۱ رقم، با ۰۹ شروع می‌شود. شماره‌ی ثابت و شماره‌ی ناقص
// رد می‌شوند - شماره‌ای که مشاور نتواند با آن تماس بگیرد، از نبودنِ
// شماره بدتر است چون کسی پیگیری‌اش نمی‌کند.
function isMobile(phone) {
  return /^09\d{9}$/.test(phone);
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
  return [
    "📋 لطفاً اطلاعات زیر را بررسی کنید:",
    "",
    ...answerLines(temp),
    "",
    "اگر اطلاعات صحیح است، روی «✅ تایید نهایی» بزنید.",
  ].join("\n");
}

/**
 * خط‌های «برچسب: پاسخ» - همان فهرستی که هم در صفحه‌ی بازبینی می‌آید و هم
 * در رسیدِ بعد از تایید.
 *
 * سه چیز اینجا عمدی است:
 *
 * ۱ - ایموجیِ ابتدای پاسخ برداشته می‌شود. متنِ دکمه‌ها ایموجی دارد و
 *     کنارِ برچسبِ ایموجی‌دار، خط «🎯 دوره موردنظر: 📚 مجموعه…» می‌شد -
 *     دو نشانِ پشتِ سر هم که هیچ‌کدام چیزی نمی‌گوید.
 *
 * ۲ - هیچ دو برچسبی یک ایموجی ندارند. «دوره» و «هدف» هر دو 🎯 بودند و
 *     چشم موقعِ مرور، ردیفِ اشتباه را می‌گرفت.
 *
 * ۳ - «حساب ریل» به‌جای «بله/خیر» می‌گوید «دارم/ندارم». بقیه‌ی خط‌ها
 *     جواب می‌دهند نه اینکه فرم پر کنند؛ «بله» تنها جایی بود که مثلِ
 *     یک خانه‌ی خالیِ فرم خوانده می‌شد.
 */
function answerLines(temp) {
  const fields = [
    ["👤 نام", temp.name],
    ["📱 موبایل", temp.phone],
    ["🎓 دوره", temp.course],
    ["📊 دانش در مارکت", temp.level],
    ["⏳ مدت فعالیت", temp.experience],
    ["💼 حساب ریل", realAccountWord(temp.has_real_account)],
    ["📈 وضعیت ترید", temp.trade_status],
    ["🎯 هدف از دوره", temp.topic],
  ];
  return fields
    .map(([label, v]) => [label, stripLeadingIcon(v)])
    .filter(([, v]) => v)
    .map(([label, v]) => label + ": " + v);
}

function realAccountWord(v) {
  if (!v) return "";
  return stripLeadingIcon(v) === "بله" ? "دارم" : "ندارم";
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
    // این ورودی انتخابِ دوره را رد می‌کند، پس کیبوردِ دوره‌ها - که در
    // مسیرِ عادی جای منوی اصلی را می‌گیرد - اینجا نمی‌آید. منو باید
    // همین‌جا برداشته شود، وگرنه تا آخرِ فرم پایین می‌ماند.
    await ctx.reply(promptOverride || "🎓 برای ثبت‌نام، چند سوال کوتاه می‌پرسم.", {
      reply_markup: { remove_keyboard: true },
    });
    await ctx.reply(NAME_QUESTION, { reply_markup: cancelOnlyKeyboard() });
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

const COURSE_CARD_SECTION = {
  COURSE_TECH: "COURSE_TECH_CARD",
  COURSE_PSY: "COURSE_PSY_CARD",
  COURSE_BOTH: "COURSE_BOTH_CARD",
};

async function sendCourseCard(ctx, code) {
  const section = COURSE_CARD_SECTION[code];
  if (!section) return;
  await sendSection(ctx, section, courseCardKeyboard());
}

export async function handleCourseChoice(ctx, cb) {
  const state = await getUserState(ctx.env, ctx.from.id);
  if (!state || !COURSE_LABELS[cb]) return;
  const temp = { ...state.temp_data, course: COURSE_LABELS[cb], course_code: cb };

  // این پیام دو کار می‌کند: انتخاب را تایید می‌کند، و کیبوردِ دوره‌ها را
  // برمی‌دارد. از اینجا تا پایانِ فرم هیچ کیبوردی پایین نیست - نه
  // دوره‌ها، نه منوی اصلی - پس هیچ راهِ خروجِ اتفاقی هم نیست.
  //
  // پیشتر ویرایشِ همان پیامِ دکمه‌دار بود؛ حالا دکمه‌ها روی کیبوردِ
  // پایین‌اند و ویرایش‌شدنی نیستند.
  await ctx.reply("🎯 دوره‌ی انتخابی شما: " + COURSE_LABELS[cb], {
    reply_markup: { remove_keyboard: true },
  });

  // ویرایش از صفحه‌ی تایید: کارت و ویس دوباره فرستاده نمی‌شوند. کاربری
  // که فقط می‌خواهد دوره‌اش را عوض کند، معرفی را قبلاً دیده و شنیده.
  if (temp._edit) {
    const next = clearEdit(temp);
    await setUserState(ctx.env, ctx.from.id, { current_step: "confirm", temp_data: next });
    await renderStep(ctx, "confirm", state.current_flow, next);
    return;
  }

  // ویسِ استاد پیش از فرم می‌رود: کسی که هنوز نمی‌داند دوره چیست، فرم پر
  // نمی‌کند. نبودنش فرم را متوقف نمی‌کند - تا وقتی آکادمی ویس را در
  // کانال نگذاشته، مسیر مثل قبل ادامه پیدا می‌کند.
  await sendCourseVoices(ctx, cb);

  // کارت آخر می‌آید، بعد از ویس: دکمه‌های «شروع» و «انتخاب دوره‌ی دیگر»
  // باید پایین‌ترین چیزِ صفحه باشند، وگرنه ویس رویشان می‌نشیند و کاربر
  // باید برای ادامه دادن به عقب اسکرول کند.
  await setUserState(ctx.env, ctx.from.id, { current_step: "course_card", temp_data: temp });
  await sendCourseCard(ctx, cb);
}

/** «شروع تعیین سطح» روی کارتِ معرفی. */
export async function handleCourseStart(ctx) {
  const state = await getUserState(ctx.env, ctx.from.id);
  if (!state || state.current_step !== "course_card") return;
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  await setUserState(ctx.env, ctx.from.id, { current_step: "ask_name" });

  // متنِ شروعِ فرم و پرسشِ نام در یک پیام.
  //
  // پیشتر دو پیامِ پشتِ سرِ هم بودند و اولی حرفِ کارتِ معرفی را دوباره
  // می‌گفت. دو پیام برای یک قدم، هم شلوغ است هم دکمه‌ی لغو را از متنی
  // که توضیحش می‌دهد جدا می‌کند.
  const { text } = await resolveSection(ctx.env, "CONSULT_INTRO");
  const intro = String(text || "").trim();
  await ctx.reply(intro ? intro + "\n\n" + NAME_QUESTION : NAME_QUESTION, {
    reply_markup: cancelOnlyKeyboard(),
  });
}

/** «انتخاب دوره‌ی دیگر» روی کارتِ معرفی. */
export async function handleCourseBack(ctx) {
  const state = await getUserState(ctx.env, ctx.from.id);
  if (!state || state.current_step !== "course_card") return;
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  const temp = { ...state.temp_data };
  delete temp.course;
  delete temp.course_code;
  await setUserState(ctx.env, ctx.from.id, { current_step: "choose_course", temp_data: temp });
  await renderStep(ctx, "choose_course", state.current_flow, temp);
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

/**
 * دکمه‌ی «مرحله قبل».
 *
 * پاسخِ مرحله‌ای که به آن برمی‌گردیم پاک می‌شود، نه پاسخِ مرحله‌ی فعلی:
 * کاربر برمی‌گردد تا همان را عوض کند، و اگر مقدارِ قدیمی سرِ جایش بماند
 * ممکن است بدون پاسخ دادن جلو برود و فکر کند عوضش کرده.
 */
export async function handleFlowBack(ctx) {
  const state = await getUserState(ctx.env, ctx.from.id);
  if (!state) return;
  const temp = { ...state.temp_data };
  const prev = backStepOf(state.current_step, temp);
  if (!prev) return;

  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

  const field = FIELD_OF_STEP[prev];
  if (field) delete temp[field];
  // برگشت از دلِ فرم، حالتِ ویرایش را هم می‌بندد: از اینجا به بعد کاربر
  // دوباره در مسیرِ عادی است و نباید بعد از یک پاسخ به تایید پرتاب شود.
  delete temp._edit;

  await setUserState(ctx.env, ctx.from.id, { current_step: prev, temp_data: temp });
  await renderStep(ctx, prev, state.current_flow, temp);
}

/** «✏️ ویرایش اطلاعات» روی صفحه‌ی تایید. */
export async function handleConfirmEdit(ctx) {
  const state = await getUserState(ctx.env, ctx.from.id);
  if (!state || state.current_step !== "confirm") return;
  await editWithText(ctx, "کدام مورد را می‌خواهید اصلاح کنید؟", editKeyboard(state.temp_data || {}))
    .catch(() => {});
}

/** «🔙 برگشت به تایید» در فهرستِ ویرایش. */
export async function handleEditBack(ctx) {
  const state = await getUserState(ctx.env, ctx.from.id);
  if (!state || state.current_step !== "confirm") return;
  const temp = clearEdit(state.temp_data || {});
  await setUserState(ctx.env, ctx.from.id, { temp_data: temp });
  await editWithText(ctx, buildConfirmText(state.current_flow, temp), confirmCancelKeyboard())
    .catch(() => {});
}

/** انتخابِ یک مورد از فهرستِ ویرایش. */
export async function handleEditPick(ctx, data) {
  const state = await getUserState(ctx.env, ctx.from.id);
  if (!state || state.current_step !== "confirm") return;
  const spec = EDIT_FIELDS[Number(String(data).split("|")[1])];
  if (!spec) return;

  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

  // مقدارِ قبلی همین‌جا پاک می‌شود، نه بعد از پاسخ: اگر کاربر وسطِ کار
  // رها کند، صفحه‌ی تایید باید خالی بودنِ آن مورد را نشان دهد نه مقداری
  // را که خودش می‌خواست عوضش کند.
  const temp = { ...state.temp_data, _edit: "1" };
  delete temp[spec.field];
  if (spec.field === "course") delete temp.course_code;

  await setUserState(ctx.env, ctx.from.id, { current_step: spec.step, temp_data: temp });
  await renderStep(ctx, spec.step, state.current_flow, temp);
}

export async function handleText(ctx, state) {
  const step = state.current_step;
  const flow = state.current_flow;
  const text = ctx.message.text.trim();
  const temp = { ...state.temp_data };

  if (step === "ask_name") {
    const next = { ...clearEdit(temp), name: text };
    const target = nextAfter(temp, "ask_phone");
    await setUserState(ctx.env, ctx.from.id, { current_step: target, temp_data: next });
    await renderStep(ctx, target, flow, next);
    return;
  }

  if (step === "ask_phone") {
    if (text === "🔙 برگشت") {
      await setUserState(ctx.env, ctx.from.id, { current_step: "ask_name" });
      await ctx.reply(NAME_QUESTION, { reply_markup: { remove_keyboard: true } });
      await ctx.reply("👆", { reply_markup: cancelOnlyKeyboard() }).catch(() => {});
      return;
    }

    // شماره‌ی تایپ‌شده حالا پذیرفته می‌شود.
    //
    // پیش‌تر رد می‌شد و کاربر پشتِ همان پرسش گیر می‌کرد. دکمه‌ی
    // requestContact همیشه در دسترس نیست - در تلگرام دسکتاپ و در بعضی
    // کلاینت‌های وب نمی‌آید - و کسی هم ممکن است بخواهد شماره‌ی دیگری
    // بدهد. آن‌ها یا فرم را رها می‌کردند یا شماره را در پرسشِ بعدی
    // می‌نوشتند، جایی که هیچ‌کس دنبالش نمی‌گشت.
    //
    // اعتبارسنجی سرِ جایش می‌ماند: هر رشته‌ای پذیرفته نمی‌شود، فقط
    // موبایلِ درست.
    const typed = normalizePhone(text);
    if (isMobile(typed)) {
      await acceptPhone(ctx, state, typed);
      return;
    }
    await ctx.reply(
      "❗️ این شماره درست به نظر نمی‌رسد.\n\nیا روی دکمه‌ی «ارسال شماره موبایل ☎️» بزنید، یا شماره را به شکلِ ۱۱ رقمی بنویسید - مثل ۰۹۱۲۱۲۳۴۵۶۷",
      { reply_markup: requestContactKeyboard() }
    );
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
    // پرسشِ هدف هر جمله‌ای را قبول می‌کند؛ بقیه فقط گزینه‌هایشان را.
    if (!match && CHOICES[kind].freeText) {
      await applyChoice(ctx, flow, temp, kind, text);
      return;
    }
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
  await acceptPhone(ctx, state, normalizePhone(ctx.message.contact.phone_number));
}

/**
 * ثبتِ شماره - از دکمه‌ی تلگرام یا از متنِ تایپ‌شده.
 *
 * یک تابع برای هر دو راه، وگرنه هر چیزی که اینجا اضافه شود (دفترچه‌ی
 * شماره‌ها، حالتِ ویرایش، مرحله‌ی بعد) باید دو جا اضافه می‌شد و روزی
 * یکی‌شان جا می‌ماند.
 */
async function acceptPhone(ctx, state, phone) {
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

  // کیبوردِ منو تا پایانِ فرم پایین می‌ماند: هر دکمه‌ی منو یک راهِ خروج
  // از فرم است، و کسی که وسطِ تعیین سطح روی «دوره‌های رایگان» بزند،
  // لیدش نیمه‌کاره می‌ماند. در پیامِ پایان برمی‌گردد.
  await ctx.reply("✅ شماره شما با موفقیت ثبت شد.", { reply_markup: { remove_keyboard: true } });

  // ویرایش از صفحه‌ی تایید: فقط همین شماره عوض می‌شد، پس بقیه‌ی فرم
  // دوباره پرسیده نمی‌شود.
  if (temp._edit) {
    const next = clearEdit(temp);
    await setUserState(ctx.env, ctx.from.id, { current_step: "confirm", temp_data: next });
    await renderStep(ctx, "confirm", state.current_flow, next);
    return;
  }

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

  // صفحه‌ی بازبینی پاک می‌شود و جایش یک پیامِ جشن می‌آید.
  //
  // چرا پاک و نه ویرایش: فهرستِ پاسخ‌ها کارش تمام شده - کاربر همین حالا
  // تاییدش کرده - و ماندنش فقط بینِ او و تنها کاری که باید بکند فاصله
  // می‌اندازد. اگر تلگرام اجازه‌ی حذف ندهد، به یک خطِ کوتاه ویرایش
  // می‌شود تا دستِ‌کم فهرست از جلوی چشم برود.
  await ctx.deleteMessage().catch(() =>
    ctx.editMessageText("✅ اطلاعات شما ثبت شد.", { reply_markup: undefined }).catch(() => {})
  );
  await sendDoneCelebration(ctx, temp, saved && saved.lead_id);
}

/**
 * پیامِ پایان: گیفِ جشن + متن + دکمه‌ی پشتیبانی، همه در یک پیام.
 *
 * گیف از کانال می‌آید (هشتگِ #LEAD_DONE_ANIM) و اگر هنوز گذاشته نشده
 * باشد، همان متن به‌تنهایی می‌رود - نبودنِ یک تزئین نباید مهم‌ترین پیامِ
 * مسیر را از بین ببرد.
 *
 * متن و دکمه روی خودِ گیف می‌نشینند، نه در پیامی جدا: کپشنِ یک
 * animation هم متن می‌گیرد هم دکمه، پس جشن و دعوت از هم جدا نمی‌افتند.
 */
async function sendDoneCelebration(ctx, temp, leadId) {
  // هر دو تکه از /edit می‌آیند و پشتِ سرِ هم یک کپشن می‌سازند.
  const header = await resolveSection(ctx.env, "LEAD_DONE")
    .then((r) => String(r.text || "").trim())
    .catch(() => "");

  let invite = "";
  let markup;
  try {
    invite = (await resolveSection(ctx.env, "LEAD_SUPPORT")).text;
    const url = supportChatUrl(
      ctx.env,
      supportPrefill({
        leadId,
        name: temp.name,
        course: temp.course,
        level: temp.level,
        experience: temp.experience,
        hasRealAccount: temp.has_real_account,
        tradeStatus: temp.trade_status,
        goal: temp.topic,
      })
    );
    // شیءِ خام و نه سازنده‌ی InlineKeyboard: گرامی فیلدِ style را بی‌صدا
    // دور می‌ریزد و دکمه بی‌رنگ می‌ماند - همان دلیلی که کیبوردِ منوی
    // اصلی هم دستی ساخته می‌شود.
    //
    // primary یعنی همان آبیِ دکمه‌های منوی اصلی: کاربر این رنگ را در
    // کلِ ربات به‌عنوان «دکمه‌ی اصلی» یاد گرفته، و این دکمه هم مهم‌ترین
    // کارِ این لحظه است.
    //
    // ✅ از متن برداشته شد: تیکِ سبز جای رنگِ سبز را پر می‌کرد و روی
    // دکمه‌ی آبی، دو پیامِ متناقض می‌داد.
    markup = {
      inline_keyboard: [[{ text: "💬 ارسال پیام به پشتیبانی", url, style: "primary" }]],
    };
  } catch (err) {
    console.error("ساختنِ دعوتِ پشتیبانی شکست خورد:", err && err.message);
  }

  const caption = [header, invite].filter(Boolean).join("\n\n");

  const shown = await sendChannelMediaWithCaption(ctx, "LEAD_DONE_ANIM", caption, markup)
    .catch((err) => {
      console.error("ارسالِ گیفِ پایان شکست خورد:", err && err.message);
      return false;
    });
  if (shown) return;

  await ctx.reply(caption, {
    reply_markup: markup,
    // پیش‌نمایشِ لینکِ t.me زیر پیام، دکمه را از چشم می‌اندازد.
    link_preview_options: { is_disabled: true },
  });
}

export async function handleCancel(ctx) {
  await clearUserState(ctx.env, ctx.from.id);
  await ctx.reply("فرآیند لغو شد. به منوی اصلی برگشتید.", { reply_markup: mainMenuKeyboard() });
}

