// ویرایشگر لینک‌های ربات — فقط برای مدیر.
//
// سومین خواهرِ این خانواده، بعد از editor.js (متن) و labelEditor.js
// (نامِ دکمه‌ها). عمداً همان شکل: فهرست، صفحه‌ی هر مورد، یک قدمِ
// «بنویس»، و بازگشت به پیش‌فرض.
//
// فهرست یک‌سطحی است، برخلافِ نامِ دکمه‌ها: هفت لینک در یک صفحه جا
// می‌شود و دسته‌بندی فقط یک ضربه‌ی اضافه می‌شد.

import { isOwner } from "../owner.js";
import { setUserState, clearUserState } from "../db.js";
import {
  LINKS,
  linkState,
  setLink,
  resetLink,
  validateLink,
  usernameFromTelegramUrl,
} from "../content/botLinks.js";

const LIST_TEXT = [
  "🔗 <b>لینک‌های ربات</b>",
  "",
  "هر کدام را که می‌خواهید عوض کنید انتخاب کنید.",
  "",
  "✏️ یعنی قبلاً عوض شده.",
  "",
  "<i>آدرس‌های فنی — مثل سرویس تقویم و وبهوک‌ها — عمداً اینجا نیستند: آن‌ها قرارداد بین دو سامانه‌اند و عوض شدنشان یک بخش را بی‌صدا از کار می‌اندازد.</i>",
].join("\n");

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function requireOwner(ctx) {
  if (isOwner(ctx)) return true;
  await ctx.answerCallbackQuery().catch(() => {});
  return false;
}

async function listKeyboard(env) {
  const rows = [];
  for (const l of LINKS) {
    const st = await linkState(env, l.key);
    rows.push([
      { text: (st.custom ? "✏️ " : "") + l.title, callback_data: `LNKED|${l.key}` },
    ]);
  }
  return { inline_keyboard: rows };
}

export async function handleLinksCommand(ctx) {
  if (!isOwner(ctx)) return;
  await ctx.reply(LIST_TEXT, {
    parse_mode: "HTML",
    reply_markup: await listKeyboard(ctx.env),
  });
}

export async function showLinkList(ctx) {
  if (!(await requireOwner(ctx))) return;
  await ctx.answerCallbackQuery();
  await ctx
    .editMessageText(LIST_TEXT, {
      parse_mode: "HTML",
      reply_markup: await listKeyboard(ctx.env),
    })
    .catch((err) => console.error("فهرست لینک‌ها:", err && err.message));
}

async function panelFor(env, key) {
  const st = await linkState(env, key);
  if (!st) return null;

  const lines = [
    "🔗 <b>" + escapeHtml(st.title) + "</b>",
    "",
    "<b>آدرس فعلی:</b>",
    // code و نه لینکِ زنده: مدیر باید خودِ رشته را ببیند و بتواند
    // کپی‌اش کند، نه اینکه ناخواسته بازش کند.
    "<code>" + escapeHtml(st.url) + "</code>",
    "",
    "وضعیت: " + (st.custom ? "✏️ عوض شده" : "آدرس پیش‌فرض"),
  ];
  if (st.custom) {
    lines.push("", "<b>آدرس پیش‌فرض:</b>", "<code>" + escapeHtml(st.def) + "</code>");
  }
  if (st.note) lines.push("", "⚠️ " + escapeHtml(st.note));
  if (st.telegram) {
    const u = usernameFromTelegramUrl(st.url);
    if (u) lines.push("", "کانالِ دروازه‌ی عضویت: <code>" + escapeHtml(u) + "</code>");
  }

  const rows = [[{ text: "✏️ تغییر آدرس", callback_data: `LNKTXT|${key}` }]];
  if (st.custom) {
    rows.push([{ text: "♻️ بازگشت به آدرس پیش‌فرض", callback_data: `LNKRESET|${key}` }]);
  }
  rows.push([{ text: "◀️ بازگشت به فهرست", callback_data: "LNKLIST" }]);

  return { text: lines.join("\n"), reply_markup: { inline_keyboard: rows } };
}

export async function openLinkPanel(ctx, key) {
  if (!(await requireOwner(ctx))) return;
  const panel = await panelFor(ctx.env, key);
  if (!panel) return;
  await ctx.answerCallbackQuery();
  await ctx
    .editMessageText(panel.text, { parse_mode: "HTML", reply_markup: panel.reply_markup })
    .catch((err) => console.error("صفحه‌ی لینک:", err && err.message));
}

async function refreshPanel(ctx, key, send) {
  const panel = await panelFor(ctx.env, key);
  if (!panel) return;
  await send(panel.text, { parse_mode: "HTML", reply_markup: panel.reply_markup }).catch((err) =>
    console.error("به‌روزرسانی صفحه‌ی لینک:", err && err.message)
  );
}

const CANCEL_KEYBOARD = {
  inline_keyboard: [[{ text: "انصراف", callback_data: "LNKCANCEL" }]],
};

export async function startLinkEdit(ctx, key) {
  if (!(await requireOwner(ctx))) return;
  const st = await linkState(ctx.env, key);
  if (!st) return;

  await setUserState(ctx.env, ctx.from.id, {
    current_flow: "link_edit",
    current_step: "ask_link",
    temp_data: { key },
  });
  await ctx.answerCallbackQuery();

  const ask = [
    "✏️ آدرس تازه را بفرستید.",
    "",
    "کامل، با https:// در ابتدا.",
  ];
  if (st.note) ask.push("", "⚠️ " + st.note);
  await ctx.reply(ask.join("\n"), { reply_markup: CANCEL_KEYBOARD });
}

export async function cancelLinkEdit(ctx) {
  await clearUserState(ctx.env, ctx.from.id);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("انصراف داده شد؛ چیزی عوض نشد.").catch(() => {});
}

export async function resetLinkToDefault(ctx, key) {
  if (!(await requireOwner(ctx))) return;
  await resetLink(ctx.env, key);
  await ctx.answerCallbackQuery({ text: "به آدرس پیش‌فرض برگشت" });
  await refreshPanel(ctx, key, (t, o) => ctx.editMessageText(t, o));
}

// ─── آدرسی که مدیر می‌فرستد ────────────────────────────────────────

export async function handleLinkText(ctx, state) {
  if (!isOwner(ctx)) return;
  const key = ((state && state.temp_data) || {}).key;
  const st = await linkState(ctx.env, key);

  if (!st) {
    await clearUserState(ctx.env, ctx.from.id);
    await ctx.reply("⚠️ این ویرایش دیگر معتبر نیست. دوباره /links بزنید.");
    return;
  }

  const url = String(ctx.message.text || "").trim();
  const problem = validateLink(key, url);
  if (problem) {
    // حالت فعال می‌ماند تا مدیر همان‌جا درستش را بفرستد.
    await ctx.reply("⚠️ " + problem);
    return;
  }

  await clearUserState(ctx.env, ctx.from.id);
  await setLink(ctx.env, key, url);

  const done = ["✅ آدرس عوض شد و همین حالا در ربات فعال است."];
  if (st.telegram) {
    done.push("", "دروازه‌ی عضویت هم روی " + usernameFromTelegramUrl(url) + " تنظیم شد.");
  }
  await ctx.reply(done.join("\n"));
  await refreshPanel(ctx, key, (t, o) => ctx.reply(t, o));
}
