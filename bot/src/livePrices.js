import { InlineKeyboard } from "grammy";

// هر دو منبع رایگانند، بدون نیاز به API key - برای همین این قابلیت به
// هیچ secret یا زیرساخت اضافه‌ای وابسته نیست.
// CoinGecko رایگان برای مصارف عمومی مثل این خیلی محدودیت‌دار بود (سقف
// نرخش بین همه‌ی کاربرهای Cloudflare Workers مشترک است) - به‌جایش از
// Binance استفاده می‌شود که دقیقاً برای همین نوع مصرف عمومی ساخته شده و
// سقف بسیار بالاتری دارد.
const BINANCE_URL =
  "https://api.binance.com/api/v3/ticker/24hr?symbols=" +
  encodeURIComponent(JSON.stringify(["BTCUSDT", "ETHUSDT"]));
const FX_URL = "https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY";

function fmt(n, digits = 2) {
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function changeArrow(pct) {
  if (pct >= 0) return `🟢 ▲ ${fmt(pct)}%`;
  return `🔴 ▼ ${fmt(Math.abs(pct))}%`;
}

export async function fetchLiveData() {
  const [binance, fx] = await Promise.all([
    fetch(BINANCE_URL).then((r) => r.json()),
    fetch(FX_URL).then((r) => r.json()),
  ]);

  if (!Array.isArray(binance)) {
    throw new Error(`Binance error: ${JSON.stringify(binance)}`);
  }

  const btc = binance.find((t) => t.symbol === "BTCUSDT");
  const eth = binance.find((t) => t.symbol === "ETHUSDT");
  if (!btc || !eth) {
    throw new Error("Binance response missing BTCUSDT/ETHUSDT ticker");
  }

  return { btc, eth, fx };
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
    `₿ بیت‌کوین: <b>$${fmt(btc.lastPrice, 0)}</b>  ${changeArrow(Number(btc.priceChangePercent))}`,
    `Ξ اتریوم: <b>$${fmt(eth.lastPrice, 0)}</b>  ${changeArrow(Number(eth.priceChangePercent))}`,
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
    await ctx.answerCallbackQuery({ text: "به‌روزرسانی الان ممکن نشد.", show_alert: false });
  }
}
