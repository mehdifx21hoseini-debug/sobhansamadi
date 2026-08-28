import { logContentRequest } from "./db.js";
import { listContentByPrefix } from "./content/store.js";
import { PSY_VOICE_PREFIX, LIVE_TRADE_PREFIX } from "./content/ingest.js";

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

// متن دکمه سقف دارد و عنوان بلند، دکمه را در موبایل چندخطی و بدقواره
// می‌کند. شماره همیشه می‌ماند؛ فقط دنباله‌ی عنوان کوتاه می‌شود.
function buttonLabel(index, title) {
  const clean = String(title || "").replace(/\s+/g, " ").trim() || "بدون عنوان";
  const short = clean.length > 34 ? clean.slice(0, 33).trim() + "…" : clean;
  return fa(index) + ". " + short;
}

function buildListKeyboard(section, items, page) {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const start = current * PAGE_SIZE;
  const slice = items.slice(start, start + PAGE_SIZE);

  const rows = slice.map((item, i) => [
    {
      text: buttonLabel(start + i + 1, item.title),
      callback_data: "CONTENT|" + item.content_id,
      style: "primary",
    },
  ]);

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

function listText(section, count) {
  return [
    section.title,
    "",
    `${fa(count)} ${section.unit} موجود است.`,
    "",
    section.intro,
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
    await ctx.reply(listText(section, items.length), {
      reply_markup: buildListKeyboard(section, items, 0),
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

  await ctx
    .editMessageText(listText(section, items.length), {
      reply_markup: buildListKeyboard(section, items, page),
    })
    // اگر کاربر روی همان صفحه دوباره بزند تلگرام «message is not modified»
    // می‌دهد؛ این خطا نیست و نباید به کاربر برسد.
    .catch((err) => console.error("ورق زدن فهرست:", key, err && err.message));
}
