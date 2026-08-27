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
  formatAiAnswer,
  buildAiHeader,
} from "./views.js";
import { relativeTimeFa } from "./format.js";

const ECON_APP_URL = "https://mehdifx21hoseini-debug.github.io/sobhansamadi/econ-app.html?v=28";

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

// ایموجی‌ها همان‌هایی است که نود Send Econ Menu (HTTP) داشت - هرکدام به
// کارِ دکمه‌اش اشاره می‌کند، نه دایره‌ی رنگی بی‌معنی.
//
// style همان چیزی است که دکمه را رنگی می‌کند، مثل منوی اصلی. این فیلد در
// تایپ‌های تلگرام مستند نیست و سازنده‌ی InlineKeyboard در grammy بی‌صدا
// دورش می‌ریزد؛ به همین دلیل این کیبورد به‌صورت شیء خام نوشته شده. دقیقاً
// همان اشتباهی که یک‌بار رنگ منوی اصلی را هم پراند.
export function econMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📊 تقویم و سشن‌ها", web_app: { url: ECON_APP_URL }, style: "success" }],
      [
        { text: "📅 اخبار امروز", callback_data: "ECON_TODAY", style: "primary" },
        { text: "📆 این هفته", callback_data: "ECON_WEEK", style: "primary" },
      ],
      [
        { text: "⏭ رویداد بعدی", callback_data: "ECON_NEXT_EVENT", style: "primary" },
        { text: "🤖 توضیح AI", callback_data: "ECON_EXPLAIN", style: "primary" },
      ],
      // danger همان قرمز است. مقدار معتبری است - WF-02 روی دکمه‌های
      // «انصراف» و «لغو فرآیند» از همین استفاده می‌کند.
      [{ text: "🔔 تنظیمات هشدار", callback_data: "ECON_ALERT_SETTINGS", style: "danger" }],
      // دکمه‌ی بازگشت عمداً بی‌رنگ است تا از کارهای اصلی جدا دیده شود -
      // همان الگویی که نماهای امروز/هفته/تعطیلات دارند.
      [{ text: "⬅️ بازگشت", callback_data: "MENU_MAIN" }],
    ],
  };
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

const NEXT_EVENT_KEYBOARD = {
  inline_keyboard: [
    [
      { text: "🔄 بروزرسانی", callback_data: "ECON_NEXT_EVENT", style: "primary" },
      { text: "📅 اخبار امروز", callback_data: "ECON_TODAY", style: "primary" },
    ],
    [{ text: "⬅️ منوی تقویم", callback_data: "MENU_ECON_CALENDAR" }],
  ],
};

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
  return { inline_keyboard: [[{ text: "⬅️ منوی تقویم", callback_data: "MENU_ECON_CALENDAR" }]] };
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
    let failure = null;
    try {
      row = await askExplain(ctx.env, {
        cacheKey,
        question: EXPLAIN_QUESTION,
        context,
      });
    } catch (err) {
      failure = err && err.message;
      console.error("تحلیل هوش مصنوعی شکست خورد:", failure);
    }

    // اگر n8n قطع بود، آخرین پاسخی که در آینه نشسته بهتر از هیچ است -
    // با برچسب زمان، تا کاربر بداند تازه نیست. خواندن از آینه هم داخل
    // try است: اگر این هم بترکد، کاربر باید پیام بگیرد نه سکوت.
    if (!row) {
      try {
        row = await readAiAnswer(ctx.env, cacheKey);
      } catch (err) {
        console.error("خواندن تحلیل از آینه شکست خورد:", err && err.message);
      }
    }

    if (!row || !row.answer) {
      // تمایز مهلت از بقیه‌ی خطاها، چون کاربر باید بداند «دوباره بزن»
      // احتمالاً جواب می‌دهد.
      const timedOut = failure && /timed out|abort/i.test(failure);
      await ctx.reply(
        timedOut
          ? "🤖 سرویس تحلیل الان کند است و به‌موقع جواب نداد.\n\nچند لحظه بعد دوباره دکمه را بزنید."
          : "🤖 تحلیل امروز در دسترس نیست.\n\nسرویس تحلیل موقتاً پاسخ نمی‌دهد؛ کمی بعد دوباره امتحان کنید.",
        { reply_markup: backToEconMenu() }
      );
      return true;
    }

    // سرصفحه و پاصفحه را خودمان می‌سازیم، نه مدل. این‌طور تاریخ همیشه درست
    // است و ظاهر پیام هر بار یکسان می‌ماند، حتی اگر مدل روزی متن را جور
    // دیگری شروع کند.
    const body = formatAiAnswer(row.answer);
    const footer =
      "\n\n➖➖➖\n" +
      (row.created_at ? "🕘 تهیه‌شده " + relativeTimeFa(row.created_at) + "\n" : "") +
      "<i>این متن آموزشی است، نه توصیه‌ی معاملاتی.</i>";
    const message = buildAiHeader() + body + footer;

    // اگر مدل تگ ناقصی تولید کند تلگرام کل پیام را رد می‌کند و کاربر هیچ
    // نمی‌بیند. در آن حالت همان متن بدون parse_mode می‌رود: تگ‌ها خام دیده
    // می‌شوند ولی تحلیل از دست نمی‌رود.
    try {
      await ctx.reply(message, {
        parse_mode: "HTML",
        reply_markup: backToEconMenu(),
      });
    } catch (err) {
      console.error("ارسال HTML شکست خورد، متن ساده فرستاده شد:", err && err.message);
      await ctx.reply(message.replace(/<[^>]+>/g, ""), { reply_markup: backToEconMenu() });
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
        reply_markup: {
          inline_keyboard: [
            [{ text: "⚙️ باز کردن تنظیمات", web_app: { url: ECON_APP_URL }, style: "success" }],
            [{ text: "⬅️ منوی تقویم", callback_data: "MENU_ECON_CALENDAR" }],
          ],
        },
      }
    );
    return true;
  }

  return false;
}
