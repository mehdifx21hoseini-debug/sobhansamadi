// تماس مستقیم با Gemini، بدون واسطه.
//
// در n8n این کار با نودهای langchain انجام می‌شد. آن نودها فقط یک لایه‌ی
// نازک روی همین REST API هستند، پس حذفشان چیزی از دست نمی‌دهد و در عوض
// یک رفت‌وبرگشت اضافه و یک نقطه‌ی خرابی کمتر می‌شود.

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// این دو باید دقیقاً همان چیزی بمانند که WF-07 داشت:
//
// - مدل embedding و ابعادش حیاتی است. بردارهای ذخیره‌شده در پایگاه دانش با
//   gemini-embedding-001 و ۲۵۶ بُعد ساخته شده‌اند؛ اگر سوال کاربر با مدل یا
//   بُعد دیگری بردار شود، شباهت کسینوسی عدد بی‌معنی می‌دهد و رتبه‌بندی
//   بی‌صدا خراب می‌شود - نه خطا می‌دهد، نه معلوم است.
// - دمای ۱.۱ عمدی است: قانون ۳۷ پرامپت می‌خواهد پاسخ‌های تکراری هر بار با
//   جمله‌بندی تازه بیایند.
const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIMS = 256;
const CHAT_MODEL = "gemini-3.1-flash-lite";
const TEMPERATURE = 1.1;

// همان شکلی که Output Parser در n8n تحمیل می‌کرد. حالا خود Gemini آن را
// تضمین می‌کند، پس دیگر لازم نیست از دل متن آزاد JSON بیرون کشیده شود.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string" },
    confidence: { type: "number" },
    is_off_topic: { type: "boolean" },
    needs_human: { type: "boolean" },
    answer: { type: "string" },
    matched_kb_ids: { type: "array", items: { type: "integer" } },
  },
  required: ["intent", "confidence", "is_off_topic", "needs_human", "answer", "matched_kb_ids"],
};

async function callGemini(env, path, body, timeoutMs) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY تنظیم نشده است");

  // بدون مهلت، یک سرویس کند به‌جای خطا دادن فقط جواب نمی‌دهد؛ ورکر کشته
  // می‌شود و کاربر «در حال تایپ» می‌بیند و بعد هیچ. همان درسی که تقویم داد.
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error("پاسخ ناموفق از Gemini: " + res.status + " " + detail.slice(0, 200));
  }
  return res.json();
}

// بردار سوال کاربر. شکست اینجا کشنده نیست: بدون بردار، همه‌ی پایگاه دانش
// به مدل داده می‌شود و پاسخ کمی عمومی‌تر می‌شود - ولی پشتیبانی می‌ماند.
export async function embedQuestion(env, question) {
  const data = await callGemini(
    env,
    `/${EMBED_MODEL}:embedContent`,
    {
      model: "models/" + EMBED_MODEL,
      content: { parts: [{ text: String(question) }] },
      outputDimensionality: EMBED_DIMS,
    },
    8000
  );
  const values = data && data.embedding && data.embedding.values;
  return Array.isArray(values) ? values : null;
}

// چند متن در یک درخواست.
//
// چرا لازم است: پایگاه دانش ۲۲۳ مدخل دارد و یکی‌یکی یعنی ۲۲۳ درخواست
// بیرونی در یک اجرا - چند برابر سقفی که Cloudflare Workers اجازه
// می‌دهد. با این مسیر همان کار سه‌چهار درخواست می‌شود.
//
// خروجی هم‌ترتیب با ورودی است؛ اگر نبود، هر بردار به مدخل اشتباه
// می‌چسبید و رتبه‌بندی معنایی بی‌سروته می‌شد - پس طول خروجی چک می‌شود.
export const EMBED_BATCH_MAX = 50;

export async function embedBatch(env, texts) {
  const list = (texts || []).map((t) => String(t == null ? "" : t));
  if (list.length === 0) return [];
  if (list.length > EMBED_BATCH_MAX) {
    throw new Error("دسته بزرگ‌تر از سقف " + EMBED_BATCH_MAX + " است");
  }

  const data = await callGemini(
    env,
    `/${EMBED_MODEL}:batchEmbedContents`,
    {
      requests: list.map((text) => ({
        model: "models/" + EMBED_MODEL,
        content: { parts: [{ text }] },
        outputDimensionality: EMBED_DIMS,
      })),
    },
    // ۵۰ متن در یک درخواست، پس مهلتش هم باید بزرگ‌تر از تک‌متن باشد.
    30000
  );

  const out = (data && data.embeddings) || [];
  if (out.length !== list.length) {
    throw new Error("تعداد بردارها با تعداد متن‌ها نمی‌خواند: " + out.length + " ≠ " + list.length);
  }
  return out.map((e) => (e && Array.isArray(e.values) ? e.values : null));
}

export async function generateAnswer(env, systemPrompt, question) {
  const data = await callGemini(
    env,
    `/${CHAT_MODEL}:generateContent`,
    {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: String(question) }] }],
      generationConfig: {
        temperature: TEMPERATURE,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    },
    25000
  );

  const text =
    data &&
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0] &&
    data.candidates[0].content.parts[0].text;

  if (!text) {
    // مدل می‌تواند به‌جای متن، دلیل توقف برگرداند - مثلاً فیلتر ایمنی.
    // آن حالت باید مثل «جواب ندارم» رفتار کند، نه مثل خطای ناشناخته.
    const reason = data && data.candidates && data.candidates[0] && data.candidates[0].finishReason;
    throw new Error("پاسخ خالی از Gemini" + (reason ? " (" + reason + ")" : ""));
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("پاسخ Gemini JSON معتبر نبود");
  }
}
