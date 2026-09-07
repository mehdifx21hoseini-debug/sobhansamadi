// روشن کردنِ ورک‌فلوی گیت‌هاب از داخلِ ورکر.
//
// چرا لازم شد: زمان‌بندِ خودِ گیت‌هاب تضمینی نیست. سه روز پیاپی اندازه
// گرفتیم و هر بار حدود چهار ساعت دیر اجرا شد - خلاصه‌ای که باید ۷:۳۰
// می‌رفت، ظهر رسید. مستنداتِ گیت‌هاب هم همین را می‌گوید: اجرای
// زمان‌بندی‌شده در ساعات شلوغ به تعویق می‌افتد و برای مخزنِ عمومی
// اولویتِ پایین‌تری دارد.
//
// ولی اجرای دستی - همان workflow_dispatch - ظرف چند ثانیه شروع می‌شود.
// پس زمان‌بندی را از گیت‌هاب می‌گیریم و به کرانِ کلادفلر می‌دهیم که
// دقیق است، و گیت‌هاب فقط عضله‌ی کار می‌ماند.
//
// زمان‌بندِ خودِ گیت‌هاب هم سرِ جایش می‌ماند: تورِ ایمنیِ روزی که این
// درخواست شکست بخورد. اجرای تکراری بی‌ضرر است، چون دفترِ ارسال جلوی
// پیامِ دوباره را می‌گیرد و نشانگر هم کارِ تمام‌شده را ارزان رد می‌کند.

const API = "https://api.github.com";

/**
 * ورک‌فلو را همین حالا اجرا می‌کند.
 *
 * @returns {Promise<{ok: boolean, skipped?: string, status?: number}>}
 *   هرگز throw نمی‌کند: این یک بهبودِ زمان‌بندی است، نه مسیرِ اصلی. اگر
 *   شکست بخورد، زمان‌بندِ خودِ گیت‌هاب همان کار را دیرتر انجام می‌دهد.
 */
export async function dispatchWorkflow(env, workflowFile) {
  const token = env && env.GITHUB_DISPATCH_TOKEN;
  // نبودنِ توکن خطا نیست: تا وقتی گذاشته نشده، مسیرِ قدیمی کار می‌کند.
  if (!token) return { ok: false, skipped: "GITHUB_DISPATCH_TOKEN" };

  const repo = (env && env.GITHUB_REPO) || "";
  if (!repo.includes("/")) return { ok: false, skipped: "GITHUB_REPO" };

  const ref = (env && env.GITHUB_REF_NAME) || "main";
  const url = API + "/repos/" + repo + "/actions/workflows/" + workflowFile + "/dispatches";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        // گیت‌هاب بدونِ User-Agent درخواست را رد می‌کند.
        "User-Agent": "sobhansamadi-worker",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ ref }),
    });
    // پاسخِ موفق ۲۰۴ و بی‌بدنه است.
    if (res.status === 204) return { ok: true, status: 204 };
    // متنِ خطا عمداً خوانده نمی‌شود و لاگ نمی‌شود: ممکن است بخشی از
    // درخواست را بازتاب بدهد و این لاگ‌ها جای امنی برای توکن نیستند.
    return { ok: false, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: String((err && err.message) || err) };
  }
}
