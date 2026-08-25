import { InlineKeyboard } from "grammy";

// کندل‌های واقعی از Coinbase Exchange (رایگان، بدون کلید). Coinbase مثل
// Coinbase.com/v2 محدودیت جغرافیایی سختگیرانه ندارد - قبلاً برای قیمت
// لحظه‌ای همین منبع را تست کردیم و پایدار بود.
const CANDLES_URL = "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600";
const CANDLES_HEADERS = {
  "User-Agent": "sobhan-academy-bot/1.0 (+https://github.com/mehdifx21hoseini-debug/sobhansamadi)",
};

async function fetchCandles() {
  const res = await fetch(CANDLES_URL, { headers: CANDLES_HEADERS });
  const raw = await res.json();
  if (!Array.isArray(raw)) {
    throw new Error(`Coinbase candles error: ${JSON.stringify(raw)}`);
  }
  // هر ردیف: [time, low, high, open, close, volume] - جدیدترین اول است،
  // برای رسم نمودار باید قدیمی به جدید مرتب شود.
  return raw
    .slice(0, 24)
    .reverse()
    .map((row) => ({ time: row[0], close: row[4] }));
}

function buildChartUrl(candles) {
  const labels = candles.map((c) =>
    new Date(c.time * 1000).toLocaleTimeString("en-US", {
      timeZone: "Asia/Tehran",
      hour: "2-digit",
      hour12: false,
    })
  );
  const data = candles.map((c) => Number(c.close.toFixed(0)));
  const rising = data[data.length - 1] >= data[0];
  const lineColor = rising ? "#22c55e" : "#ef4444";
  const fillColor = rising ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)";

  const chartConfig = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data,
          borderColor: lineColor,
          backgroundColor: fillColor,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 3,
        },
      ],
    },
    options: {
      title: { display: true, text: "BTC/USD - 24 ساعت اخیر", fontColor: "#e5e7eb", fontSize: 16 },
      legend: { display: false },
      scales: {
        xAxes: [{ gridLines: { color: "#27272a" }, ticks: { fontColor: "#a1a1aa", maxTicksLimit: 8 } }],
        yAxes: [{ gridLines: { color: "#27272a" }, ticks: { fontColor: "#a1a1aa" } }],
      },
    },
  };

  const encoded = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?c=${encoded}&backgroundColor=%230b0b0f&width=800&height=450&devicePixelRatio=2`;
}

function chartKeyboard() {
  return new InlineKeyboard()
    .text("🔄 به‌روزرسانی نمودار", "btc_chart_refresh")
    .row()
    .text("⬅️ بازگشت به منو", "back_to_menu");
}

async function buildCaption(candles) {
  const first = candles[0].close;
  const last = candles[candles.length - 1].close;
  const pct = (((last - first) / first) * 100).toFixed(2);
  const arrow = last >= first ? "🟢 ▲" : "🔴 ▼";
  const now = new Date().toLocaleTimeString("fa-IR", {
    timeZone: "Asia/Tehran",
    hour: "2-digit",
    minute: "2-digit",
  });
  return [
    `📈 <b>بیت‌کوین: $${last.toLocaleString("en-US")}</b>`,
    `${arrow} ${Math.abs(pct)}٪ در ۲۴ ساعت اخیر`,
    `⏱ ${now} به وقت تهران`,
  ].join("\n");
}

export async function sendBtcChart(ctx) {
  const loading = await ctx.reply("⏳ در حال رسم نمودار زنده...");
  try {
    const candles = await fetchCandles();
    const url = buildChartUrl(candles);
    const caption = await buildCaption(candles);
    await ctx.replyWithPhoto(url, {
      caption,
      parse_mode: "HTML",
      reply_markup: chartKeyboard(),
    });
    await ctx.api.deleteMessage(loading.chat.id, loading.message_id).catch(() => {});
  } catch (err) {
    console.error("خطای رسم نمودار:", err);
    await ctx.api
      .editMessageText(loading.chat.id, loading.message_id, "رسم نمودار الان ممکن نشد، چند لحظه دیگه دوباره امتحان کنید.")
      .catch(() => {});
  }
}

export async function refreshBtcChart(ctx) {
  try {
    const candles = await fetchCandles();
    const url = buildChartUrl(candles);
    const caption = await buildCaption(candles);
    await ctx.editMessageMedia(
      { type: "photo", media: url, caption, parse_mode: "HTML" },
      { reply_markup: chartKeyboard() }
    );
    // callback_query از قبل در bot.js یک‌بار answer شده - این تلاش‌های
    // بعدی فقط برای نمایش toast هستند، اگر رد شوند بی‌سروصدا نادیده گرفته می‌شوند.
    await ctx.answerCallbackQuery({ text: "نمودار به‌روزرسانی شد ✅" }).catch(() => {});
  } catch (err) {
    console.error("خطای به‌روزرسانی نمودار:", err);
    await ctx.answerCallbackQuery({ text: "به‌روزرسانی الان ممکن نشد.", show_alert: false }).catch(() => {});
  }
}
