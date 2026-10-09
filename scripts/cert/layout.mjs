// چیدمانِ خطِ «برچسب + نام» - خالص و بی‌وابستگی، تا بشود تستش کرد.
//
// ورودی اندازه‌ی جوهرِ هر متن در اندازه‌ی مرجعِ ۱۰۰ پیکسل است. عرض با اندازه
// خطی بالا می‌رود، پس برای کوچک کردنِ نام نیازی به اندازه‌گیریِ دوباره نیست.
//
// خط راست‌به‌چپ است: برچسب سمتِ راست، نام سمتِ چپ. وسطِ کلِ خط (جوهر تا جوهر)
// روی centerX می‌نشیند - همان چیزی که در نمونه‌ی Photoshop دیده می‌شود.

export const REF = 100;

const inkW = (m) => m.abl + m.abr;

/**
 * @param {{abl:number, abr:number}} labelRef  جوهرِ برچسب در اندازه‌ی ۱۰۰
 * @param {{abl:number, abr:number}} nameRef   جوهرِ نام در اندازه‌ی ۱۰۰
 * @param {object} layout  layout.json
 * @returns {{nameScale:number, nameSize:number, labelSize:number, fit:"ok"|"shrunk"|"overflow",
 *            totalWidth:number, label:{inkLeft:number,width:number}, name:{inkLeft:number,width:number}}}
 */
export function planLine(labelRef, nameRef, layout) {
  const L = layout.label, N = layout.name, F = layout.fit;
  const labelW = (inkW(labelRef) * L.sizePx) / REF * L.squeeze;
  const nameWAt = (scale) => (inkW(nameRef) * N.sizePx * scale) / REF * N.squeeze;

  let scale = 1;
  while (labelW + layout.gapPx + nameWAt(scale) > F.maxWidthPx && scale - F.step >= F.minScale - 1e-9) {
    scale = Math.round((scale - F.step) * 1000) / 1000;
  }
  const nameW = nameWAt(scale);
  const total = labelW + layout.gapPx + nameW;
  const left = layout.centerX - total / 2;

  return {
    nameScale: scale,
    nameSize: N.sizePx * scale,
    labelSize: L.sizePx,
    // fit: ok = جا شد؛ shrunk = با کوچک شدن جا شد؛ overflow = حتی کوچک‌ترین
    // اندازه هم جا نشد (عکس ساخته می‌شود ولی مدیر باید خبردار شود).
    fit: total > F.maxWidthPx + 0.5 ? "overflow" : scale < 1 ? "shrunk" : "ok",
    totalWidth: total,
    name: { inkLeft: left, width: nameW },
    label: { inkLeft: left + nameW + layout.gapPx, width: labelW },
  };
}
