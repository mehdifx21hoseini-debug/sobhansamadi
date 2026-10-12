// /phones - خروجیِ اکسلِ همه‌ی شماره‌های ثبت‌شده، داخلِ خودِ تلگرام.
//
// فقط مدیرِ اصلی: isOwner، نه isCertAdmin. شماره‌ی موبایل مشتری‌ها
// اطلاعاتِ شخصی است و «فقط گواهی» عمداً به آن راه ندارد. برای بقیه فرمان
// اصلاً وجود ندارد (جوابی نمی‌دهد).
//
// فایل مستقیم از D1 ساخته و فقط به گفتگوی خودِ همان مدیر فرستاده می‌شود؛
// هیچ‌جا ذخیره نمی‌شود و شماره‌ای در لاگ نمی‌آید.

import { InputFile } from "grammy";
import { isOwner } from "../owner.js";
import { listAllPhones } from "../phones.js";
import { buildXlsx } from "../xlsx.js";

const HEADERS = ["شناسه تلگرام", "شماره موبایل", "نام", "نام کاربری", "منبع", "دوره‌ها", "نوع درخواست", "تاریخ ثبت", "آخرین به‌روزرسانی"];
const WIDTHS = [16, 16, 24, 20, 28, 28, 20, 22, 22];

// تاریخ ISO را خوانا می‌کند: «2026-10-09T13:00:49.398Z» → «2026-10-09 13:00»
// (UTC؛ همان که CSVِ CRM هم دارد).
function when(iso) {
  return String(iso || "").replace("T", " ").slice(0, 16);
}

export function phoneRows(list) {
  return list.map((r) => [
    r.telegram_user_id,
    r.phone,
    r.name || "",
    r.username ? "@" + r.username : "",
    (r.sources || []).join(" / "),
    (r.courses || []).join(" / "),
    (r.request_types || []).join(" / "),
    when(r.created_at),
    when(r.updated_at),
  ]);
}

export async function handlePhones(ctx) {
  if (!isOwner(ctx)) return;

  let list;
  try {
    // از ابتدای ربات تا امروز: سقفِ ۵هزارتاییِ پنل اینجا نیست.
    list = await listAllPhones(ctx.env);
  } catch (err) {
    console.error("خروجی شماره‌ها شکست خورد:", err && err.message);
    await ctx.reply("❌ خواندنِ شماره‌ها ممکن نشد. چند لحظه‌ی دیگر دوباره بزنید.");
    return;
  }
  if (list.length === 0) {
    await ctx.reply("هنوز شماره‌ای ثبت نشده است.");
    return;
  }

  const bytes = buildXlsx({ sheetName: "شماره‌ها", headers: HEADERS, rows: phoneRows(list), widths: WIDTHS });
  const today = new Date().toISOString().slice(0, 10);
  await ctx.replyWithDocument(new InputFile(bytes, "phones-" + today + ".xlsx"), {
    caption: "📱 " + list.length + " شماره‌ی ثبت‌شده، از ابتدای ربات تا همین لحظه.\nاین فایل اطلاعاتِ شخصی است؛ آن را فوروارد یا منتشر نکنید.",
  });
}
