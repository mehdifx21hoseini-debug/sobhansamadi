// ویرایشگر متن و عکس بخش‌ها — فقط برای مدیر.
//
// تا پیش از این، عوض کردن یک جمله در ربات یعنی تغییر کد، کامیت، و صبر
// برای دیپلوی. برای متنی که آکادمی می‌خواهد ماهی چند بار عوضش کند، این
// یعنی عملاً هرگز عوض نمی‌شود.
//
// حالا هر بخش از داخل تلگرام قابل ویرایش است: متنش، و عکسی که بالای آن
// می‌نشیند. کد فقط پیش‌فرض را نگه می‌دارد و «بازگشت به پیش‌فرض» همیشه
// در دسترس است - پس هیچ ویرایشی بن‌بست نیست.

import { isOwner } from "../owner.js";
import { SECTIONS, resolveSection, editWithText } from "../content/sectionText.js";
import { setSectionBody, setSectionPhoto, resetSection } from "../content/store.js";
import { setUserState, clearUserState } from "../db.js";

const KEYS = Object.keys(SECTIONS);

// چهار بخش در هر صفحه: برچسب‌ها بلندند و هر دکمه یک ردیف کامل می‌گیرد.
const PAGE_SIZE = 6;

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
function fa(n) {
  return String(n).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

const LIST_TEXT = [
  "📝 <b>ویرایش متن‌های ربات</b>",
  "",
  "هر بخشی را که می‌خواهید عوض کنید انتخاب کنید. برای هر بخش می‌توانید",
  "متن و عکسش را تغییر بدهید، یا به حالت اولیه برگردانید.",
  "",
  "✏️ کنار نام بخش یعنی متنش قبلاً عوض شده.",
].join("\n");

async function listKeyboard(env, page) {
  const pages = Math.max(1, Math.ceil(KEYS.length / PAGE_SIZE));
  const current = Math.min(Math.max(Number(page) || 0, 0), pages - 1);
  const slice = KEYS.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const rows = [];
  for (const key of slice) {
    // نشان دادن اینکه کدام بخش دست‌کاری شده، تنها راه فهمیدن این است که
    // «این متن عجیب از کجا آمده» - از کد، یا از ویرایشی که فراموش شده.
    const { custom, photo } = await resolveSection(env, key);
    rows.push([
      {
        text: (custom ? "✏️ " : "") + (photo ? "🖼 " : "") + SECTIONS[key].label,
        callback_data: `SECED|${key}|${current}`,
      },
    ]);
  }

  if (pages > 1) {
    rows.push([
      current > 0
        ? { text: "◀️ قبلی", callback_data: `SECLIST|${current - 1}` }
        : { text: "·", callback_data: "NOOP" },
      { text: `${fa(current + 1)} از ${fa(pages)}`, callback_data: "NOOP" },
      current < pages - 1
        ? { text: "بعدی ▶️", callback_data: `SECLIST|${current + 1}` }
        : { text: "·", callback_data: "NOOP" },
    ]);
  }

  return { inline_keyboard: rows };
}

export async function handleEditCommand(ctx) {
  if (!isOwner(ctx)) return;
  await ctx.reply(LIST_TEXT, {
    parse_mode: "HTML",
    reply_markup: await listKeyboard(ctx.env, 0),
  });
}

export async function showSectionList(ctx, page) {
  if (!(await requireOwner(ctx))) return;
  await ctx.answerCallbackQuery();
  await editWithText(ctx, LIST_TEXT, await listKeyboard(ctx.env, page)).catch((err) =>
    console.error("فهرست ویرایش:", err && err.message)
  );
}

async function requireOwner(ctx) {
  if (isOwner(ctx)) return true;
  await ctx.answerCallbackQuery().catch(() => {});
  return false;
}

// پیش‌نمایش متن در خودِ صفحه‌ی ویرایش. بلندتر از این، صفحه را از دکمه‌ها
// دور می‌کند و مدیر باید اسکرول کند تا به کاری که می‌خواهد بکند برسد.
const PREVIEW_LIMIT = 400;

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function panelFor(env, key, page) {
  const section = SECTIONS[key];
  const { text, photo, custom } = await resolveSection(env, key);
  const shown = text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT) + " …" : text;

  const body = [
    "📝 <b>" + escapeHtml(section.label) + "</b>",
    "",
    "وضعیت متن: " + (custom ? "✏️ ویرایش‌شده" : "متن پیش‌فرض"),
    "عکس: " + (photo ? "🖼 دارد" : "ندارد"),
    "",
    "<b>متن فعلی:</b>",
    escapeHtml(shown),
  ].join("\n");

  const rows = [
    [
      { text: "✏️ تغییر متن", callback_data: `SECTXT|${key}|${page}` },
      { text: photo ? "🖼 تعویض عکس" : "🖼 افزودن عکس", callback_data: `SECPIC|${key}|${page}` },
    ],
  ];
  if (photo) {
    rows.push([{ text: "🚫 حذف عکس", callback_data: `SECNOPIC|${key}|${page}` }]);
  }
  rows.push([{ text: "👁 پیش‌نمایش (همان‌طور که کاربر می‌بیند)", callback_data: `SECPREV|${key}|${page}` }]);
  if (custom || photo) {
    rows.push([{ text: "♻️ بازگشت به حالت اولیه", callback_data: `SECRESET|${key}|${page}` }]);
  }
  rows.push([{ text: "◀️ بازگشت به فهرست", callback_data: `SECLIST|${page}` }]);

  return { text: body, reply_markup: { inline_keyboard: rows } };
}

export async function openSectionPanel(ctx, key, page) {
  if (!(await requireOwner(ctx))) return;
  if (!SECTIONS[key]) return;

  const panel = await panelFor(ctx.env, key, page);
  await ctx.answerCallbackQuery();
  await ctx
    .editMessageText(panel.text, { parse_mode: "HTML", reply_markup: panel.reply_markup })
    .catch((err) => console.error("صفحه‌ی ویرایش بخش:", err && err.message));
}

// بعد از هر تغییر، همان صفحه دوباره ساخته می‌شود - نه یک پیام «انجام شد»
// که مدیر باید از آن راه برگشت پیدا کند.
async function refreshPanel(ctx, key, page, send) {
  const panel = await panelFor(ctx.env, key, page);
  await send(panel.text, { parse_mode: "HTML", reply_markup: panel.reply_markup }).catch((err) =>
    console.error("به‌روزرسانی صفحه‌ی ویرایش:", err && err.message)
  );
}

const ASK_TEXT = [
  "✏️ متن تازه را بنویسید.",
  "",
  "هر چند خط که بخواهید. همان‌طور که می‌نویسید به کاربر نشان داده می‌شود.",
].join("\n");

const ASK_PHOTO = [
  "🖼 عکس را همین‌جا بفرستید.",
  "",
  "این عکس بالای متن همان بخش می‌نشیند.",
].join("\n");

const CANCEL_KEYBOARD = {
  inline_keyboard: [[{ text: "انصراف", callback_data: "SECCANCEL" }]],
};

async function startEdit(ctx, key, page, step, prompt) {
  if (!(await requireOwner(ctx))) return;
  if (!SECTIONS[key]) return;

  await setUserState(ctx.env, ctx.from.id, {
    current_flow: "section_edit",
    current_step: step,
    temp_data: { key, page: Number(page) || 0 },
  });
  await ctx.answerCallbackQuery();
  await ctx.reply(prompt, { reply_markup: CANCEL_KEYBOARD });
}

export const startSectionText = (ctx, key, page) =>
  startEdit(ctx, key, page, "ask_text", ASK_TEXT);

export const startSectionPhoto = (ctx, key, page) =>
  startEdit(ctx, key, page, "ask_photo", ASK_PHOTO);

export async function cancelSectionEdit(ctx) {
  await clearUserState(ctx.env, ctx.from.id);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("انصراف داده شد؛ چیزی عوض نشد.").catch(() => {});
}

export async function removeSectionPhoto(ctx, key, page) {
  if (!(await requireOwner(ctx))) return;
  if (!SECTIONS[key]) return;
  await setSectionPhoto(ctx.env, SECTIONS[key].code, "");
  await ctx.answerCallbackQuery({ text: "عکس برداشته شد" });
  await refreshPanel(ctx, key, page, (t, o) => ctx.editMessageText(t, o));
}

export async function resetSectionToDefault(ctx, key, page) {
  if (!(await requireOwner(ctx))) return;
  if (!SECTIONS[key]) return;
  await resetSection(ctx.env, SECTIONS[key].code);
  await ctx.answerCallbackQuery({ text: "به حالت اولیه برگشت" });
  await refreshPanel(ctx, key, page, (t, o) => ctx.editMessageText(t, o));
}

// پیش‌نمایش عمداً یک پیام تازه است و صفحه‌ی ویرایش را خراب نمی‌کند:
// مدیر باید بتواند نتیجه را کنار ابزارِ ویرایش ببیند، نه به‌جایش.
export async function previewSection(ctx, key, page) {
  if (!(await requireOwner(ctx))) return;
  if (!SECTIONS[key]) return;

  await ctx.answerCallbackQuery();
  const { text, photo } = await resolveSection(ctx.env, key);
  await ctx.reply("👁 پیش‌نمایش:");
  try {
    if (photo && text.length <= 1024) await ctx.replyWithPhoto(photo, { caption: text });
    else if (photo) {
      await ctx.replyWithPhoto(photo);
      await ctx.reply(text);
    } else await ctx.reply(text);
  } catch (err) {
    await ctx.reply("⚠️ نمایش پیش‌نمایش شکست خورد: " + (err && err.message));
  }
  await refreshPanel(ctx, key, page, (t, o) => ctx.reply(t, o));
}

// ─── پیامی که مدیر بعد از زدن دکمه می‌فرستد ────────────────────────

export async function handleSectionText(ctx, state) {
  if (!isOwner(ctx)) return;
  const data = (state && state.temp_data) || {};
  const section = SECTIONS[data.key];
  const text = String(ctx.message.text || "").trim();

  if (!section) {
    await clearUserState(ctx.env, ctx.from.id);
    await ctx.reply("⚠️ این ویرایش دیگر معتبر نیست. دوباره /edit بزنید.");
    return;
  }
  if (!text) {
    // حالت فعال می‌ماند تا مدیر همین حالا متن درست را بفرستد.
    await ctx.reply("⚠️ متن خالی بود. یک متن بنویسید یا انصراف بزنید.");
    return;
  }

  await clearUserState(ctx.env, ctx.from.id);
  await setSectionBody(ctx.env, section.code, text);
  await ctx.reply("✅ متن این بخش عوض شد.");
  await refreshPanel(ctx, data.key, data.page, (t, o) => ctx.reply(t, o));
}

export async function handleSectionPhoto(ctx, state) {
  if (!isOwner(ctx)) return;
  const data = (state && state.temp_data) || {};
  const section = SECTIONS[data.key];

  const photos = ctx.message.photo;
  // آخرین عضو آرایه بزرگ‌ترین نسخه است.
  const fileId = photos && photos.length ? photos[photos.length - 1].file_id : "";

  if (!fileId) {
    await ctx.reply("⚠️ این یک عکس نبود. یک عکس بفرستید یا انصراف بزنید.");
    return;
  }
  if (!section) {
    await clearUserState(ctx.env, ctx.from.id);
    await ctx.reply("⚠️ این ویرایش دیگر معتبر نیست. دوباره /edit بزنید.");
    return;
  }

  await clearUserState(ctx.env, ctx.from.id);
  await setSectionPhoto(ctx.env, section.code, fileId);
  await ctx.reply("✅ عکس این بخش ثبت شد.");
  await refreshPanel(ctx, data.key, data.page, (t, o) => ctx.reply(t, o));
}
