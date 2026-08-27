import { InlineKeyboard } from "grammy";
import { logContentRequest } from "./db.js";

// نسخه‌ی این آدرس باید با آخرین تغییر econ-app.html یکی بماند، وگرنه
// تلگرام نسخه‌ی کش‌شده‌ی قدیمی را باز می‌کند.
const ECON_APP_URL = "https://mehdifx21hoseini-debug.github.io/sobhansamadi/econ-app.html?v=27";

// این متن عیناً از نود «Build Econ Menu View» در WF-Economic-Calendar
// برداشته شده - حدسی نیست.
const ECON_MENU_TEXT = [
  "📅 تقویم اقتصادی فارکس",
  "",
  "در این بخش، اخبار اقتصادی مهم مربوط به USD (دلار آمریکا) را به‌صورت روزانه و بر اساس ساعت ایران مشاهده خواهید کرد.",
  "",
  "🔴 اهمیت بسیار بالا: اخبار مهم و اثرگذار که می‌توانند نوسانات قابل‌توجهی در بازار ایجاد کنند.",
  "",
  "🟡 اهمیت متوسط: اخبار با اهمیت متوسط که ممکن است روی بازار اثرگذار باشند",
  "",
  "⏰ تمام زمان‌های اعلام‌شده به ساعت ایران تنظیم شده‌اند",
  "",
  "🔔 لازم نیست هر بار سر بزنید — هشدار را روشن کنید تا پیش از هر خبر مهم به شما اطلاع دهیم.",
  "",
  "یکی از گزینه‌ها را انتخاب کنید:",
].join("\n");

// چیدمان دکمه‌ها هم عیناً از نود «Send Econ Menu (HTTP)» است.
function econMenuKeyboard() {
  return new InlineKeyboard()
    .webApp("🟢 تقویم و سشن‌ها", ECON_APP_URL)
    .row()
    .text("🔵 اخبار امروز", "ECON_TODAY")
    .text("🔵 این هفته", "ECON_WEEK")
    .row()
    .text("🔵 رویداد بعدی", "ECON_NEXT_EVENT")
    .text("🔵 توضیح AI", "ECON_EXPLAIN")
    .row()
    .text("🔴 تنظیمات هشدار", "ECON_ALERT_SETTINGS")
    .row()
    .text("⬅️ بازگشت", "MENU_MAIN");
}

export async function sendEconCalendar(ctx) {
  await ctx.reply(ECON_MENU_TEXT, { reply_markup: econMenuKeyboard() });
}

// این پنج دکمه در نسخه‌ی n8n از مسیر «From Menu Query» جواب می‌گرفتند؛ آن
// مسیر یک executeWorkflowTrigger است و فقط WF-01 صدایش می‌زد، که دائمی
// unpublish شده. تنها درگاه HTTP موجود (WF-19) هم initData تلگرام را
// اعتبارسنجی می‌کند و آن فقط داخل مینی‌اپ ساخته می‌شود، پس ورکر نمی‌تواند
// صدایش بزند.
//
// تا وقتی درگاهی برای ورکر ساخته شود، دکمه حذف نمی‌شود (منو باید همان
// شکل قبلی را داشته باشد) ولی صادقانه کاربر را به مینی‌اپ می‌فرستد که
// همین داده‌ها را دارد - نه اینکه بی‌صدا هیچ کاری نکند.
const ECON_VIA_MINIAPP = {
  ECON_TODAY: "اخبار امروز",
  ECON_WEEK: "تقویم این هفته",
  ECON_NEXT_EVENT: "رویداد بعدی",
  ECON_EXPLAIN: "توضیح هوش مصنوعی",
  ECON_ALERT_SETTINGS: "تنظیمات هشدار",
};

export async function handleEconAction(ctx, action) {
  const title = ECON_VIA_MINIAPP[action];
  if (!title) return;

  await ctx.answerCallbackQuery({ text: "از داخل تقویم باز می‌شود" }).catch(() => {});
  await ctx.reply(
    `«${title}» را از داخل تقویم ببینید — همه‌ی این بخش‌ها آن‌جا هست و همیشه به‌روز است.`,
    { reply_markup: new InlineKeyboard().webApp("🟢 باز کردن تقویم", ECON_APP_URL) }
  );
}

// بخش‌هایی که هنوز فایل واقعی‌شان از آکادمی گرفته نشده. به‌جای یک پیام
// بن‌بست، درخواست در جدول content_requests ثبت می‌شود؛ این‌طور آکادمی در
// CRM می‌بیند چند نفر منتظر کدام بخش‌اند و اولویت تولید محتوا روشن است.
const PENDING_SECTIONS = {
  PSY_VOICES: {
    id: "PSY_VOICES",
    title: "🎧 ویس‌های روانشناسی",
    body: "این بخش هنوز در حال آماده‌سازیه.",
  },
  LIVE_TRADE: {
    id: "LIVE_TRADE",
    title: "📈 ویدیوهای لایو ترید",
    body: "ویدیوهای لایو معاملات هنوز در حال آماده‌سازیه.",
  },
};

export async function sendPendingSection(ctx, key) {
  const section = PENDING_SECTIONS[key];
  if (!section) return;

  // اگر ثبت درخواست به هر دلیلی شکست بخورد، کاربر نباید پیام خطا ببیند —
  // برای او فرقی ندارد و پیام اصلی باید در هر حالت برسد.
  await logContentRequest(ctx.env, ctx.from.id, ctx.from.username, section.id).catch(() => {});

  await ctx.reply(
    `${section.title}\n\n${section.body}\n\n` +
      "✅ درخواست شما ثبت شد؛ به‌محض آماده شدن، همین‌جا براتون می‌فرستیم. 🙏"
  );
}
