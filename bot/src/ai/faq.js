// دستیار پشتیبانی: از سوال کاربر تا پاسخ.
//
// این همان زنجیره‌ی WF-07 است، فقط بدون n8n در مسیر:
//   پایگاه دانش (D1) → بردار سوال (Gemini) → رتبه‌بندی معنایی →
//   ساخت پرامپت → پاسخ ساختاریافته (Gemini) → تصمیمِ «انسان لازم است؟»
//
// هیچ مرحله‌ای اجازه ندارد کل مسیر را بخواباند: اگر پایگاه دانش خالی باشد
// یا Gemini جواب ندهد، تابع null برمی‌گرداند و صداکننده به همان مسیر
// تیکت انسانی برمی‌گردد - یعنی بدترین حالتِ ممکن، رفتار قبلی ربات است.

import { loadKb } from "./kb.js";
import { rank } from "./retrieval.js";
import { embedQuestion, generateAnswer } from "./gemini.js";
import { buildSystemPrompt } from "./prompt.js";

// همان عددی که WF-07 داشت: دو نوبت آخر گفتگو به‌عنوان زمینه می‌رود، نه
// بیشتر - وگرنه پرامپت باد می‌کند و مدل روی سوال قدیمی قفل می‌شود.
const MAX_HISTORY_TURNS = 2;

const OFF_TOPIC_ANSWER =
  "من فقط می‌تونم درباره دوره‌ها، خدمات و اطلاعات مرتبط با آکادمی راهنمایی‌تون کنم. 😊";

export const HUMAN_FALLBACK_ANSWER =
  "این سوال نیاز به بررسی دقیق‌تر داره. برای تیم پشتیبانی آکادمی ارسال شد و طی ۲۴ ساعت کاری پاسخ می‌گیرید. 🙏";

// عیناً منطق نود Parse AI Response. مهم‌ترین قسمتش این است که «مدل گفت
// انسان لازم است» و «مدل اصلاً جوابی نداد» هر دو به ارجاع ختم می‌شوند -
// یک پاسخ خالی هرگز نباید به‌عنوان پاسخ به کاربر برود.
function decide(parsed) {
  const isOffTopic = !!parsed.is_off_topic;
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  const aiFlaggedSensitive = !!parsed.needs_human;
  const hasAnswer = !!(parsed.answer && String(parsed.answer).trim());
  const needsHuman = aiFlaggedSensitive || (!isOffTopic && !hasAnswer);

  let reason = "";
  if (isOffTopic) reason = "off_topic";
  else if (aiFlaggedSensitive) reason = "ai_flagged_sensitive";
  else if (!hasAnswer) reason = "no_answer";

  let answer;
  if (isOffTopic) answer = OFF_TOPIC_ANSWER;
  else if (hasAnswer) answer = parsed.answer;
  else answer = HUMAN_FALLBACK_ANSWER;

  return {
    intent: parsed.intent || "unknown",
    confidence,
    isOffTopic,
    needsHuman,
    reason,
    answer,
    matchedKbIds: Array.isArray(parsed.matched_kb_ids)
      ? [...new Set(parsed.matched_kb_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
      : [],
  };
}

/**
 * @returns {Promise<null|{answer, needsHuman, reason, matchedKbIds, history}>}
 *   null یعنی «دستیار در دسترس نیست» - نه اینکه سوال بی‌جواب است. صداکننده
 *   باید در آن حالت تیکت بسازد.
 */
export async function askFaq(env, { question, user, history, currentFlow, currentStep }) {
  if (!env.GEMINI_API_KEY) return null;

  const kb = await loadKb(env);
  // بدون پایگاه دانش، مدل چیزی برای استناد ندارد و قانون ۲ پرامپت
  // می‌گوید حدس نزند. پس اصلاً صدایش نمی‌زنیم.
  if (kb.rows.length === 0) return null;

  // بردار سوال اختیاری است: اگر نیامد، رتبه‌بندی فقط با کلیدواژه انجام
  // می‌شود. پاسخ کمی خام‌تر است ولی پشتیبانی سرِ پا می‌ماند - و برخلاف
  // نسخه‌ی قبلی، دیگر کل پایگاه دانش به پرامپت ریخته نمی‌شود.
  let queryVec = null;
  try {
    queryVec = await embedQuestion(env, question);
  } catch (err) {
    console.error("بردار سوال ساخته نشد، رتبه‌بندی فقط کلیدواژه‌ای است:", err && err.message);
  }

  const selected = rank(kb, queryVec, question);

  const { systemPrompt, recentHistory } = buildSystemPrompt({
    upd: {
      question,
      telegram_user_id: user.id,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      history,
      current_flow: currentFlow,
      current_step: currentStep,
    },
    rows: selected,
  });

  const parsed = await generateAnswer(env, systemPrompt, question);
  const result = decide(parsed);

  const updatedHistory = recentHistory
    .concat([{ q: question, a: result.answer }])
    .slice(-MAX_HISTORY_TURNS);

  return { ...result, history: { ai_history: updatedHistory } };
}
