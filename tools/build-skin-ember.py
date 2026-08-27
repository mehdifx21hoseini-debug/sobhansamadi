#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
سازنده‌ی پوسته‌ی «امبر» (زغالی + نارنجی) برای CRM.

چرا با اسکریپت و نه دستی: رنگ‌ها در app.css و nozha-main.css فقط از توکن‌ها
نمی‌آیند - ۳۶۸ رنگ ثابت در ۷۵۵ خط پخش شده‌اند. یک پوسته‌ی دستی حتماً چند
گوشه را جا می‌گذاشت و سرمه‌ای از لای طراحی نارنجی بیرون می‌زد. این اسکریپت
هر قاعده‌ای که رنگ دارد را برمی‌دارد، رنگ‌هایش را از یک نگاشتِ رنگ عبور
می‌دهد و همان قاعده را با پیشوند [data-skin="ember"] دوباره می‌نویسد. پس
پوشش کامل است و طراحی فعلی هم دست‌نخورده می‌ماند.

خروجی: assets/skin-ember.css
اجرا:   python3 tools/build-skin-ember.py
"""

import colorsys
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = ["assets/nozha-main.css", "assets/app.css"]
OUT = "assets/skin-ember.css"
SKIN = '[data-skin="ember"]'

# ---------------------------------------------------------------------------
# نگاشت رنگ
# ---------------------------------------------------------------------------
# رنگ‌های امروزِ CRM سه خانواده‌اند و هرکدام سرنوشت متفاوتی دارند:
#
#   سرمه‌ای/نیلی (h 190..265)  → سطح و خط و متن است، نه هویت. به خاکستری
#                                گرم تبدیل می‌شود: روشنی حفظ، اشباع نزدیک صفر.
#   فیروزه‌ای    (h 158..195)  → همان رنگ تعاملی است. به نارنجی می‌رود.
#   سبز (h 145..158)، زرد، قرمز → معنایی‌اند (موفق/هشدار/خطر) و باید بمانند،
#                                وگرنه «تماس گرفته شد» و «در ریسک» یک‌رنگ می‌شوند.
#
# مرز ۱۵۸ درجه حدس نیست: در هر دو شیت، سبزهای معنایی تا ۱۵۶٫۸ می‌روند و
# خانواده‌ی فیروزه‌ای/نعنایی از ۱۵۸٫۷ شروع می‌شود. مرز داخل همان شکاف است.
#
# طلاییِ قدیمی (h 30..45) هم به نارنجی می‌رود؛ اگر می‌ماند، کنار نارنجی جدید
# دو رنگ برندِ هم‌خانواده داشتیم که فقط گل‌آلود می‌کرد.

NEUTRAL_HUE = 30.0 / 360.0  # خاکستریِ کمی گرم، هم‌جهت با نارنجی
ACCENT_HUE = 25.5 / 360.0  # نارنجی ویوآی #F5822D
ACCENT_SAT = 0.82


def _clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def map_color(r, g, b):
    """(r,g,b) در بازه‌ی 0..1 → (r,g,b) پوسته‌ی امبر."""
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    deg = h * 360.0

    # خاکستریِ واقعی: فقط یک ذره گرم می‌شود تا «انتخاب‌شده» به نظر برسد،
    # نه خاکستریِ پیش‌فرضِ مرورگر.
    if s < 0.08:
        return colorsys.hsv_to_rgb(NEUTRAL_HUE, 0.035 if v < 0.98 else 0.02, v)

    # فیروزه‌ای و طلایی: رنگ تعاملی. به نارنجی.
    if 158 <= deg < 195 or 28 <= deg < 48:
        # نارنجیِ مرجع خیلی روشن‌تر از فیروزه‌ای فعلی است (v ۰٫۹۶ در برابر
        # ۰٫۵۶). اگر روشنی عیناً حفظ شود، فیروزه‌ایِ میان‌تن به قهوه‌ای گِلی
        # می‌افتد. پس فقط جایی که رنگ دارد «رنگ» می‌شود بالا کشیده می‌شود؛
        # تن‌های تیره که پس‌زمینه‌اند دست‌نخورده می‌مانند.
        nv = min(1.0, v * 1.35) if v >= 0.40 else v
        return colorsys.hsv_to_rgb(ACCENT_HUE, _clamp(s * 0.95, 0.30, ACCENT_SAT), nv)

    # سرمه‌ای/نیلی/بنفش: سطح و خط. اشباع تقریباً حذف می‌شود. سطح‌های روشن
    # باید خاکستریِ گرم بمانند نه کِرِم، پس هرچه روشن‌تر، اشباع کمتر.
    if 195 <= deg <= 275:
        cap = 0.03 if v > 0.90 else 0.10
        return colorsys.hsv_to_rgb(NEUTRAL_HUE, _clamp(s * 0.14, 0.015, cap), v)

    # قرمزها کمی سردتر می‌شوند. بدون این کار، قرمزِ h6 فقط ۱۹ درجه با نارنجیِ
    # h25 فاصله دارد و «در ریسک» با دکمه‌ی اصلی اشتباه گرفته می‌شود.
    if deg < 18:
        return colorsys.hsv_to_rgb(356.0 / 360.0, s, v)

    # سبز و زرد و صورتی: معنایی. دست‌نخورده.
    return (r, g, b)


# ---------------------------------------------------------------------------
# بازنویسی رنگ‌ها داخل یک رشته‌ی CSS
# ---------------------------------------------------------------------------
HEX_RE = re.compile(r"#([0-9a-fA-F]{3,8})\b")
RGB_RE = re.compile(r"\brgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)")


def _hex_sub(m):
    raw = m.group(1)
    if len(raw) == 3:
        full = "".join(c * 2 for c in raw)
        alpha = ""
    elif len(raw) == 4:
        full = "".join(c * 2 for c in raw[:3])
        alpha = raw[3] * 2
    elif len(raw) == 6:
        full, alpha = raw, ""
    elif len(raw) == 8:
        full, alpha = raw[:6], raw[6:]
    else:
        return m.group(0)
    r, g, b = [int(full[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    nr, ng, nb = map_color(r, g, b)
    return "#%02x%02x%02x%s" % (round(nr * 255), round(ng * 255), round(nb * 255), alpha)


def _rgb_sub(m):
    r, g, b = [float(m.group(i)) / 255.0 for i in (1, 2, 3)]
    a = m.group(4)
    nr, ng, nb = map_color(r, g, b)
    vals = [round(nr * 255), round(ng * 255), round(nb * 255)]
    if a is None:
        return "rgb(%d, %d, %d)" % tuple(vals)
    return "rgba(%d, %d, %d, %s)" % (vals[0], vals[1], vals[2], a)


def recolor(text):
    return RGB_RE.sub(_rgb_sub, HEX_RE.sub(_hex_sub, text))


HAS_COLOR = re.compile(r"#[0-9a-fA-F]{3,8}\b|\brgba?\(")

# اعلان‌هایی که رنگشان از توکن می‌آید هم باید در لایه‌ی امبر تکرار شوند.
# دلیلش ترتیب است: app.css بارها رنگ ثابتِ قالب پایه را با یک var() خنثی
# می‌کند. اگر آن اعلان‌ها اینجا نیایند، در لایه‌ی امبر فقط نسخه‌ی nozha
# می‌ماند و همان رنگ - که حالا نارنجی شده - برنده می‌شود. دقیقاً همین
# باعث شد .c-first به‌جای خاکستریِ برند، نارنجیِ پریده بشود.
COLOR_PROP = re.compile(
    r"^\s*(--|color\b|background\b|background-color\b|border[\w-]*\b|outline[\w-]*\b"
    r"|box-shadow\b|text-shadow\b|fill\b|stroke\b|caret-color\b|text-decoration-color\b"
    r"|-webkit-text-fill-color\b)",
    re.I,
)


def is_color_decl(d):
    if HAS_COLOR.search(d):
        return True
    return bool(COLOR_PROP.match(d)) and "var(" in d


# ---------------------------------------------------------------------------
# پیشوند زدن به انتخاب‌گرها
# ---------------------------------------------------------------------------
def prefix_selector(sel):
    sel = sel.strip()
    if not sel or sel.startswith("@"):
        return sel
    out = []
    for part in sel.split(","):
        # انتخاب‌گرهای چندخطی باید یک‌خطی شوند، وگرنه تشخیصِ :root در
        # ابتدای رشته شکست می‌خورد و آن بلوک بدون پیشوند بیرون می‌رود -
        # یعنی توکن‌های امبر به پوسته‌ی فعلی نشت می‌کنند.
        p = " ".join(part.split())
        if not p:
            continue
        # :root و html: صفت روی خودشان می‌نشیند تا ویژگی بالاتر برود.
        if p in (":root", "html") or p.startswith(":root") or p.startswith("html"):
            head = ":root" if p.startswith(":root") else "html"
            out.append(head + SKIN + p[len(head):])
        else:
            out.append(SKIN + " " + p)
    return ", ".join(out)


def split_top_level(css):
    """CSS را به بلوک‌های سطح‌بالا می‌شکند: (selector_or_atrule, body, is_at)."""
    blocks = []
    i, n = 0, len(css)
    buf = ""
    while i < n:
        ch = css[i]
        if ch == "{":
            depth, j = 1, i + 1
            while j < n and depth:
                if css[j] == "{":
                    depth += 1
                elif css[j] == "}":
                    depth -= 1
                j += 1
            blocks.append((buf.strip(), css[i + 1:j - 1]))
            buf = ""
            i = j
        elif ch == ";" and buf.strip().startswith("@"):
            # @import و مانندش: بدون بدنه. کنار گذاشته می‌شود.
            buf = ""
            i += 1
        else:
            buf += ch
            i += 1
    return blocks


def strip_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


# @import و @charset بدنه ندارند و URL داخلشان می‌تواند ';' داشته باشد
# (فونت‌های گوگل دقیقاً همین‌طورند)، پس شکستنِ ساده روی ';' انتخاب‌گرِ بلوک
# بعدی را خراب می‌کند. قبل از هر تجزیه‌ای حذف می‌شوند.
BODYLESS_AT = re.compile(r"@(?:import|charset|namespace)\b[^;]*;", re.I)


def strip_bodyless_at(css):
    return BODYLESS_AT.sub("", css)


def color_decls(body):
    """فقط اعلان‌هایی که رنگ دارند - بقیه‌ی طراحی نباید تکرار شود."""
    keep = []
    for decl in body.split(";"):
        d = decl.strip()
        if d and is_color_decl(d):
            keep.append(d)
    return keep


def emit_rule(sel, body, indent=""):
    decls = color_decls(body)
    if not decls:
        return ""
    lines = "".join("%s\t%s;\n" % (indent, recolor(d)) for d in decls)
    return "%s%s {\n%s%s}\n" % (indent, prefix_selector(sel), lines, indent)


# ---------------------------------------------------------------------------
# هویت پوسته، دستی
# ---------------------------------------------------------------------------
# نگاشتِ خودکار برای دُمِ بلندِ رنگ‌های ثابت عالی است، ولی هویت را نمی‌سازد:
# فیروزه‌ای فعلی روشنی ۰٫۵۶ دارد و نارنجیِ مرجع ۰٫۹۶، پس هر تبدیلِ حافظِ
# روشنی رنگِ برند را گِلی می‌کند. این چند توکن با دست و دقیقاً برابر مرجع
# نوشته می‌شوند و چون آخر فایل می‌آیند، بر خروجی خودکار می‌چربند.
IDENTITY = """

/* ===== هویت پوسته: دستی، برابر با پالت مرجع ===== */
:root[data-skin="ember"] {
\t--brand-navy: #2e2e32;
\t--brand-navy-dark: #1b1b1d;
\t--brand-navy-soft: #f1f1f2;
\t--brand-gold: #f5822d;
\t--brand-gold-dark: #c96a22;

\t--teal: #b25f21;
\t--teal-dark: #8f4b18;
\t--teal-soft: #f7efe8;

\t--card: #ffffff;
\t--card-2: #f4f4f5;
\t--text: #1b1b1d;
\t--muted: #6d6d75;
\t--line: #e0e0e4;
\t--accent: #b25f21;
\t--accent-text: #ffffff;
\t--up: #2f7d4a;
\t--down: #c0403c;

\t--shadow-sm: 0 2px 8px rgba(27, 27, 29, .07);
\t--shadow-2: 0 4px 18px rgba(27, 27, 29, .10);
\t--shadow-3: 0 10px 28px rgba(27, 27, 29, .16);
}

[data-skin="ember"] body {
\tbackground: #f4f4f5;
}

/* در حالت تیره نارنجیِ کامل برمی‌گردد: روی زغالی ۶٫۶:۱ است و هیچ دلیلی
   برای تیره کردنش نیست. تیره‌ترش (#b25f21) فقط برای حالت روشن لازم بود. */
[data-skin="ember"] .dark {
\t--brand-navy: #252528;
\t--brand-navy-dark: #1b1b1d;
\t--brand-navy-soft: #2a2a2e;
\t--brand-gold: #f5822d;
\t--brand-gold-dark: #c96a22;

\t--teal: #f5822d;
\t--teal-dark: #c96a22;
\t--teal-soft: #2a1f14;

\t--card: #252528;
\t--card-2: #2e2e32;
\t--text: #f2f2f3;
\t--muted: #9a9aa2;
\t--line: #37373c;
\t--accent: #f5822d;
\t--accent-text: #16120d;
\t--up: #4fae70;
\t--down: #e05c58;

\t--shadow-sm: 0 2px 8px rgba(0, 0, 0, .34);
\t--shadow-2: 0 4px 18px rgba(0, 0, 0, .40);
\t--shadow-3: 0 10px 28px rgba(0, 0, 0, .55);
}

[data-skin="ember"] body.dark {
\tbackground: #1b1b1d;
}

/* نوار کناری در مرجع یک سطحِ تخت است، نه گرادیان. */
[data-skin="ember"] #dw-s1.bmd-layout-drawer {
\tbackground: #252528;
}

[data-skin="ember"] .side-item.selected {
\tbackground: rgba(245, 130, 45, .14) !important;
\tbox-shadow: inset -3px 0 0 #f5822d;
}

/* قالب پایه این را با li.side-item.selected a می‌نویسد - یک انتخاب‌گرِ
   عنصری بیشتر، پس با !important هم از قاعده‌ی کلاسیِ ما جلو می‌زد و آیتم
   فعال خاکستریِ تیره روی زمینه‌ی نارنجی می‌شد. شناسه‌ی درِاور ویژگی را
   قطعی بالا می‌برد. */
[data-skin="ember"] #dw-s1 li.side-item.selected a,
[data-skin="ember"] #dw-s1 li.side-item.selected a i {
\tcolor: #f5822d !important;
}

/* نوار بالا در حالت تیره سفید می‌ماند - این رفتار قالب پایه است و در
   پوسته‌ی فیروزه‌ای دست نمی‌خورد. ولی در مرجع نوار بالا هم‌رنگ سطح است، و
   یک نوار سفید روی زمینه‌ی زغالی طراحی را خراب نشان می‌دهد. پس فقط داخل
   امبر اصلاح می‌شود. */
[data-skin="ember"] .dark .avam-container .navbar.navbar-light {
\tbackground: #252528;
\tborder: 1px solid #37373c;
\tcolor: #f2f2f3;
}

[data-skin="ember"] .dark .avam-container .navbar.navbar-light .btn,
[data-skin="ember"] .dark .avam-container .navbar.navbar-light .dropdown-toggle,
[data-skin="ember"] .dark .avam-container .navbar.navbar-light i {
\tcolor: #f2f2f3;
}

[data-skin="ember"] .dark .navbar-toggler-icon {
\tfilter: invert(1) brightness(1.6);
}

/* دو برچسبِ کم‌رنگ که در طراحی فعلی ته‌رنگ سرمه‌ای داشتند و همان ته‌رنگ کمی
   تیره‌ترشان می‌کرد. با خنثی شدن رنگ، زیر حد خوانایی افتادند (۲٫۵ و ۳٫۹ روی
   سفید). به توکن muted وصل می‌شوند که ۵٫۴ می‌دهد. */
[data-skin="ember"] .stat-card-label,
[data-skin="ember"] .dashboard-tab-btn {
\tcolor: var(--muted);
}

/* هاله‌ی تزئینیِ پشت نوار کناری روی زمینه‌ی زغالی به‌جای عمق، لکه به نظر
   می‌رسد. رنگ مرجع تخت است. */
[data-skin="ember"] .avam-container::before,
[data-skin="ember"] .avam-container.bmd-drawer-in::before {
\tbackground: transparent;
\tbox-shadow: none;
}
"""


def build():
    chunks = []
    for src in SOURCES:
        path = os.path.join(ROOT, src)
        css = strip_bodyless_at(strip_comments(open(path, encoding="utf-8").read()))
        part = []
        for sel, body in split_top_level(css):
            if sel.startswith("@keyframes") or sel.startswith("@-webkit-keyframes"):
                # نام کی‌فریم سراسری است؛ اگر همین نام دوباره تعریف شود پوسته‌ی
                # فعلی هم عوض می‌شود. پس با نام تازه بیرون می‌آید و قاعده‌ی
                # animation در ادامه به آن سوییچ می‌کند.
                if not HAS_COLOR.search(body):
                    continue
                name = sel.split()[-1].strip()
                part.append("@keyframes %s-ember {%s}\n" % (name, recolor(body)))
                continue
            if sel.startswith("@media") or sel.startswith("@supports"):
                inner = "".join(emit_rule(s2, b2, "\t") for s2, b2 in split_top_level(body))
                if inner.strip():
                    part.append("%s {\n%s}\n" % (sel, inner))
                continue
            if sel.startswith("@"):
                continue
            r = emit_rule(sel, body)
            if r:
                part.append(r)
        if part:
            chunks.append("/* === %s === */\n" % src + "".join(part))

    header = (
        "/* پوسته‌ی امبر — زغالی + نارنجی، برگرفته از رابط ویوآی.\n"
        " *\n"
        " * این فایل با tools/build-skin-ember.py ساخته می‌شود؛ دستی ویرایشش نکنید.\n"
        " * برای تغییر رنگ‌ها نگاشتِ map_color در همان اسکریپت را عوض کنید و\n"
        " * دوباره اجرایش کنید.\n"
        " *\n"
        " * فقط وقتی فعال است که <html data-skin=\"ember\"> باشد، پس طراحی\n"
        " * فیروزه‌ای فعلی کاملاً دست‌نخورده می‌ماند.\n"
        " */\n\n"
    )

    tail = (
        "\n/* کی‌فریم رنگی: نسخه‌ی امبر جای نسخه‌ی اصلی را می‌گیرد. */\n"
        '[data-skin="ember"] .call-quick-btn {\n\tanimation-name: crmPulse-ember;\n}\n'
        + IDENTITY
    )
    out = header + "\n".join(chunks) + tail
    open(os.path.join(ROOT, OUT), "w", encoding="utf-8").write(out)
    print("%s نوشته شد — %d خط" % (OUT, out.count("\n")))


if __name__ == "__main__":
    build()
