import { Bot } from "grammy";
import { handleStart } from "./commands/start.js";
import { MENU_LABELS } from "./menu.js";
import { membershipGate } from "./membershipGate.js";
import {
  sendEconCalendar,
  sendAbout,
  sendSupportPlaceholder,
  sendLibraryPlaceholder,
  sendFreeCoursesPlaceholder,
  sendPsyVoicesPlaceholder,
  sendExpertPlaceholder,
  sendLiveTradePlaceholder,
  sendConsultPlaceholder,
  sendTrustedBrokerPlaceholder,
} from "./menuActions.js";

// یک‌جا ساخته می‌شود تا هم روی Cloudflare Workers و هم (در صورت نیاز) در
// یک محیط دیگر قابل استفاده باشد.
export function createBot(token) {
  const bot = new Bot(token);

  // قبل از هر چیز دیگری اجرا می‌شود - اگر کاربر عضو کانال نباشد، اینجا
  // متوقف می‌شود و به بقیه‌ی هندلرها نمی‌رسد.
  bot.use(membershipGate());

  bot.command("start", handleStart);

  bot.hears(MENU_LABELS.ECON_CALENDAR, sendEconCalendar);
  bot.hears(MENU_LABELS.ABOUT, sendAbout);
  bot.hears(MENU_LABELS.SUPPORT, sendSupportPlaceholder);
  bot.hears(MENU_LABELS.LIBRARY, sendLibraryPlaceholder);
  bot.hears(MENU_LABELS.FREE_COURSES, sendFreeCoursesPlaceholder);
  bot.hears(MENU_LABELS.PSY_VOICES, sendPsyVoicesPlaceholder);
  bot.hears(MENU_LABELS.EXPERT, sendExpertPlaceholder);
  bot.hears(MENU_LABELS.LIVE_TRADE, sendLiveTradePlaceholder);
  bot.hears(MENU_LABELS.CONSULT, sendConsultPlaceholder);
  bot.hears(MENU_LABELS.TRUSTED_BROKER, sendTrustedBrokerPlaceholder);

  bot.catch((err) => {
    console.error("خطای بات:", err);
  });

  return bot;
}
