// ویرایشگر نامِ دکمه‌های منوی اصلی — فقط برای مدیر.
//
// خواهرِ editor.js است و عمداً همان شکل را دارد: فهرست، صفحه‌ی هر
// دکمه، و یک قدمِ «بنویس». مدیری که یکی را بلد است، دیگری را هم
// بلد است.
//
// تفاوتِ مهم با ویرایشگرِ متن، که در buttonLabels.js شرحش آمده: نامِ
// دکمه فقط یک برچسب نیست، **کلیدِ مسیریابی** هم هست. کیبوردِ منو سمتِ
// کاربر کش می‌شود و وقتی زده می‌شود خودِ متن به ربات می‌رسد. پس هر
// تغییرِ نام، نامِ قبلی را هم باید زنده نگه دارد - وگرنه دکمه برای
// هزاران نفری که هنوز /start نزده‌اند بی‌صدا از کار می‌افتد.

import { isOwner } from "../owner.js";
import { setUserState, clearUserState } from "../db.js";
import {
  EDITABLE_BUTTONS,
  INLINE_GROUPS,
  INLINE_DEFAULTS,
  LABEL_MAX,
  labelState,
  inlineState,
  setLabel,
  resetLabel,
  conflictingKey,
} from "../content/buttonLabels.js";

const PAGE_SIZE = 5;

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const fa = (n) => String(n).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

const ROOT_TEXT = [
  "🔤 <b>نام دکمه‌ها</b>",
  "",
  "کدام دسته را می‌خواهید؟",
].join("\n");

const LIST_TEXT = [
  "🔤 <b>دکمه‌های منوی اصلی</b>",
  "",
  "نامِ هر دکمه‌ی منوی اصلی را می‌توانید عوض کنید.",
  "",
  "✏️ یعنی نامش قبلاً عوض شده.",
  "",
  "<i>نامِ قبلی هر دکمه همچنان کار می‌کند، پس کسی که کیبوردش هنوز به‌روز نشده به بن‌بست نمی‌خورد.</i>",
].join("\n");

// ریشه‌ی ویرایشگر: منوی اصلی، و شش دسته‌ی دکمه‌های زیرمجموعه.
//
// دو سطحی شد چون چهل‌ودو دکمه در یک فهرستِ صفحه‌بندی‌شده یعنی نُه صفحه
// ورق زدن برای رسیدن به یکی - و مدیر معمولاً می‌داند دنبالِ کدام بخش
// است، نه اینکه دنبالِ نامش بگردد.
function rootKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📱 منوی اصلی", callback_data: "BTNLIST|0" }],
      ...INLINE_GROUPS.map((g) => [
        { text: g.title, callback_data: `BTNGRP|${g.id}|0` },
      ]),
    ],
  };
}

export async function showLabelRoot(ctx) {
  if (!(await requireOwner(ctx))) return;
  await ctx.answerCallbackQuery();
  await ctx
    .editMessageText(ROOT_TEXT, { parse_mode: "HTML", reply_markup: rootKeyboard() })
    .catch((err) => console.error("ریشه‌ی نام دکمه‌ها:", err && err.message));
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function listKeyboard(env, page) {
  const pages = Math.max(1, Math.ceil(EDITABLE_BUTTONS.length / PAGE_SIZE));
  const current = Math.min(Math.max(Number(page) || 0, 0), pages - 1);
  const slice = EDITABLE_BUTTONS.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const rows = [];
  for (const b of slice) {
    const { label, custom } = await labelState(env, b.key);
    rows.push([
      { text: (custom ? "✏️ " : "") + label, callback_data: `BTNED|${b.key}|${current}` },
    ]);
  }

  if (pages > 1) {
    rows.push([
      current > 0
        ? { text: "◀️ قبلی", callback_data: `BTNLIST|${current - 1}` }
        : { text: "·", callback_data: "NOOP" },
      { text: `${fa(current + 1)} از ${fa(pages)}`, callback_data: "NOOP" },
      current < pages - 1
        ? { text: "بعدی ▶️", callback_data: `BTNLIST|${current + 1}` }
        : { text: "·", callback_data: "NOOP" },
    ]);
  }

  return { inline_keyboard: rows };
}

export async function handleLabelsCommand(ctx) {
  if (!isOwner(ctx)) return;
  await ctx.reply(ROOT_TEXT, { parse_mode: "HTML", reply_markup: rootKeyboard() });
}

async function requireOwner(ctx) {
  if (isOwner(ctx)) return true;
  await ctx.answerCallbackQuery().catch(() => {});
  return false;
}

export async function showLabelList(ctx, page) {
  if (!(await requireOwner(ctx))) return;
  await ctx.answerCallbackQuery();
  await ctx
    .editMessageText(LIST_TEXT, {
      parse_mode: "HTML",
      reply_markup: await listKeyboard(ctx.env, page),
    })
    .catch((err) => console.error("فهرست نام دکمه‌ها:", err && err.message));
}

// هر دو نوع دکمه از همین یک تابع پیدا می‌شوند، پس بقیه‌ی ویرایشگر
// لازم نیست بداند با کدام‌شان طرف است.
function findButton(key) {
  const menu = EDITABLE_BUTTONS.find((b) => b.key === key);
  if (menu) return { ...menu, inline: false };
  for (const g of INLINE_GROUPS) {
    const hit = g.items.find(([k]) => k === key);
    if (hit) {
      return { key, hint: "دکمه‌ی داخلِ بخشِ " + g.title, group: g.id, inline: true };
    }
  }
  return null;
}

function findGroup(id) {
  return INLINE_GROUPS.find((g) => g.id === id) || null;
}

function groupText(g) {
  return [
    "🔤 <b>" + g.title + "</b>",
    "",
    "نامِ هر کدام را می‌توانید عوض کنید.",
    "",
    "✏️ یعنی نامش قبلاً عوض شده.",
    "",
    "<i>این دکمه‌ها با شناسه‌ی داخلی کار می‌کنند نه با متنشان، پس عوض کردنِ نامشان هیچ‌چیز را نمی‌شکند.</i>",
  ].join("\n");
}

async function groupKeyboard(env, g, page) {
  const pages = Math.max(1, Math.ceil(g.items.length / PAGE_SIZE));
  const current = Math.min(Math.max(Number(page) || 0, 0), pages - 1);
  const slice = g.items.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const rows = [];
  for (const [key] of slice) {
    const { label, custom } = await inlineState(env, key);
    rows.push([
      { text: (custom ? "✏️ " : "") + label, callback_data: `BTNED|${key}|${current}` },
    ]);
  }
  if (pages > 1) {
    rows.push([
      current > 0
        ? { text: "◀️ قبلی", callback_data: `BTNGRP|${g.id}|${current - 1}` }
        : { text: "·", callback_data: "NOOP" },
      { text: `${fa(current + 1)} از ${fa(pages)}`, callback_data: "NOOP" },
      current < pages - 1
        ? { text: "بعدی ▶️", callback_data: `BTNGRP|${g.id}|${current + 1}` }
        : { text: "·", callback_data: "NOOP" },
    ]);
  }
  rows.push([{ text: "◀️ بازگشت", callback_data: "BTNROOT" }]);
  return { inline_keyboard: rows };
}

export async function showLabelGroup(ctx, id, page) {
  if (!(await requireOwner(ctx))) return;
  const g = findGroup(id);
  if (!g) return;
  await ctx.answerCallbackQuery();
  await ctx
    .editMessageText(groupText(g), {
      parse_mode: "HTML",
      reply_markup: await groupKeyboard(ctx.env, g, page),
    })
    .catch((err) => console.error("دسته‌ی نام دکمه‌ها:", err && err.message));
}

async function panelFor(env, key, page) {
  const b = findButton(key);
  // دکمه‌های زیرمجموعه فهرستِ «نام‌های قبلی» ندارند و لازم هم ندارند:
  // با شناسه‌ی داخلی مسیریابی می‌شوند، نه با متن.
  const { label, def, custom, past } = b.inline
    ? { ...(await inlineState(env, key)), past: [] }
    : await labelState(env, key);

  const lines = [
    "🔤 <b>" + escapeHtml(label) + "</b>",
    "",
    "پشتِ این دکمه: " + escapeHtml(b.hint),
    "وضعیت: " + (custom ? "✏️ نامش عوض شده" : "نامِ پیش‌فرض"),
  ];
  if (custom) lines.push("نامِ پیش‌فرض: " + escapeHtml(def));
  if (past.length) {
    // مدیر باید ببیند چه نام‌هایی هنوز زنده‌اند، وگرنه این رفتار جادو
    // به نظر می‌رسد - «چرا اسم قدیمی هنوز کار می‌کند؟».
    lines.push(
      "",
      "نام‌های قبلی که هنوز کار می‌کنند:",
      ...past.map((p) => "• " + escapeHtml(p))
    );
  }

  const rows = [[{ text: "✏️ تغییر نام", callback_data: `BTNTXT|${key}|${page}` }]];
  if (custom) {
    rows.push([{ text: "♻️ بازگشت به نام پیش‌فرض", callback_data: `BTNRESET|${key}|${page}` }]);
  }
  rows.push([
    {
      text: "◀️ بازگشت به فهرست",
      callback_data: b.group ? `BTNGRP|${b.group}|${page}` : `BTNLIST|${page}`,
    },
  ]);

  return { text: lines.join("\n"), reply_markup: { inline_keyboard: rows } };
}

export async function openLabelPanel(ctx, key, page) {
  if (!(await requireOwner(ctx))) return;
  if (!findButton(key)) return;
  const panel = await panelFor(ctx.env, key, page);
  await ctx.answerCallbackQuery();
  await ctx
    .editMessageText(panel.text, { parse_mode: "HTML", reply_markup: panel.reply_markup })
    .catch((err) => console.error("صفحه‌ی نام دکمه:", err && err.message));
}

async function refreshPanel(ctx, key, page, send) {
  const panel = await panelFor(ctx.env, key, page);
  await send(panel.text, { parse_mode: "HTML", reply_markup: panel.reply_markup }).catch((err) =>
    console.error("به‌روزرسانی صفحه‌ی نام دکمه:", err && err.message)
  );
}

const CANCEL_KEYBOARD = {
  inline_keyboard: [[{ text: "انصراف", callback_data: "BTNCANCEL" }]],
};

export async function startLabelEdit(ctx, key, page) {
  if (!(await requireOwner(ctx))) return;
  if (!findButton(key)) return;

  await setUserState(ctx.env, ctx.from.id, {
    current_flow: "label_edit",
    current_step: "ask_label",
    temp_data: { key, page: Number(page) || 0 },
  });
  await ctx.answerCallbackQuery();
  await ctx.reply(
    [
      "✏️ نامِ تازه‌ی این دکمه را بنویسید.",
      "",
      "یک خط، حداکثر " + fa(LABEL_MAX) + " کاراکتر. ایموجی هم می‌توانید بگذارید.",
      "",
      "بعد از ذخیره، کاربرها تا وقتی /start نزنند هنوز نامِ قبلی را می‌بینند — ولی دکمه‌شان کار می‌کند.",
    ].join("\n"),
    { reply_markup: CANCEL_KEYBOARD }
  );
}

export async function cancelLabelEdit(ctx) {
  await clearUserState(ctx.env, ctx.from.id);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("انصراف داده شد؛ چیزی عوض نشد.").catch(() => {});
}

export async function resetLabelToDefault(ctx, key, page) {
  if (!(await requireOwner(ctx))) return;
  if (!findButton(key)) return;
  await resetLabel(ctx.env, key);
  await ctx.answerCallbackQuery({ text: "به نام پیش‌فرض برگشت" });
  await refreshPanel(ctx, key, page, (t, o) => ctx.editMessageText(t, o));
}

// ─── پیامی که مدیر بعد از زدن «تغییر نام» می‌فرستد ─────────────────

export async function handleLabelText(ctx, state) {
  if (!isOwner(ctx)) return;
  const data = (state && state.temp_data) || {};
  const key = data.key;

  if (!findButton(key)) {
    await clearUserState(ctx.env, ctx.from.id);
    await ctx.reply("⚠️ این ویرایش دیگر معتبر نیست. دوباره /labels بزنید.");
    return;
  }

  // چند خطی بودن اینجا خطاست نه سلیقه: متنِ دکمه‌ی تلگرام یک خط است و
  // خطِ دوم بی‌صدا از قلم می‌افتد - یعنی نامی ذخیره می‌شود که با آنچه
  // کاربر می‌فرستد یکی نیست، و دکمه از کار می‌افتد.
  const raw = String(ctx.message.text || "");
  const label = raw.replace(/\s+/g, " ").trim();

  if (!label) {
    await ctx.reply("⚠️ نام خالی بود. یک نام بنویسید یا انصراف بزنید.");
    return;
  }
  if (label.length > LABEL_MAX) {
    await ctx.reply(
      "⚠️ نام طولانی است (" + fa(label.length) + " کاراکتر). حداکثر " + fa(LABEL_MAX) + " کاراکتر."
    );
    return;
  }
  // تعارضِ نام فقط برای دکمه‌های منوی اصلی معنی دارد: آن‌ها از روی متن
  // مسیریابی می‌شوند. دکمه‌های زیرمجموعه شناسه‌ی خودشان را دارند و
  // هم‌نام بودنشان هیچ ابهامی نمی‌سازد.
  const clash = findButton(key).inline ? null : await conflictingKey(ctx.env, key, label);
  if (clash) {
    const other = findButton(clash);
    await ctx.reply(
      "⚠️ این نام برای دکمه‌ی دیگری است" +
        (other ? " («" + other.hint + "»)" : "") +
        ".\n\nدو دکمه‌ی هم‌نام از هم قابلِ تشخیص نیستند. یک نام دیگر بنویسید."
    );
    return;
  }

  await clearUserState(ctx.env, ctx.from.id);
  await setLabel(ctx.env, key, label);
  await ctx.reply("✅ نامِ دکمه عوض شد. برای دیدنش /start بزنید.");
  await refreshPanel(ctx, key, data.page, (t, o) => ctx.reply(t, o));
}
