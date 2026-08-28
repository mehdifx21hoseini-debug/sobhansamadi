import { logContentRequest, setUserState, clearUserState } from "./db.js";
import {
  listContentByPrefix,
  updateContentTitle,
  updateContentFile,
  deactivateContent,
} from "./content/store.js";
import { PSY_VOICE_PREFIX, LIVE_TRADE_PREFIX, extractFile } from "./content/ingest.js";
import { isOwner } from "./owner.js";

export { sendEconMenu as sendEconCalendar, handleEconCallback } from "./econ/index.js";

// بخش‌هایی که کد ثابت ندارند: هر پست کانال یک مدخل تازه با پیشوند خودش
// می‌سازد و تعدادشان از پیش معلوم نیست.
//
// تا وقتی هیچ فایلی نرسیده، درخواست کاربر در جدول content_requests ثبت
// می‌شود؛ این‌طور آکادمی در CRM می‌بیند چند نفر منتظر کدام بخش‌اند. با
// رسیدن اولین فایل، بخش خودبه‌خود از این حالت بیرون می‌آید.
const PENDING_SECTIONS = {
  PSY_VOICES: {
    id: "PSY_VOICES",
    title: "🎧 ویس‌های روانشناسی",
    body: "این بخش هنوز در حال آماده‌سازیه.",
    prefix: PSY_VOICE_PREFIX,
    mode: "list",
    unit: "ویس",
    intro: "تازه‌ترین ویس‌ها بالا هستند. روی هرکدام بزنید تا همان یکی برایتان بیاید:",
  },
  LIVE_TRADE: {
    id: "LIVE_TRADE",
    title: "📈 ویدیوهای لایو ترید",
    body: "ویدیوهای لایو معاملات هنوز در حال آماده‌سازیه.",
    prefix: LIVE_TRADE_PREFIX,
    mode: "list",
    unit: "ویدیو",
    intro: "تازه‌ترین ویدیوها بالا هستند. روی هرکدام بزنید تا همان یکی برایتان بیاید:",
  },
};

// چند مورد در هر صفحه. هشت‌تا انتخاب شد چون هر دکمه یک ردیف کامل است
// (عنوان‌ها بلندند) و بیشتر از این، فهرست از ارتفاع صفحه‌ی موبایل
// بیرون می‌زند و خودش می‌شود همان شلوغی‌ای که قرار بود حل کند.
const PAGE_SIZE = 8;

// تازه‌ترین، بالا.
//
// مرتب‌سازی روی updated_at است نه content_id: شناسه‌ها دو نسل دارند
// (قدیم با timestamp، تازه با message_id) و مقایسه‌ی متنیِ این دو،
// ویس‌های قدیمی را به بالای فهرست می‌فرستاد. content_id فقط برای
// شکستن تساوی می‌ماند تا ترتیب بین دو رکورد هم‌زمان، پایدار بماند.
function newestFirst(items) {
  return items.slice().sort((a, b) => {
    const ta = String(a.updated_at || "");
    const tb = String(b.updated_at || "");
    if (ta !== tb) return ta < tb ? 1 : -1;
    return String(a.content_id) < String(b.content_id) ? 1 : -1;
  });
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
function fa(n) {
  return String(n).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

// فقط خط اولِ کپشن روی دکمه می‌نشیند.
//
// کپشن یک ویس معمولاً یک عنوان کوتاه دارد و زیرش چند خط توضیح؛ ریختن
// همه‌ی آن در متن دکمه، دکمه را در موبایل بدقواره می‌کند. متن کامل از
// بین نمی‌رود - موقع ارسال، زیر خود فایل می‌آید.
function buttonLabel(index, title) {
  const firstLine =
    String(title || "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) || "بدون عنوان";
  const short = firstLine.length > 34 ? firstLine.slice(0, 33).trim() + "…" : firstLine;
  return fa(index) + ". " + short;
}

function clampPage(page, count) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  return { pages, current: Math.min(Math.max(Number(page) || 0, 0), pages - 1) };
}

// همان فهرست، با دو دکمه‌ی بیشتر در هر ردیف - ولی فقط برای مدیر.
//
// چرا داخل خود فهرست و نه یک پنل جدا: مدیر همان چیزی را می‌بیند که
// کاربر می‌بیند، و همان‌جا اصلاحش می‌کند. یک پنل جدا یعنی دو نمای
// متفاوت از یک داده که باید هم‌زمان درست بمانند.
//
// دکمه‌ها ساخته نمی‌شوند مگر admin درست باشد؛ کاربر عادی حتی وجودشان
// را نمی‌بیند. هر دو کنترل‌کننده هم جداگانه مدیر بودن را چک می‌کنند،
// چون یک پیام قدیمیِ مدیر می‌تواند به دست کس دیگری فوروارد شود.
function buildListKeyboard(section, items, page, admin = false) {
  const { pages, current } = clampPage(page, items.length);
  const start = current * PAGE_SIZE;
  const slice = items.slice(start, start + PAGE_SIZE);

  const rows = slice.map((item, i) => {
    const main = {
      text: buttonLabel(start + i + 1, item.title),
      callback_data: "CONTENT|" + item.content_id,
      style: "primary",
    };
    if (!admin) return [main];
    // فقط یک دکمه‌ی مدیریت، نه سه‌تا کنار هم.
    //
    // نسخه‌ی اول ✏️ و 🗑 را مستقیم در ردیف گذاشته بود؛ با اضافه شدن
    // «جای‌گزینی فایل» می‌شد چهار دکمه در یک ردیف، که هم دکمه‌ی عنوان
    // را باریک می‌کرد هم ضربه‌ی اشتباه را زیاد. حالا ⚙️ یک صفحه‌ی
    // مدیریت برای همان مورد باز می‌کند که هرچقدر لازم شد جا دارد.
    return [main, { text: "⚙️", callback_data: `ITEM|${item.content_id}|${current}` }];
  });

  // ردیف صفحه‌بندی فقط وقتی می‌آید که واقعاً بیش از یک صفحه باشد.
  if (pages > 1) {
    const nav = [];
    // در راست‌به‌راست، دکمه‌ی اولِ ردیف سمت راست می‌نشیند؛ «قبلی» باید
    // سمت راست باشد تا جهت حرکت با جهت خواندن یکی باشد.
    nav.push(
      current > 0
        ? { text: "◀️ قبلی", callback_data: `LIST|${section.id}|${current - 1}` }
        : { text: "·", callback_data: "NOOP" }
    );
    nav.push({ text: `${fa(current + 1)} از ${fa(pages)}`, callback_data: "NOOP" });
    nav.push(
      current < pages - 1
        ? { text: "بعدی ▶️", callback_data: `LIST|${section.id}|${current + 1}` }
        : { text: "·", callback_data: "NOOP" }
    );
    rows.push(nav);
  }

  return { inline_keyboard: rows };
}

function listText(section, count, admin = false) {
  return [
    section.title,
    "",
    `${fa(count)} ${section.unit} موجود است.`,
    "",
    admin
      ? "حالت مدیر: ⚙️ کنار هر مورد، صفحه‌ی مدیریت همان مورد را باز می‌کند. این دکمه را فقط شما می‌بینید."
      : section.intro,
  ].join("\n");
}

async function loadItems(ctx, section) {
  const items = await listContentByPrefix(ctx.env, section.prefix).catch(() => []);
  return newestFirst(items);
}

export async function sendPendingSection(ctx, key) {
  const section = PENDING_SECTIONS[key];
  if (!section) return;

  const items = section.prefix ? await loadItems(ctx, section) : [];

  if (items.length > 0) {
    const admin = isOwner(ctx);
    await ctx.reply(listText(section, items.length, admin), {
      reply_markup: buildListKeyboard(section, items, 0, admin),
    });
    return;
  }

  // اگر ثبت درخواست به هر دلیلی شکست بخورد، کاربر نباید پیام خطا ببیند —
  // برای او فرقی ندارد و پیام اصلی باید در هر حالت برسد.
  await logContentRequest(ctx.env, ctx.from.id, ctx.from.username, section.id).catch(() => {});

  await ctx.reply(
    `${section.title}\n\n${section.body}\n\n` +
      "✅ درخواست شما ثبت شد؛ به‌محض آماده شدن، همین‌جا براتون می‌فرستیم. 🙏"
  );
}

// ورق زدن فهرست. همان پیام ویرایش می‌شود نه پیام تازه، وگرنه چت از
// نسخه‌های تکراری یک فهرست پر می‌شود.
export async function handleSectionListPage(ctx, key, page) {
  const section = PENDING_SECTIONS[key];
  if (!section || section.mode !== "list") return;

  const items = await loadItems(ctx, section);
  if (items.length === 0) return;

  const admin = isOwner(ctx);
  await ctx
    .editMessageText(listText(section, items.length, admin), {
      reply_markup: buildListKeyboard(section, items, page, admin),
    })
    // اگر کاربر روی همان صفحه دوباره بزند تلگرام «message is not modified»
    // می‌دهد؛ این خطا نیست و نباید به کاربر برسد.
    .catch((err) => console.error("ورق زدن فهرست:", key, err && err.message));
}

// ─── کنترل‌های مدیر ───────────────────────────────────────────────

// اگر یک پیامِ حالت مدیر فوروارد شود، دکمه‌هایش برای دیگران هم قابل
// زدن است. کاری نمی‌کنند - ولی بی‌جواب هم نمی‌مانند: بدون answer،
// ساعت شنی روی دکمه تا تایم‌اوت می‌چرخد و به نظر می‌رسد ربات هنگ کرده.
async function requireOwner(ctx) {
  if (isOwner(ctx)) return true;
  await ctx.answerCallbackQuery().catch(() => {});
  return false;
}

// شناسه‌ی هر مدخل با پیشوندش می‌گوید مال کدام بخش است، پس لازم نیست
// نام بخش هم در callback_data تکرار شود - و آنجا فقط ۶۴ بایت جا هست.
function sectionForContentId(contentId) {
  return Object.values(PENDING_SECTIONS).find(
    (s) => s.prefix && String(contentId).startsWith(s.prefix)
  );
}

// صفحه‌ی مدیریت یک مورد.
//
// همه‌ی کارهای مدیر روی یک مدخل از اینجا شروع می‌شود. جای اضافه کردن
// کار بعدی هم همین‌جاست، بدون اینکه ردیف فهرست شلوغ‌تر شود.
const FILE_TYPE_LABEL = {
  voice: "ویس",
  audio: "صوت",
  video: "ویدیو",
  document: "فایل",
  photo: "عکس",
};

async function findItem(ctx, contentId) {
  const section = sectionForContentId(contentId);
  if (!section) return {};
  const items = await loadItems(ctx, section);
  const index = items.findIndex((i) => i.content_id === contentId);
  return { section, items, item: index === -1 ? null : items[index], index };
}

function itemPanel(item, index, contentId, page, section) {
  const text = [
    "⚙️ مدیریت مورد " + fa(index + 1),
    "",
    "عنوان:",
    item.title ? item.title : "(بدون عنوان)",
    "",
    "نوع: " + (FILE_TYPE_LABEL[item.file_type] || item.file_type || "?"),
    "شناسه: " + contentId,
  ].join("\n");

  return {
    text,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✏️ عنوان", callback_data: `RENAME|${contentId}|${page}` },
          { text: "📎 جای‌گزینی فایل", callback_data: `REFILE|${contentId}|${page}` },
        ],
        [
          { text: "👁 دیدن خود فایل", callback_data: `CONTENT|${contentId}` },
          { text: "🗑 حذف", callback_data: `DEL|${contentId}|${page}`, style: "danger" },
        ],
        [{ text: "◀️ بازگشت به فهرست", callback_data: `LIST|${section.id}|${page}` }],
      ],
    },
  };
}

export async function openItemPanel(ctx, contentId, page) {
  if (!(await requireOwner(ctx))) return;
  const { section, item, index } = await findItem(ctx, contentId);
  if (!section) return;
  if (!item) {
    await ctx.answerCallbackQuery({ text: "این مورد دیگر وجود ندارد.", show_alert: true });
    return;
  }

  const panel = itemPanel(item, index, contentId, page, section);
  await ctx.answerCallbackQuery();
  await ctx
    .editMessageText(panel.text, { reply_markup: panel.reply_markup })
    .catch((err) => console.error("صفحه‌ی مدیریت:", err && err.message));
}

// تایید لازم است چون حذف از دید کاربران فوری است و راه برگشتش - پست
// دوباره‌ی فایل در کانال - چند دقیقه کار می‌برد.
export async function confirmContentDelete(ctx, contentId, page) {
  if (!(await requireOwner(ctx))) return;
  const { section, item, index } = await findItem(ctx, contentId);
  if (!section) return;
  if (!item) {
    await ctx.answerCallbackQuery({ text: "این مورد دیگر وجود ندارد.", show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx
    .editMessageText(
      [
        "🗑 حذف شود؟",
        "",
        buttonLabel(index + 1, item.title),
        "",
        "از دید کاربران برداشته می‌شود. فایل پاک نمی‌شود و با پست دوباره‌ی همان فایل در کانال برمی‌گردد.",
      ].join("\n"),
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ بله، حذف کن", callback_data: `DELOK|${contentId}|${page}`, style: "danger" },
              { text: "انصراف", callback_data: `ITEM|${contentId}|${page}` },
            ],
          ],
        },
      }
    )
    .catch((err) => console.error("تایید حذف:", err && err.message));
}

export async function applyContentDelete(ctx, contentId, page) {
  if (!(await requireOwner(ctx))) return;
  const section = sectionForContentId(contentId);
  if (!section) return;

  const removed = await deactivateContent(ctx.env, contentId);
  await ctx.answerCallbackQuery({ text: removed > 0 ? "حذف شد" : "چیزی پیدا نشد" });

  // برگشت به همان فهرست، تا مدیر نتیجه‌ی کارش را ببیند نه یک پیام
  // مرده‌ی «حذف شد» که باید از آن راه برگشت پیدا کند.
  await renderList(ctx, section, page, (t, o) => ctx.editMessageText(t, o));
}

async function renderList(ctx, section, page, send) {
  const items = await loadItems(ctx, section);
  if (items.length === 0) {
    await send(`${section.title}\n\nدیگر موردی باقی نمانده.`, {}).catch(() => {});
    return;
  }
  const { current } = clampPage(page, items.length);
  await send(listText(section, items.length, true), {
    reply_markup: buildListKeyboard(section, items, current, true),
  }).catch((err) => console.error("نمایش دوباره‌ی فهرست:", err && err.message));
}

// ─── ویرایش عنوان و جای‌گزینی فایل ────────────────────────────────
//
// هر دو یک شکل‌اند: مدیر دکمه را می‌زند، ربات منتظر پیام بعدی‌اش
// می‌ماند، و همان پیام کار را تمام می‌کند. شناسه در temp_data می‌نشیند
// نه در متن پیام، چون متن پیام همان چیزی است که مدیر می‌نویسد.
const EDIT_PROMPTS = {
  ask_title: {
    prompt: (item) =>
      [
        "✏️ عنوان تازه را بنویسید:",
        "",
        "عنوان فعلی:",
        item.title ? item.title : "(بدون عنوان)",
        "",
        "خط اول روی دکمه می‌نشیند و خط‌های بعدی زیر خود فایل می‌آید.",
      ].join("\n"),
  },
  ask_file: {
    prompt: () =>
      [
        "📎 فایل تازه را همین‌جا بفرستید:",
        "",
        "عنوان و جایگاه این مورد در فهرست دست‌نخورده می‌ماند؛ فقط خود فایل عوض می‌شود.",
        "",
        "ویس، صوت، ویدیو، فایل یا عکس - هر کدام که باشد پذیرفته می‌شود.",
      ].join("\n"),
  },
};

async function startItemEdit(ctx, contentId, page, step) {
  if (!(await requireOwner(ctx))) return;
  const { section, item } = await findItem(ctx, contentId);
  if (!section) return;
  if (!item) {
    await ctx.answerCallbackQuery({ text: "این مورد دیگر وجود ندارد.", show_alert: true });
    return;
  }

  await setUserState(ctx.env, ctx.from.id, {
    current_flow: "content_edit",
    current_step: step,
    temp_data: { content_id: contentId, section: section.id, page: Number(page) || 0 },
  });

  await ctx.answerCallbackQuery();
  await ctx.reply(EDIT_PROMPTS[step].prompt(item), {
    reply_markup: {
      inline_keyboard: [[{ text: "انصراف", callback_data: "EDIT_CANCEL" }]],
    },
  });
}

export const startContentRename = (ctx, contentId, page) =>
  startItemEdit(ctx, contentId, page, "ask_title");

export const startContentRefile = (ctx, contentId, page) =>
  startItemEdit(ctx, contentId, page, "ask_file");

export async function cancelContentEdit(ctx) {
  await clearUserState(ctx.env, ctx.from.id);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("انصراف داده شد؛ چیزی عوض نشد.").catch(() => {});
}

// بعد از هر ویرایش، فهرست تازه فرستاده می‌شود نه ویرایش‌شده: پیام
// فهرست چند پیام بالاتر مانده و مدیر باید نتیجه را همین پایین ببیند.
async function finishEdit(ctx, section, page, note) {
  await ctx.reply(note);
  await renderList(ctx, section, page, (t, o) => ctx.reply(t, o));
}

// متنی که مدیر بعد از زدن «✏️ عنوان» می‌نویسد.
export async function handleContentRenameText(ctx, state) {
  if (!isOwner(ctx)) return;

  const data = state?.temp_data || {};
  const section = PENDING_SECTIONS[data.section];
  const title = String(ctx.message.text || "").trim();
  await clearUserState(ctx.env, ctx.from.id);

  if (!data.content_id || !section) {
    await ctx.reply("⚠️ این ویرایش دیگر معتبر نیست. دوباره از فهرست ⚙️ را بزنید.");
    return;
  }

  const changed = await updateContentTitle(ctx.env, data.content_id, title);
  if (changed === 0) {
    await ctx.reply("⚠️ این مورد پیدا نشد؛ شاید بین این دو مرحله حذف شده باشد.");
    return;
  }

  await finishEdit(ctx, section, data.page, "✅ عنوان عوض شد.");
}

// فایلی که مدیر بعد از زدن «📎 جای‌گزینی فایل» می‌فرستد.
export async function handleContentRefile(ctx, state) {
  if (!isOwner(ctx)) return;

  const data = state?.temp_data || {};
  const section = PENDING_SECTIONS[data.section];
  // همان تابعی که پست‌های کانال را می‌خواند؛ ساختار پیام یکی است.
  const { fileId, fileType } = extractFile(ctx.message);

  if (!fileId) {
    // حالت فعال باقی می‌ماند: مدیر همین حالا می‌تواند فایل درست را
    // بفرستد، بدون اینکه دوباره از فهرست شروع کند.
    await ctx.reply("⚠️ در این پیام فایلی نبود. یک ویس، ویدیو، فایل یا عکس بفرستید.");
    return;
  }

  await clearUserState(ctx.env, ctx.from.id);

  if (!data.content_id || !section) {
    await ctx.reply("⚠️ این ویرایش دیگر معتبر نیست. دوباره از فهرست ⚙️ را بزنید.");
    return;
  }

  const changed = await updateContentFile(ctx.env, data.content_id, fileId, fileType);
  if (changed === 0) {
    await ctx.reply("⚠️ این مورد پیدا نشد؛ شاید بین این دو مرحله حذف شده باشد.");
    return;
  }

  await finishEdit(ctx, section, data.page, "✅ فایل جای‌گزین شد.");
}
