import { InlineKeyboard } from "grammy";

// هر دو منبع رایگانند، بدون نیاز به API key.
// CoinGecko و Binance هر دو رد کردن: اولی محدودیت نرخ سختی داشت (IP
// خروجی Cloudflare Workers بین کاربرهای زیادی مشترک است)، دومی بسته به
// اینکه Worker از کدام دیتاسنتر اجرا شود ممکن است بر اساس محدودیت
// جغرافیایی بلاک شود. Coinbase برای همین مصرف عمومی متداول‌تر و
// پایدارتر است.
const COINBASE_BTC_URL = "https://api.coinbase.com/v2/prices/BTC-USD/spot";
const COINBASE_ETH_URL = "https://api.coinbase.com/v2/prices/ETH-USD/spot";
const FX_URL = "https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY";

function fmt(n, digits = 2) {
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export async function fetchLiveData() {
  const [btcRes, ethRes, fx] = await Promise.all([
    fetch(COINBASE_BTC_URL).then((r) => r.json()),
    fetch(COINBASE_ETH_URL).then((r) => r.json()),
    fetch(FX_URL).then((r) => r.json()),
  ]);

  if (!btcRes.data || !ethRes.data) {
    throw new Error(`Coinbase error: ${JSON.stringify(btcRes)} / ${JSON.stringify(ethRes)}`);
  }

  return { btc: btcRes.data, eth: ethRes.data, fx };
}

function formatMessage({ btc, eth, fx }) {
  const now = new Date().toLocaleTimeString("fa-IR", {
    timeZone: "Asia/Tehran",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return [
    "📊 <b>بازارهای لحظه‌ای</b>",
    "",
    `₿ بیت‌کوین: <b>$${fmt(btc.amount, 0)}</b>`,
    `Ξ اتریوم: <b>$${fmt(eth.amount, 0)}</b>`,
    "",
    "💱 <b>نرخ برابری دلار</b>",
    `یورو: <b>${fmt(fx.rates.EUR, 4)}</b>`,
    `پوند: <b>${fmt(fx.rates.GBP, 4)}</b>`,
    `ین: <b>${fmt(fx.rates.JPY, 2)}</b>`,
    "",
    `⏱ به‌روزرسانی: ${now} (به وقت تهران)`,
  ].join("\n");
}

function livePricesKeyboard() {
  return new InlineKeyboard()
    .text("🔄 به‌روزرسانی", "live_prices_refresh")
    .row()
    .text("⬅️ بازگشت به منو", "back_to_menu");
}

export async function sendLivePrices(ctx) {
  try {
    const data = await fetchLiveData();
    await ctx.reply(formatMessage(data), {
      parse_mode: "HTML",
      reply_markup: livePricesKeyboard(),
    });
  } catch (err) {
    console.error("خطای دریافت قیمت لحظه‌ای:", err);
    await ctx.reply("دریافت قیمت لحظه‌ای الان ممکن نشد، چند لحظه دیگه دوباره امتحان کنید.");
  }
}

// دکمه‌ی «به‌روزرسانی» به‌جای فرستادن پیام جدید، همان پیام را جای خودش
// ویرایش می‌کند - همان حس زنده‌بودنِ یک اپ بورس واقعی.
export async function refreshLivePrices(ctx) {
  try {
    const data = await fetchLiveData();
    await ctx.editMessageText(formatMessage(data), {
      parse_mode: "HTML",
      reply_markup: livePricesKeyboard(),
    });
  } catch (err) {
    console.error("خطای به‌روزرسانی قیمت لحظه‌ای:", err);
    // callback_query از قبل در bot.js یک‌بار answer شده - این تلاش دوم
    // فقط برای نمایش toast خطاست، اگر رد شود بی‌سروصدا نادیده گرفته می‌شود.
    await ctx.answerCallbackQuery({ text: "به‌روزرسانی الان ممکن نشد.", show_alert: false }).catch(() => {});
  }
}
