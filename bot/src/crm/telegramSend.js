// فرستنده‌ی خامِ تلگرام، برای پیام همگانی.
//
// چرا جداست: هم پنل از آن استفاده می‌کند و هم کرانِ صف. اگر هرکدام
// نسخه‌ی خودش را داشت، روزی یکی‌شان اصلاح می‌شد و دیگری نه - و بدترین
// شکلش این بود که فقط یکی خطاها را درست تشخیص بدهد.
//
// ─── قاعده‌ی مهمِ این فایل ──────────────────────────────────────────
// خطای زیرساختی بلعیده نمی‌شود، پرتاب می‌شود.
//
// نسخه‌ی قبلی هر خطایی را به { ok: false } تبدیل می‌کرد. یعنی وقتی
// ورکر به سقفِ تعدادِ درخواستِ بیرونی می‌خورد، همه‌ی گیرنده‌های باقی‌مانده
// «ناموفق» علامت می‌خوردند و هرگز دوباره تلاش نمی‌شد - در حالی که فقط
// باید صبر می‌کردند.
//
// حالا دو چیز از هم جدا هستند:
//   - تلگرام جواب داد ولی ok:false  → گیرنده واقعاً مشکل دارد (بلاک
//     کرده، چت را پاک کرده). تکرارش فایده ندارد.
//   - fetch اصلاً جواب نداد        → پرتاب می‌شود، حلقه می‌ایستد و
//     بقیه‌ی صف دست‌نخورده می‌ماند.

const API = "https://api.telegram.org/bot";

async function call(env, method, payload) {
  const r = await fetch(API + env.BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify(payload),
  });
  return r.json();
}

/** (chatId, text) → { ok, message_id }. روی خطای زیرساختی پرتاب می‌کند. */
export function telegramSender(env) {
  return async (chatId, text) => {
    const out = await call(env, "sendMessage", { chat_id: String(chatId), text });
    return out && out.ok
      ? { ok: true, message_id: out.result && out.result.message_id }
      : { ok: false };
  };
}

/**
 * (chatId, messageId) → boolean.
 *
 * اینجا برعکس است و خطا بلعیده می‌شود: حذف نشدنِ یک پیام نباید جلوی حذفِ
 * بقیه را بگیرد، و کاربری که پیام را پاک کرده هم خطا برمی‌گرداند.
 */
export function telegramDeleter(env) {
  return async (chatId, messageId) => {
    try {
      const out = await call(env, "deleteMessage", {
        chat_id: String(chatId),
        message_id: Number(messageId),
      });
      return !!(out && out.ok);
    } catch {
      return false;
    }
  };
}
