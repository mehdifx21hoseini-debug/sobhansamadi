// از یک متن خام، یک مدخل مرتب پایگاه دانش پیشنهاد می‌دهد.
//
// این قابلیت در CRM بود ولی از n8n می‌گذشت. حالا که خود پایگاه دانش
// اینجاست، ماندنش آن‌طرف یعنی صفحه‌ای که دقیقاً وقتی لازم است - وقتی
// می‌خواهی یک سوال بی‌جواب را اضافه کنی - به یک سرویس سوم وابسته باشد.
//
// دسته‌های موجود به مدل داده می‌شوند تا مدخل تازه در همان دسته‌بندی
// بنشیند، نه اینکه هر بار یک نام تازه بسازد و فهرست دسته‌ها پر از
// «قیمت»، «قیمت‌ها» و «هزینه» شود.

import { generateStructured } from "./gemini.js";

const SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string" },
    question: { type: "string" },
    answer: { type: "string" },
    confidence: { type: "number" },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["category", "question", "answer", "confidence", "warnings"],
};

function prompt(categories) {
  return [
    "تو دستیار سازمان‌دهی پایگاه دانش «آکادمی سبحان صمدی» هستی.",
    "کاربر یک متن خام می‌دهد (پیام مشتری، توضیح دوره، یادداشت داخلی).",
    "کار تو این است که از آن یک مدخل پرسش و پاسخ تمیز بسازی.",
    "",
    "قواعد:",
    "۱. سوال را طوری بنویس که کاربر واقعی می‌پرسد، نه به زبان اداری.",
    "۲. پاسخ باید کامل و خودبسنده باشد؛ کسی که فقط همین پاسخ را می‌خواند باید بفهمد.",
    "۳. چیزی از خودت اضافه نکن. اگر متن خام عددی یا شرطی ندارد، تو هم ننویس.",
    "۴. اگر متن مبهم است یا اطلاعات مهمی کم دارد، در warnings بنویس چه چیزی کم است.",
    "۵. confidence بین ۰ و ۱: چقدر مطمئنی این مدخل بدون بازبینی قابل استفاده است.",
    "۶. همه‌چیز فارسی باشد.",
    "",
    categories.length > 0
      ? "دسته‌های موجود (اگر یکی‌شان مناسب بود همان را بردار، نام تازه نساز): " +
        categories.join("، ")
      : "دسته‌ای هنوز تعریف نشده؛ یک نام کوتاه و کلی انتخاب کن.",
  ].join("\n");
}

/**
 * @returns {Promise<{category, question, answer, confidence, warnings}>}
 */
export async function suggestEntry(env, text, categories = []) {
  const parsed = await generateStructured(env, prompt(categories), text, SCHEMA);
  return {
    category: String(parsed.category || "").trim(),
    question: String(parsed.question || "").trim(),
    answer: String(parsed.answer || "").trim(),
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
  };
}
