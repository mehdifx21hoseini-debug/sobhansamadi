// فرستادن محتوای واقعی به کاربر.
//
// تا پیش از این، هر درخواست محتوا فقط «ثبت شد» می‌گرفت چون هیچ فایلی در
// دسترس نبود. حالا اگر فایل در کتابخانه باشد، همان لحظه فرستاده می‌شود و
// پیام «در حال آماده‌سازی» فقط برای چیزهایی می‌ماند که واقعاً هنوز نیامده‌اند.

import { getContent, getContentParts } from "./store.js";

// هر نوع فایل متد فرستادن خودش را دارد. voice و audio جدا نگه داشته شده‌اند
// چون تلگرام ویس را با موج صوتی نشان می‌دهد و آهنگ را با کاور - و برای
// کتاب صوتی، همان تفاوت را کاربر حس می‌کند.
const SENDERS = {
  voice: (api, chatId, fileId, caption) => api.sendVoice(chatId, fileId, caption),
  audio: (api, chatId, fileId, caption) => api.sendAudio(chatId, fileId, caption),
  video: (api, chatId, fileId, caption) => api.sendVideo(chatId, fileId, caption),
  document: (api, chatId, fileId, caption) => api.sendDocument(chatId, fileId, caption),
  photo: (api, chatId, fileId, caption) => api.sendPhoto(chatId, fileId, caption),
};

async function sendOne(ctx, row, extra = {}) {
  const send = SENDERS[row.file_type];
  if (!send) {
    // نوعی که نمی‌شناسیم - به‌جای سکوت، دست‌کم لینک/شناسه‌اش می‌رود.
    await ctx.reply((row.title || "") + "\n" + row.file_id, extra);
    return true;
  }
  // کپشن تلگرام سقف ۱۰۲۴ کاراکتری دارد؛ عنوان بلندتر کل ارسال را رد
  // می‌کند، پس بریده می‌شود نه اینکه فایل نرسد.
  const caption = row.title ? { caption: String(row.title).slice(0, 1000) } : {};
  await send(ctx.api, ctx.chat.id, row.file_id, { ...caption, ...extra });
  return true;
}

/**
 * تلاش برای فرستادن یک محتوا.
 * @param {{includeHidden?: boolean}} [opts] مدیر موردهای مخفی را هم
 *   می‌بیند؛ برای کاربر عادی مخفی یعنی وجود ندارد.
 * @returns {Promise<number>} تعداد فایل‌هایی که واقعاً رفت. صفر یعنی
 *   چیزی در کتابخانه نبود و صداکننده باید به مسیر «ثبت درخواست» برگردد.
 */
export async function deliverContent(ctx, contentId, opts = {}) {
  // extra به آخرین فایل می‌چسبد، نه به همه: یک دکمه که زیر هر پارت
  // تکرار شود، پنج بار همان دکمه است - و کاربر نمی‌فهمد کدامش «بعدی»
  // است. زیر آخرین فایل اما دقیقاً همان‌جایی است که تمام شده و قدم بعد
  // را می‌خواهد.
  const { extra, ...findOpts } = opts;

  const exact = await getContent(ctx.env, contentId, findOpts);
  if (exact && exact.file_id) {
    await sendOne(ctx, exact, extra);
    return 1;
  }

  // تطبیق دقیق نبود: شاید چندپارتی است (BOOK_02_AUDIO → ..._P01 تا _P05).
  const parts = await getContentParts(ctx.env, contentId, findOpts);
  if (parts.length === 0) return 0;

  // ترتیب مهم است - پارت ۳ قبل از ۲ یعنی کتاب به‌هم‌ریخته. مرتب‌سازی در
  // خود کوئری است، اینجا فقط پشت‌سرهم فرستاده می‌شوند.
  let sent = 0;
  for (const row of parts) {
    try {
      await sendOne(ctx, row, row === parts[parts.length - 1] ? extra : undefined);
      sent++;
    } catch (err) {
      // یک پارت خراب نباید بقیه را از بین ببرد.
      console.error("ارسال پارت شکست خورد:", row.content_id, err && err.message);
    }
  }
  return sent;
}
