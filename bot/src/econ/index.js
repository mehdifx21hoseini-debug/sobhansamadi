import { InlineKeyboard } from "grammy";
import { readEvents, readAiAnswer, readSyncState, todayCacheKey } from "./store.js";
import {
  buildTodayText,
  buildWeekText,
  buildNextEventText,
  buildAlertSettingsText,
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

// زیر هر نما یک دکمه‌ی بازگشت به منوی تقویم، همان‌طور که نسخه‌ی n8n داشت.
function backToEconMenu() {
  return new InlineKeyboard().text("⬅️ بازگشت به تقویم", "ECON_MENU");
}

export async function sendEconMenu(ctx) {
  await ctx.reply(ECON_MENU_TEXT, { reply_markup: econMenuKeyboard() });
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

async function replyView(ctx, text) {
  await ctx.reply(text, { reply_markup: backToEconMenu() });
}

export async function handleEconCallback(ctx, action) {
  if (action === "ECON_MENU") {
    await ctx.answerCallbackQuery().catch(() => {});
    await sendEconMenu(ctx);
    return true;
  }

  if (action === "ECON_TODAY" || action === "ECON_WEEK" || action === "ECON_NEXT_EVENT") {
    await ctx.answerCallbackQuery().catch(() => {});

    const notice = await emptyMirrorNotice(ctx.env);
    if (notice) {
      await replyView(ctx, notice);
      return true;
    }

    const events = await readEvents(ctx.env);
    const text =
      action === "ECON_TODAY"
        ? buildTodayText(events)
        : action === "ECON_WEEK"
        ? buildWeekText(events)
        : buildNextEventText(events);

    await replyView(ctx, text);
    return true;
  }

  if (action === "ECON_EXPLAIN") {
    await ctx.answerCallbackQuery().catch(() => {});

    // تحلیل را ایجنت هوش مصنوعی در n8n می‌سازد و در econ_ai_cache
    // می‌نویسد؛ ورکر فقط همان پاسخ آماده را از آینه می‌خواند. تولیدش
    // اینجا انجام نمی‌شود چون کلید و ایجنت آنجاست.
    const row = await readAiAnswer(ctx.env, todayCacheKey());
    if (!row || !row.answer) {
      await replyView(
        ctx,
        "🤖 تحلیل امروز هنوز آماده نشده است.\n\nتحلیل هر روز پس از انتشار اخبار ساخته می‌شود؛ کمی بعد دوباره امتحان کنید."
      );
      return true;
    }

    const stamp = row.created_at ? "\n\nℹ️ تهیه‌شده " + relativeTimeFa(row.created_at) : "";
    await replyView(ctx, row.answer + stamp);
    return true;
  }

  if (action === "ECON_ALERT_SETTINGS") {
    await ctx.answerCallbackQuery().catch(() => {});

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
          .text("⬅️ بازگشت به تقویم", "ECON_MENU"),
      }
    );
    return true;
  }

  return false;
}
