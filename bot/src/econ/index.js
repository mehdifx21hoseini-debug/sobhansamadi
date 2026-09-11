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
  buildExplainPlan,
  formatAiAnswer,
  buildAiHeader,
} from "./views.js";
import { relativeTimeFa, etTimeToTehran } from "./format.js";
import { makeLabelHelpers } from "./labels.js";
import { sendSection } from "../content/sectionText.js";
import { explainEnabled, explainToday, explainEvent, eventByToken } from "./explain.js";
import {
  readSubscription,
  saveSubscription,
  defaultSubscription,
  ALLOWED_MINUTES,
} from "./subscribers.js";
import { ECON_APP_VERSION } from "./appVersion.js";
import {
  CURRENCIES,
  currencyCode,
  toggleCurrency,
  filterByCurrencies,
  DEFAULT_CURRENCIES,
} from "./currencies.js";

// «?v=» کشِ وب‌ویوی تلگرام را می‌شکند. پیش از این عددش دستی نوشته می‌شد و
// این یک تله بود: اگر بعد از تغییر اپ یادمان می‌رفت جلو ببریمش، کاربر
// نسخه‌ی کهنه را می‌دید و هیچ‌جا خطایی ثبت نمی‌شد - فقط اپ «عوض نشده» بود.
//
// حالا مقدارش هشِ خودِ econ-app.html است که scripts/build-econ-app.mjs
// می‌نویسد، پس نه می‌تواند عقب بماند و نه بی‌دلیل جلو برود.
// و از کجا سرو می‌شود: از خودِ ورکر.
//
// پیش از این روی GitHub Pages بود و آدرسش نامِ صاحبِ مخزن را داشت. یعنی
// یک انتقالِ ساده‌ی مالکیت روی گیت‌هاب - کاری که هیچ ربطی به کاربر ندارد -
// اپ را برای همه‌ی یازده هزار نفر می‌شکست، بدون اینکه هیچ‌جا خطایی ثبت
// شود؛ فقط دکمه یک صفحه‌ی ۴۰۴ باز می‌کرد. حالا اپ از همان دامنه‌ای می‌آید
// که خودِ ربات می‌آید، و گیت‌هاب فقط جایی است که کد نگه داشته می‌شود.
//
// آدرس پایه در wrangler.toml است نه اینجا، تا اگر روزی دامنه عوض شد یک
// خطِ تنظیمات باشد نه گشتن در کد. مقدار پشتیبان همان دامنه‌ی امروز است،
// چون ورکرِ بی‌آدرس بدتر از ورکرِ با آدرسِ کهنه است.
const DEFAULT_WORKER_BASE = "https://sobhansamadi.mehdifx21hoseini.workers.dev";

function econAppUrl(env) {
  const base = String((env && env.WORKER_BASE_URL) || DEFAULT_WORKER_BASE).replace(/\/+$/, "");
  return base + "/econ/app?v=" + ECON_APP_VERSION;
}


// ایموجی‌ها همان‌هایی است که نود Send Econ Menu (HTTP) داشت - هرکدام به
// کارِ دکمه‌اش اشاره می‌کند، نه دایره‌ی رنگی بی‌معنی.
//
// style همان چیزی است که دکمه را رنگی می‌کند، مثل منوی اصلی. این فیلد در
// تایپ‌های تلگرام مستند نیست و سازنده‌ی InlineKeyboard در grammy بی‌صدا
// دورش می‌ریزد؛ به همین دلیل این کیبورد به‌صورت شیء خام نوشته شده. دقیقاً
// همان اشتباهی که یک‌بار رنگ منوی اصلی را هم پراند.
export function econMenuKeyboard(env) {
  return {
    inline_keyboard: [
      [{ text: "🔥 سشن های بازار (اپ اختصاصی)", web_app: { url: econAppUrl(env) }, style: "success" }],
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
      [{ text: "🌍 فیلتر ارزها", callback_data: "ECON_CURRENCIES", style: "primary" }],
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
  await sendSection(ctx, "ECON_MENU", econMenuKeyboard(ctx.env));
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
  // ECON_SUB خودش پاسخ می‌دهد، آن هم با متن. تلگرام هر callback را فقط
  // یک بار می‌پذیرد، پس پاسخِ خالیِ اینجا آن یکی را می‌سوزاند - و بدترین
  // جایش حالت خطاست: کاربر کلید را می‌زند، ذخیره نمی‌شود، و هیچ هشداری
  // هم نمی‌بیند.
  if (!action.startsWith("ECON_SUB|")) {
    await ctx.answerCallbackQuery().catch(() => {});
  }

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
      const [events, labels, holidays] = await Promise.all([
        readEvents(ctx.env),
        readLabels(ctx.env),
        // شکستش نباید نما را خالی کند: تعطیلات یک نشانِ اضافه است، نه
        // خودِ محتوا.
        readHolidays(ctx.env).catch(() => []),
      ]);
      // فیلترِ ارز، بر اساس انتخابِ خودِ کاربر. پیش‌فرض فقط دلار است،
      // پس کسی که این صفحه را باز نکرده دقیقاً همان چیزی را می‌بیند که
      // همیشه می‌دید.
      const sub = (await readSubscription(ctx.env, ctx.from.id)) || defaultSubscription();
      const mine = filterByCurrencies(events, sub.currencies);
      markdown =
        action === "ECON_TODAY"
          ? buildTodayMarkdown(mine, labels, holidays)
          : buildWeekMarkdown(mine, labels, holidays);
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
    const events = await readEvents(ctx.env);
    // برچسب‌ها هم می‌روند: بدونِ آن‌ها نامِ فارسیِ خبر به مدل نمی‌رسد و
    // آنچه می‌بیند همان عنوانِ انگلیسیِ فید است.
    const [holidayRows, labelRows] = await Promise.all([
      readHolidays(ctx.env).catch(() => []),
      readLabels(ctx.env).catch(() => []),
    ]);

    // تحلیل هم همان ارزهایی را می‌بیند که کاربر انتخاب کرده.
    //
    // نمای «اخبار امروز» از این فیلتر پیروی می‌کرد و تحلیل نمی‌کرد، پس
    // کسی که فقط دلار را روشن گذاشته بود در فهرست دلار می‌دید و در
    // تحلیل پوند و یورو هم.
    const sub = (await readSubscription(ctx.env, ctx.from.id)) || defaultSubscription();
    const chosen = sub.currencies && sub.currencies.length ? sub.currencies : DEFAULT_CURRENCIES;
    const mine = filterByCurrencies(events, chosen);

    // کلیدِ کش باید انتخابِ ارز را هم در خود داشته باشد.
    //
    // بدونِ این، اولین کسی که دکمه را می‌زد تحلیلِ ارزهای *خودش* را در
    // کشِ روز می‌نشاند و تا ۱۵ دقیقه همه همان را می‌گرفتند - کسی که فقط
    // دلار می‌خواست، خبرِ پوند می‌دید و برعکس. خطایی هم نمی‌داد.
    const cacheKey = todayCacheKey() + "|" + chosen.slice().sort().join(",");

    const { context, rows } = buildExplainPlan(mine, holidayRows, labelRows);

    // ساختن پاسخ چند ثانیه طول می‌کشد؛ بدون این نشانه کاربر فکر می‌کند
    // دکمه کار نکرده و دوباره می‌زند.
    await ctx.replyWithChatAction("typing").catch(() => {});

    let row = null;
    let failure = null;
    try {
      // مسیر تازه اول امتحان می‌شود: ورکر خودش از Gemini می‌پرسد و در
      // D1 کش می‌کند. تا وقتی کلیدش خاموش است، همان مسیر n8n می‌ماند -
      // یعنی برگرداندن یک دستور است، نه یک دیپلوی.
      row = (await explainEnabled(ctx.env))
        ? await explainToday(ctx.env, { cacheKey, question: EXPLAIN_QUESTION, context, rows })
        : await askExplain(ctx.env, { cacheKey, question: EXPLAIN_QUESTION, context });
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

  // ── توضیحِ یک خبر، از دکمه‌ی همان پیام ─────────────────────────────
  //
  // دکمه روی پیامِ هشدار و پیامِ نتیجه می‌نشیند، پس کاربر همان‌جا در چت
  // جواب می‌گیرد. متن روی سرور به شناسه‌ی خبر و منتشرشدنِ عددش کش
  // می‌شود، یعنی اولین کسی که بزند هزینه‌اش را می‌دهد و بقیه همان را
  // می‌گیرند - چه از ربات، چه از مینی‌اپ.
  if (action.startsWith("ECON_X_")) {
    if (!(await explainEnabled(ctx.env))) {
      await ctx.reply("🤖 سرویس توضیح فعلاً خاموش است.", { reply_markup: backToEconMenu() });
      return true;
    }

    const [events, labelRows] = await Promise.all([
      readEvents(ctx.env),
      readLabels(ctx.env).catch(() => []),
    ]);
    const row = eventByToken(events, action.slice("ECON_X_".length));
    if (!row) {
      // خبر از جدول رفته - افق ۴۵ روزه است و ردیف‌های قدیمی پاک می‌شوند.
      await ctx.reply("🤖 این خبر دیگر در تقویم نیست.", { reply_markup: backToEconMenu() });
      return true;
    }

    await ctx.replyWithChatAction("typing").catch(() => {});

    // شکلِ ردیفِ جدول با چیزی که explainEvent می‌خواهد یکی نیست: آنجا
    // همان شکلی است که مینی‌اپ می‌سازد. این نگاشت تنها جایی است که دو
    // شکل به هم می‌رسند، پس عمداً صریح نوشته شده.
    const { labelFor, enFull, faName } = makeLabelHelpers(labelRows);
    const hit = labelFor(row);
    const ev = {
      event_id: row.event_id,
      en: enFull(row) || row.event || "",
      title: faName(row),
      currency: row.currency || "USD",
      importance: row.importance || "low",
      time_tehran: row.time ? etTimeToTehran(row.date, row.time, "+1") : "",
      forecast: row.forecast || "",
      previous: row.previous || "",
      actual: row.actual || "",
      direction: (hit && hit.direction) || "",
      source: row.source || "",
    };

    let out = null;
    try {
      out = await explainEvent(ctx.env, ev);
    } catch (err) {
      console.error("توضیح خبر شکست خورد:", err && err.message);
    }
    if (!out || !out.answer) {
      await ctx.reply("🤖 توضیح این خبر ساخته نشد. کمی بعد دوباره بزنید.", {
        reply_markup: backToEconMenu(),
      });
      return true;
    }

    const head = "🤖 <b>" + (ev.title || ev.en) + "</b>\n\n";
    const foot =
      "\n\n➖➖➖\n" +
      (out.created_at ? "🕘 تهیه‌شده " + relativeTimeFa(out.created_at) + "\n" : "") +
      "<i>این متن آموزشی است، نه توصیه‌ی معاملاتی.</i>";
    const message = head + formatAiAnswer(out.answer) + foot;

    // همان حفاظِ مسیرِ تحلیلِ روز: تگِ ناقصِ مدل کلِ پیام را رد می‌کند و
    // کاربر هیچ نمی‌بیند، پس در آن حالت متنِ ساده می‌رود.
    try {
      await ctx.reply(message, { parse_mode: "HTML", reply_markup: backToEconMenu() });
    } catch (err) {
      console.error("ارسال HTML شکست خورد، متن ساده فرستاده شد:", err && err.message);
      await ctx.reply(message.replace(/<[^>]+>/g, ""), { reply_markup: backToEconMenu() });
    }
    return true;
  }

  if (action === "ECON_CURRENCIES") {
    await sendCurrencyPicker(ctx);
    return true;
  }

  if (action.startsWith("ECON_CUR|")) {
    const code = action.split("|")[1];
    const sub = (await readSubscription(ctx.env, ctx.from.id)) || defaultSubscription();
    const next = toggleCurrency(sub.currencies || [], code);

    // خاموش کردنِ آخرین ارز جلویش گرفته می‌شود: نمای خالی از نمای پر
    // بدتر است و کاربر فکر می‌کند چیزی شکسته.
    if (next.length === (sub.currencies || []).length && next.every((c, i) => c === sub.currencies[i])) {
      await ctx.answerCallbackQuery({
        text: "دست‌کم یک ارز باید روشن بماند.",
        show_alert: true,
      });
      return true;
    }

    try {
      await saveSubscription(ctx.env, ctx.from.id, { chat_id: ctx.from.id, currencies: next });
    } catch (err) {
      console.error("ذخیره‌ی ارزها شکست خورد:", err && err.message);
      await ctx.answerCallbackQuery({ text: "ذخیره نشد؛ دوباره امتحان کنید.", show_alert: true });
      return true;
    }
    await sendCurrencyPicker(ctx, true);
    return true;
  }

  if (action === "ECON_ALERT_SETTINGS") {
    await sendAlertSettings(ctx);
    return true;
  }

  // تغییر یک تنظیم و نمایش دوباره‌ی همان صفحه.
  //
  // پیام ویرایش می‌شود نه اینکه تازه بفرستد: کاربر دارد سه کلید را
  // پشت سر هم می‌زند و هر ضربه یک پیام تازه، چت را پر می‌کند.
  if (action.startsWith("ECON_SUB|")) {
    const [, field, value] = action.split("|");
    const patch = { chat_id: ctx.from.id };
    if (field === "ON") patch.subscribed = value === "1";
    else if (field === "LOW") patch.show_low_importance = value === "1";
    else if (field === "MIN") patch.alert_minutes = Number(value);
    // «۱» یعنی خلاصه را بفرست، پس digest_off برعکسِ آن است.
    else if (field === "DIGEST" || field === "DIGESTP") patch.digest_off = value !== "1";

    // این یکی از داخلِ خودِ خلاصه‌ی صبح زده می‌شود، نه از صفحه‌ی تنظیمات.
    // پس نه پیام را با صفحه‌ی تنظیمات جایگزین می‌کنیم - که خلاصه‌ی امروز
    // را پاک می‌کرد - و نه بی‌صدا رد می‌شویم: یک تاییدِ روشن، و دکمه‌ای
    // که راهِ برگشت را باز می‌گذارد.
    if (field === "DIGEST") {
      const off = patch.digest_off;
      try {
        await saveSubscription(ctx.env, ctx.from.id, patch);
      } catch (err) {
        console.error("ذخیره‌ی تنظیم خلاصه شکست خورد:", err && err.message);
        await ctx.answerCallbackQuery({
          text: "ذخیره نشد؛ دوباره امتحان کنید.",
          show_alert: true,
        });
        return true;
      }
      await ctx.answerCallbackQuery({
        text: off
          ? "دیگر خلاصه‌ی روزانه برایتان فرستاده نمی‌شود."
          : "از فردا صبح دوباره خلاصه را می‌گیرید.",
        show_alert: true,
      });
      await ctx
        .editMessageReplyMarkup({
          reply_markup: {
            inline_keyboard: [
              [
                off
                  ? { text: "🔔 دوباره برایم بفرست", callback_data: "ECON_SUB|DIGEST|1" }
                  : { text: "🔕 دیگر این خلاصه را نفرست", callback_data: "ECON_SUB|DIGEST|0" },
              ],
            ],
          },
        })
        .catch(() => {});
      return true;
    }

    try {
      await saveSubscription(ctx.env, ctx.from.id, patch);
      await ctx.answerCallbackQuery({ text: "ذخیره شد" });
    } catch (err) {
      console.error("ذخیره‌ی تنظیم هشدار شکست خورد:", err && err.message);
      // بی‌صدا شکست نخورد: کاربر باید بداند کلیدی که زد ثبت نشده،
      // وگرنه با خیال راحت می‌رود و هشداری که منتظرش است نمی‌آید.
      await ctx.answerCallbackQuery({
        text: "ذخیره نشد؛ دوباره امتحان کنید.",
        show_alert: true,
      });
      return true;
    }

    await sendAlertSettings(ctx, true);
    return true;
  }

  return false;
}

/**
 * صفحه‌ی انتخابِ ارز.
 *
 * دو ستونه، چون نُه ارز در یک ستون یعنی صفحه‌ای که باید اسکرول شود و
 * دکمه‌ی پایینش دیده نمی‌شود.
 *
 * پیش‌فرضِ هر کاربر - قدیمی یا تازه - فقط دلار است، پس کسی که هرگز این
 * صفحه را باز نکند دقیقاً همان چیزی را می‌بیند که همیشه می‌دید.
 */
async function sendCurrencyPicker(ctx, edit = false) {
  const sub = (await readSubscription(ctx.env, ctx.from.id)) || defaultSubscription();
  const selected = new Set(sub.currencies || []);

  const rows = [];
  for (let i = 0; i < CURRENCIES.length; i += 2) {
    const pair = CURRENCIES.slice(i, i + 2).map((c) => ({
      text: (selected.has(c.code) ? "✅ " : "▫️ ") + c.flag + " " + c.code,
      callback_data: "ECON_CUR|" + c.code,
      style: selected.has(c.code) ? "success" : "primary",
    }));
    rows.push(pair);
  }
  rows.push([{ text: "⬅️ منوی تقویم", callback_data: "MENU_ECON_CALENDAR" }]);

  const chosen = (sub.currencies || []).map((c) => currencyCode(c)).join(" · ");
  const text =
    "🌍 <b>فیلتر ارزها</b>\n\n" +
    "فقط اخبار ارزهایی که انتخاب می‌کنید در «اخبار امروز» و «این هفته» نمایش داده می‌شود.\n\n" +
    "<b>انتخاب فعلی:</b>\n" + chosen + "\n\n" +
    "<i>طلا و نفت خبر مستقل ندارند و با اخبار دلار حرکت می‌کنند؛ برای آن‌ها دلار را روشن نگه دارید.</i>";

  const markup = { inline_keyboard: rows };
  if (edit) {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: markup }).catch(() => {});
    return;
  }
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: markup });
}

// صفحه‌ی تنظیم هشدار، با دکمه‌های واقعی.
//
// پیش‌تر اینجا فقط یک متن بود و یک دکمه که کاربر را به مینی‌اپ می‌فرستاد،
// چون مسیر نوشتن در ورکر وجود نداشت و جدول مشترکین در n8n بود. حالا هر
// دو اینجاست، پس تنظیم همان‌جایی انجام می‌شود که کاربر ایستاده.
async function sendAlertSettings(ctx, edit = false) {
  const sub = (await readSubscription(ctx.env, ctx.from.id)) || defaultSubscription();

  const check = (on) => (on ? "✅" : "▫️");
  const rows = [
    [
      {
        text: (sub.subscribed ? "🔕 خاموش کردن هشدار" : "🔔 روشن کردن هشدار"),
        callback_data: "ECON_SUB|ON|" + (sub.subscribed ? "0" : "1"),
        style: sub.subscribed ? "danger" : "success",
      },
    ],
  ];

  // گزینه‌های ریز فقط وقتی معنی دارند که هشدار روشن باشد؛ نشان دادنشان
  // در حالت خاموش یعنی کاربر چیزی را تنظیم می‌کند که هرگز نمی‌رسد.
  if (sub.subscribed) {
    rows.push(
      ALLOWED_MINUTES.map((m) => ({
        text: (m === sub.alert_minutes ? "🔘 " : "") + toFa(m) + " دقیقه",
        callback_data: "ECON_SUB|MIN|" + m,
        style: "primary",
      }))
    );
    rows.push([
      {
        text: check(sub.show_low_importance) + " اخبار با اهمیت متوسط",
        callback_data: "ECON_SUB|LOW|" + (sub.show_low_importance ? "0" : "1"),
        style: "primary",
      },
    ]);
  }

  // خلاصه‌ی صبح جدا از هشدار است: برای همه‌ی اعضا می‌رود و کلیدِ بالا
  // خاموشش نمی‌کند. پس وضعیتش باید همین‌جا دیده و عوض شود، وگرنه کسی که
  // یک بار از داخلِ خودِ خلاصه خاموشش کرده هیچ راهی برای برگرداندن ندارد.
  rows.push([
    {
      text: sub.digest_off ? "🔔 روشن کردن خلاصه‌ی هر روز صبح" : "🔕 خاموش کردن خلاصه‌ی هر روز صبح",
      // DIGESTP یعنی «از صفحه‌ی تنظیمات»: همان تغییر، ولی بعدش همین صفحه
      // دوباره کشیده می‌شود. DIGEST خامِ داخلِ خلاصه، مسیر دیگری دارد.
      callback_data: "ECON_SUB|DIGESTP|" + (sub.digest_off ? "1" : "0"),
      style: sub.digest_off ? "success" : "danger",
    },
  ]);

  rows.push([{ text: "⬅️ منوی تقویم", callback_data: "MENU_ECON_CALENDAR" }]);

  const text = buildAlertSettingsText(sub);
  const markup = { inline_keyboard: rows };

  if (edit) {
    // «message is not modified» خطا نیست: کاربر همان مقدار فعلی را
    // دوباره زده.
    await ctx.editMessageText(text, { reply_markup: markup }).catch(() => {});
    return;
  }
  await ctx.reply(text, { reply_markup: markup });
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
function toFa(n) {
  return String(n).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}
