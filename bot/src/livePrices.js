import { InlineKeyboard } from "grammy";

// هر دو منبع رایگانند، بدون نیاز به API key - برای همین این قابلیت به
// هیچ secret یا زیرساخت اضافه‌ای وابسته نیست.
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true";
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

// CoinGecko رد می‌کند اگر User-Agent نداشته باشد (fetch پیش‌فرض Cloudflare
// Workers یکی نمی‌فرستد) - کد ۴۰۳ با پیام "add a descriptive User-Agent".
const COINGECKO_HEADERS = {
  "User-Agent": "sobhan-academy-bot/1.0 (+https://github.com/mehdifx21hoseini-debug/sobhansamadi)",
};

export async function fetchLiveData() {
  const [cg, fx] = await Promise.all([
    fetch(COINGECKO_URL, { headers: COINGECKO_HEADERS }).then((r) => r.json()),
    fetch(FX_URL).then((r) => r.json()),
  ]);

  if (cg.status && cg.status.error_code) {
    throw new Error(`CoinGecko error ${cg.status.error_code}: ${cg.status.error_message}`);
  }

  return { cg, fx };
}

function formatMessage({ cg, fx }) {
  const btc = cg.bitcoin;
  const eth = cg.ethereum;
  const now = new Date().toLocaleTimeString("fa-IR", {
    timeZone: "Asia/Tehran",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return [
    "📊 <b>بازارهای لحظه‌ای</b>",
    "",
    `₿ بیت‌کوین: <b>$${fmt(btc.usd, 0)}</b>  ${changeArrow(btc.usd_24h_change)}`,
    `Ξ اتریوم: <b>$${fmt(eth.usd, 0)}</b>  ${changeArrow(eth.usd_24h_change)}`,
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
