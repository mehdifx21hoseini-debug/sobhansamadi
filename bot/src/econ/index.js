import { InlineKeyboard } from "grammy";
import {
  readEvents,
  readLabels,
  readHolidays,
  readAiAnswer,
  readSyncState,
  todayCacheKey,
  askExplain,
  EXPLAIN_QUESTION,
} from "./store.js";
import {
  buildTodayMarkdown,
  buildWeekMarkdown,
  buildHolidaysMarkdown,
  buildNextEventText,
  buildAlertSettingsText,
  buildExplainContext,
} from "./views.js";
import { relativeTimeFa } from "./format.js";

const ECON_APP_URL = "https://mehdifx21hoseini-debug.github.io/sobhansamadi/econ-app.html?v=27";

// متن و چیدمان دکمه‌ها عیناً از نودهای Build Econ Menu View و
// Send Econ Menu (HTTP) در WF-Economic-Calendar است.
export const ECON_MENU_TEXT = [
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

export function econMenuKeyboard() {
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

// چیدمان زیر هر نما، عیناً از نودهای Send Today/Week/Holidays View. سبک
// primary همان دکمه‌های رنگی است که grammy نمی‌سازد، پس این‌ها به‌صورت
// شیء خام ساخته می‌شوند نه با InlineKeyboard.
const VIEW_KEYBOARDS = {
  ECON_TODAY: {
    inline_keyboard: [
      [
        { text: "📆 این هفته", callback_data: "ECON_WEEK", style: "primary" },
        { text: "🏦 تعطیلات", callback_data: "ECON_HOLIDAYS", style: "primary" },
      ],
      [
        { text: "🔄 بروزرسانی", callback_data: "ECON_TODAY", style: "primary" },
        { text: "⬅️ منوی تقویم", callback_data: "MENU_ECON_CALENDAR" },
      ],
    ],
  },
  ECON_WEEK: {
    inline_keyboard: [
      [
        { text: "📅 امروز", callback_data: "ECON_TODAY", style: "primary" },
        { text: "🏦 تعطیلات", callback_data: "ECON_HOLIDAYS", style: "primary" },
      ],
      [
        { text: "🔄 بروزرسانی", callback_data: "ECON_WEEK", style: "primary" },
        { text: "⬅️ منوی تقویم", callback_data: "MENU_ECON_CALENDAR" },
      ],
    ],
  },
  ECON_HOLIDAYS: {
    inline_keyboard: [
      [
        { text: "📅 امروز", callback_data: "ECON_TODAY", style: "primary" },
        { text: "📆 این هفته", callback_data: "ECON_WEEK", style: "primary" },
      ],
      [
        { text: "🔄 بروزرسانی", callback_data: "ECON_HOLIDAYS", style: "primary" },
        { text: "⬅️ منوی تقویم", callback_data: "MENU_ECON_CALENDAR" },
      ],
    ],
  },
};

const NEXT_EVENT_KEYBOARD = new InlineKeyboard()
  .text("🔄 بروزرسانی", "ECON_NEXT_EVENT")
  .row()
  .text("⬅️ منوی تقویم", "MENU_ECON_CALENDAR");

// sendRichMessage یک متد غیرمستند تلگرام است و در تایپ‌های grammy وجود
// ندارد، پس مثل نسخه‌ی n8n مستقیم صدا زده می‌شود. همین متد است که جدول
// markdown و بلوک‌های تاشو را رندر می‌کند؛ sendMessage معمولی آن‌ها را
// به‌صورت متن خام نشان می‌داد.
async function sendRichMessage(ctx, markdown, replyMarkup) {
  const res = await fetch(
    "https://api.telegram.org/bot" + ctx.env.BOT_TOKEN + "/sendRichMessage",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: ctx.chat.id,
        rich_message: { markdown },
        reply_markup: replyMarkup,
      }),
    }
  );
  return res.ok;
}

export async function sendEconMenu(ctx) {
  await ctx.reply(ECON_MENU_TEXT, { reply_markup: econMenuKeyboard() });
}

// نسخه‌ی n8n پیام قبلی را پاک می‌کرد و نمای تازه را می‌فرستاد، تا چند بار
// زدن دکمه‌ها چت را پر نکند. اگر پاک کردن شکست بخورد (پیام خیلی قدیمی)
// مهم نیست - نمای جدید در هر حال فرستاده می‌شود.
async function replaceCallbackMessage(ctx) {
  if (!ctx.callbackQuery || !ctx.callbackQuery.message) return;
  await ctx.deleteMessage().catch(() => {});
}

// اگر آینه هنوز پر نشده باشد (اولین اجرا، یا چند بار پشت‌سرهم شکست
// همگام‌سازی) کاربر باید دلیل را بفهمد، نه یک فهرست خالی ببیند.
async function emptyMirrorNotice(env) {
  const last = await readSyncState(env);
  if (!last) {
    return "تقویم هنوز همگام‌سازی نشده است. چند دقیقه دیگر دوباره امتحان کنید.";
  }
  return null;
}

function backToEconMenu() {
  return new InlineKeyboard().text("⬅️ منوی تقویم", "MENU_ECON_CALENDAR");
}

export async function handleEconCallback(ctx, action) {
  await ctx.answerCallbackQuery().catch(() => {});

  if (action === "ECON_MENU" || action === "MENU_ECON_CALENDAR") {
    await replaceCallbackMessage(ctx);
    await sendEconMenu(ctx);
    return true;
  }

  if (action === "ECON_TODAY" || action === "ECON_WEEK" || action === "ECON_HOLIDAYS") {
    const notice = await emptyMirrorNotice(ctx.env);
    if (notice) {
      await ctx.reply(notice, { reply_markup: backToEconMenu() });
      return true;
    }

    let markdown;
    if (action === "ECON_HOLIDAYS") {
      markdown = buildHolidaysMarkdown(await readHolidays(ctx.env));
    } else {
      const [events, labels] = await Promise.all([readEvents(ctx.env), readLabels(ctx.env)]);
      markdown =
        action === "ECON_TODAY"
          ? buildTodayMarkdown(events, labels)
          : buildWeekMarkdown(events, labels);
    }

    await replaceCallbackMessage(ctx);
    const sent = await sendRichMessage(ctx, markdown, VIEW_KEYBOARDS[action]);
    // اگر متد Rich در دسترس نبود، پیام نباید گم شود: همان markdown به‌صورت
    // متن ساده می‌رود تا کاربر دست‌خالی نماند.
    if (!sent) {
      await ctx.reply(markdown, { reply_markup: backToEconMenu() });
    }
    return true;
  }

  if (action === "ECON_NEXT_EVENT") {
    const notice = await emptyMirrorNotice(ctx.env);
    if (notice) {
      await ctx.reply(notice, { reply_markup: backToEconMenu() });
      return true;
    }
    const events = await readEvents(ctx.env);
    await replaceCallbackMessage(ctx);
    await ctx.reply(buildNextEventText(events), { reply_markup: NEXT_EVENT_KEYBOARD });
    return true;
  }

  if (action === "ECON_EXPLAIN") {
    // این تنها دکمه‌ای است که همچنان به n8n می‌زند، چون ایجنت و کلید
    // Gemini آنجاست. تحلیل مثل قبل «درجا» ساخته می‌شود، نه از یک آینه‌ی
    // خوانده‌شده - وگرنه روزهایی که کسی دکمه را نزده باشد پاسخی وجود
    // ندارد و دکمه عملاً مرده است.
    const cacheKey = todayCacheKey();
    const events = await readEvents(ctx.env);
    const context = buildExplainContext(events);

    // ساختن پاسخ چند ثانیه طول می‌کشد؛ بدون این نشانه کاربر فکر می‌کند
    // دکمه کار نکرده و دوباره می‌زند.
    await ctx.replyWithChatAction("typing").catch(() => {});

    let row = null;
    try {
      row = await askExplain(ctx.env, {
        cacheKey,
        question: EXPLAIN_QUESTION,
        context,
      });
    } catch (err) {
      console.error("تحلیل هوش مصنوعی شکست خورد:", err && err.message);
    }

    // اگر n8n قطع بود، آخرین پاسخی که در آینه نشسته بهتر از هیچ است -
    // با برچسب زمان، تا کاربر بداند تازه نیست.
    if (!row) row = await readAiAnswer(ctx.env, cacheKey);

    if (!row || !row.answer) {
      await ctx.reply(
        "🤖 تحلیل امروز در دسترس نیست.\n\nسرویس تحلیل موقتاً پاسخ نمی‌دهد؛ کمی بعد دوباره امتحان کنید.",
        { reply_markup: backToEconMenu() }
      );
      return true;
    }

    const stamp = row.created_at ? "\n\nℹ️ تهیه‌شده " + relativeTimeFa(row.created_at) : "";

    // متن را مدل می‌سازد و با تگ‌های HTML تلگرام می‌نویسد. اگر مدل یک تگ
    // خارج از فهرست مجاز یا ناقص تولید کند، تلگرام کل پیام را رد می‌کند و
    // کاربر هیچ چیز نمی‌بیند. در آن حالت همان متن بدون parse_mode فرستاده
    // می‌شود: تگ‌ها خام دیده می‌شوند ولی تحلیل از دست نمی‌رود.
    try {
      await ctx.reply(row.answer + stamp, {
        parse_mode: "HTML",
        reply_markup: backToEconMenu(),
      });
    } catch (err) {
      console.error("ارسال HTML شکست خورد، متن ساده فرستاده شد:", err && err.message);
      await ctx.reply(row.answer + stamp, { reply_markup: backToEconMenu() });
    }
    return true;
  }

  if (action === "ECON_ALERT_SETTINGS") {
    // اشتراک هشدار را زمان‌بند n8n می‌خواند تا پیام بفرستد، پس نوشتنش
    // باید در n8n بماند؛ آینه‌کردنش فقط باعث می‌شد کاربر تنظیمی ببیند که
    // فرستنده‌ی هشدار هرگز از آن خبردار نمی‌شود. تا وقتی مسیر نوشتن ساخته
    // شود، تنظیمات از داخل مینی‌اپ انجام می‌شود که همین حالا کار می‌کند.
    await ctx.reply(
      buildAlertSettingsText({ subscribed: false, show_low_importance: false, alert_minutes: 15 }) +
        "\n\n⚙️ برای روشن/خاموش کردن هشدار، از داخل تقویم اقدام کنید.",
      {
        reply_markup: new InlineKeyboard()
          .webApp("🟢 باز کردن تقویم", ECON_APP_URL)
          .row()
          .text("⬅️ منوی تقویم", "MENU_ECON_CALENDAR"),
      }
    );
    return true;
  }

  return false;
}
