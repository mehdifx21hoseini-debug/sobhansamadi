# امتدادِ دیوارِ آکادمی به سمتِ راست.
#
# عکس ۷۰۰×۳۸۸ است و نیمه‌ی راستش فقط دیوار است - همان شبکه‌ی نشانِ «S».
# به جای پر کردنِ آن نیمه با رنگِ تخت، خودِ دیوار ادامه پیدا می‌کند و
# کم‌کم در جوهرِ بنر حل می‌شود.
#
# سه چیزی که سرِ راه بود:
#
# ۱. آینه کردنِ نوار، نوشته‌ی «Academy» را وارونه نشان می‌داد. پس تکرارِ
#    روبه‌جلو، و باندِ بالا - جایی که حروف‌اند - از دیوارِ خالیِ زیرش
#    کلون می‌شود.
# ۲. دوره‌ی شبکه ۱۲۳ پیکسل اندازه گرفته شد (همبستگی ۰٫۸۶). کامل نیست
#    چون پرسپکتیو دوره را کش می‌دهد؛ ولی دیوار تار است و چند پیکسل
#    روی‌هم‌افتادگی دیده نمی‌شود.
# ۳. درزِ خودِ چسب: یک میان‌گیریِ خطیِ ۵۰ پیکسلی روی مرز، تا لبه‌ی تیز
#    نماند.
from PIL import Image, ImageFilter

SRC = "banner.webp"   # عکسِ اصلی، استخراج‌شده از --img-banner قبلی
# همان --hb-ink در app.css. اگر آن عوض شد، این هم باید عوض شود: روی
# صفحه‌های پهن، بنر از خودِ عکس پهن‌تر می‌شود و بقیه‌اش را همین رنگ پر
# می‌کند - اگر دو رنگ یکی نباشند، یک درزِ عمودی می‌ماند.
INK = (0x17, 0x16, 0x20)
W0, H = 700, 388
OUT_W = 1067          # ۳۸۸ × ۲٫۷۵ - دقیقاً نسبتِ خودِ بنر
PERIOD = 123
TEXT_BOTTOM = 62      # پایینِ نوشته‌ی «Samadi Academy»
CLEAN_FROM = 66       # باندِ دیوارِ خالی که جای حروف می‌نشیند
CLEAN_TO = 100
SEAM = 50


def wall_strip():
    """یک دوره‌ی دیوار، بدونِ حروفِ بالا."""
    im = Image.open(SRC).convert("RGB")
    s = im.crop((W0 - PERIOD, 0, W0, H)).copy()
    plain = s.crop((0, CLEAN_FROM, PERIOD, CLEAN_TO))
    s.paste(plain.resize((PERIOD, TEXT_BOTTOM + 6), Image.LANCZOS), (0, 0))
    # مرزِ کلون هم نرم شود.
    band = s.crop((0, TEXT_BOTTOM - 8, PERIOD, TEXT_BOTTOM + 18))
    s.paste(band.filter(ImageFilter.GaussianBlur(3)), (0, TEXT_BOTTOM - 8))
    return s


# HOLD: آخرین ستون‌ها دقیقاً جوهرِ خالص‌اند، نه «تقریباً».
#
# روی صفحه‌ی پهن، بنر از عکس پهن‌تر می‌شود و بقیه را رنگِ زمینه پر
# می‌کند. اگر محوشدن تازه در ستونِ آخر به جوهر برسد، چند ستونِ قبلی
# هنوز روشن‌ترند و یک درزِ کم‌رنگِ عمودی می‌ماند - اندازه‌گیری شد: شش
# پله. با این نوار، مرز کاملاً صاف است.
HOLD = 70


def build(out, end_k=0.93, start=0.0, blur=1.2, fade_from=W0 - 60):
    im = Image.open(SRC).convert("RGB")
    canvas = Image.new("RGB", (OUT_W, H))
    canvas.paste(im, (0, 0))

    strip = wall_strip()
    x = W0
    while x < OUT_W:
        canvas.paste(strip, (x, 0))
        x += PERIOD

    if blur:
        ext = canvas.crop((W0 - 10, 0, OUT_W, H)).filter(ImageFilter.GaussianBlur(blur))
        canvas.paste(ext, (W0 - 10, 0))

    # میان‌گیری روی درز، تا لبه‌ی عمودی نماند.
    px = canvas.load()
    orig = im.load()
    for x in range(W0 - SEAM, W0):
        w = (x - (W0 - SEAM)) / SEAM
        for y in range(H):
            a = orig[x, y]
            b = px[x, y]
            px[x, y] = (int(a[0] + (b[0] - a[0]) * w),
                        int(a[1] + (b[1] - a[1]) * w),
                        int(a[2] + (b[2] - a[2]) * w))

    # و بعد، کم‌رنگ و کم‌رنگ‌تر تا در جوهرِ بنر حل شود.
    span = OUT_W - HOLD - fade_from
    for x in range(fade_from, OUT_W):
        t = min(1.0, (x - fade_from) / span)
        s = t * t * (3 - 2 * t)
        k = start + (end_k - start) * s
        for y in range(H):
            r, g, b = px[x, y]
            px[x, y] = (int(r + (INK[0] - r) * k),
                        int(g + (INK[1] - g) * k),
                        int(b + (INK[2] - b) * k))
    canvas.save(out, quality=88, method=6)
    print("✔", out)


# همینی که روی پروداکشن است: نشان‌ها از ۴۰۰ - همان‌جا که شانه تمام
# می‌شود - شروع به محو شدن می‌کنند و تا ۹۸٫۵٪ در جوهر حل می‌شوند، تا
# نقشه‌ی جهان جا باز کند و متن روی زمینه‌ی آرام بنشیند.
#
# خروجی را باید به data-URI تبدیل کرد و جای --img-banner در
# src/econ-app/app.css گذاشت؛ این اسکریپت خودش فایل را دست نمی‌زند.
# end_k برابرِ ۱ است تا ستونِ آخر دقیقاً همان جوهر باشد و وصله‌ی سمتِ
# راست بی‌درز بنشیند.
build("ext-qq.webp", end_k=1.0, fade_from=400)
