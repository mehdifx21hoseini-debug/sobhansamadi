// جدول econ_event_labels نام کوتاه انگلیسی، ترجمه‌ی فارسی و جهت اثر هر
// شاخص روی دلار را نگه می‌دارد. نماهای Rich (امروز/هفته) بدون آن ناقص
// می‌شوند: نام‌ها خام و طولانی می‌مانند و «خوانش برای دلار» اصلاً ساخته
// نمی‌شود. عیناً از نودهای Build Today Text / Build Week Text.

// اولین عدد داخل یک مقدار منتشرشده را بیرون می‌کشد. «۲۲۵K»، «0.3%» و
// «1,250» همه عدد دارند ولی هیچ‌کدام Number() را راضی نمی‌کنند.
export function numOf(v) {
  const m = String(v == null ? "" : v).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

export function makeLabelHelpers(labels) {
  const EVENT_LABELS = (labels || [])
    .filter((r) => r && r.active !== false && r.match_text)
    .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));

  function labelFor(e) {
    const hay = (String(e.event || "") + " " + String(e.event_fa || "")).toLowerCase();
    for (const l of EVENT_LABELS) {
      if (hay.indexOf(String(l.match_text).toLowerCase()) !== -1) return l;
    }
    return null;
  }

  // نام انگلیسی خط رویداد: اول بازنویسی خودِ برچسب، بعد عنوان منبع با
  // کوتاه‌نویسی‌های استاندارد معامله‌گرها.
  const AB = [
    [/\bPrice Index\b/g, "PI"],
    [/\bIndex\b/g, "Idx"],
    [/\bUnemployment\b/g, "Unemp."],
    [/\bEmployment\b/g, "Empl."],
    [/\bConsumer\b/g, "Cons."],
    [/\bConfidence\b/g, "Conf."],
    [/\bSentiment\b/g, "Sent."],
    [/\bPreliminary\b|\bPrelim\b/g, "Prel."],
    [/\bManufacturing\b/g, "Mfg"],
    [/\bIndustrial\b/g, "Ind."],
    [/\bProduction\b/g, "Prod."],
    [/\bInventories\b/g, "Inv."],
    [/\bSpeaks\b/g, ""],
    [/\bChairman\b/g, "Chair"],
    [/\bFederal\b/g, "Fed"],
    [/\bBuilding Permits\b/g, "Permits"],
    [/\bAverage\b/g, "Avg"],
  ];

  function enShort(e) {
    const hit = labelFor(e);
    if (hit && hit.label_short_en) {
      const o = String(hit.label_short_en).trim();
      return o.length > 40 ? o.slice(0, 39) + "…" : o;
    }
    let s = String(e.event || "").split(" - ")[0].trim();
    if (!s) {
      const f = String(e.event_fa || "").split(" - ")[0].trim();
      return f.length > 14 ? f.slice(0, 13) + "…" : f;
    }
    for (const [re, rep] of AB) s = s.replace(re, rep);
    s = s.replace(/\s{2,}/g, " ").trim();
    return s.length > 40 ? s.slice(0, 39) + "…" : s;
  }

  function enFull(e) {
    return String(e.event || "").split(" - ")[0].trim();
  }

  function faName(e) {
    const hit = labelFor(e);
    if (hit && hit.label_fa) return hit.label_fa;
    return String(e.event_fa || e.event || "").split(" - ")[0].trim();
  }

  // عدد منتشرشده را با پیش‌بینی می‌سنجد و می‌گوید معمولاً برای دلار چه
  // معنایی دارد. direction روی ردیف برچسب یا 'normal' است (عدد بالاتر به
  // نفع دلار) یا 'inverse'؛ خالی یعنی خوانشی وجود ندارد.
  function usdRead(e) {
    const hit = labelFor(e);
    if (!hit || !hit.direction) return null;
    const a = numOf(e.actual);
    const f = numOf(e.forecast);
    if (a === null || f === null || a === f) return null;
    const higher = a > f;
    const good = hit.direction === "inverse" ? !higher : higher;
    return {
      arrow: higher ? "▲" : "▼",
      word: higher ? "بالاتر از انتظار" : "پایین‌تر از انتظار",
      verdict: good ? "معمولاً مثبت برای دلار" : "معمولاً منفی برای دلار",
      icon: good ? "🟢" : "🔴",
    };
  }

  return { labelFor, enShort, enFull, faName, usdRead };
}

// هر جایی که داده‌ی خام رویداد داخل پیام می‌نشیند از این عبور می‌کند.
//
// نام رویدادها از اسکرپ ForexFactory می‌آید، یعنی متنی است که ما کنترلش
// نمی‌کنیم. پیام‌های Rich تقویم واقعاً HTML دارند (<details> و <b> را خودمان
// می‌سازیم)، پس یک نام رویداد که تصادفاً < یا > داشته باشد یا ساختار پیام را
// به‌هم می‌ریزد یا کل پیام را برای تلگرام نامعتبر می‌کند و آن نما اصلاً
// فرستاده نمی‌شود. تگ‌های خودمان بعد از این تابع اضافه می‌شوند، پس فقط
// داده امن‌سازی می‌شود نه ساختار.
//
// نسخه‌ی n8n این کار را نمی‌کرد؛ این تنها جای عمدی واگرایی است و در حالت
// عادی هیچ تفاوتی در خروجی ایجاد نمی‌کند.
export function mdCell(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|");
}

// نام بلند رویداد را داخل سلول جدول می‌شکند، به‌جای پهن کردن ستون یا
// بریدن با سه‌نقطه. <br> کار می‌کند چون این رندرر HTML خام داخل markdown
// را می‌پذیرد (بلوک‌های <details> همین را ثابت می‌کنند).
export function wrapName(s, maxLen) {
  if (!s) return s;
  const words = s.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
      continue;
    }
    if ((cur + " " + w).length <= maxLen) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  const out = [];
  for (const line of lines) {
    if (line.length <= maxLen) {
      out.push(line);
      continue;
    }
    for (let i = 0; i < line.length; i += maxLen) out.push(line.slice(i, i + maxLen));
  }
  return out.join("<br>");
}
