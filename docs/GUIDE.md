# راهنمای جامع پروژه‌ی ربات آکادمی سبحان صمدی

نسخه‌ی این راهنما: ۸ نوامبر ۲۰۲۶ (۱۷ آبان ۱۴۰۵)
بیلدِ در حال اجرا هنگام تهیه: `crm-d2-94`

> این فایل هیچ رمز، توکن یا کلیدی ندارد. فقط **نام** کلیدها آمده و جای
> نگهداری‌شان. مقدارها در Cloudflare و GitHub Secrets هستند و باید جداگانه
> در یک پسوردمنیجر نگه داشته شوند.

---

## ۱) تصویر کلی

```
کاربر تلگرام
    │  (webhook)
    ▼
Cloudflare Worker  «sobhansamadi»  ──── D1: sobhan-bot-db  (همه‌ی داده)
    │      ▲   ▲
    │      │   └── ۵ کرانِ خودِ کلادفلر (هر ۵ و ۱۰ دقیقه، ساعتی، ۷:۳۰ و ۲۱:۰۰ تهران)
    │      └────── GitHub Actions (ارسال‌های موازی، جمع‌آوری تقویم، بک‌آپ، گزارش)
    │
    ├── Telegram Bot API (ارسال پیام)
    ├── Gemini (دستیار هوش مصنوعی)
    └── n8n روی 96825.7host.cloud (فقط چند کار باقی‌مانده: تحلیل AI تقویم، پل CRM)

پنل وب CRM (فایل‌های HTML/JS ریشه‌ی مخزن) ──► همان ورکر (/crm-mirror و API پنل)
```

| جزء | کجاست | نکته |
|---|---|---|
| کد ربات | مخزن `mehdifx21hoseini-debug/sobhansamadi` پوشه‌ی `bot/` | جاوااسکریپت، grammY، بدون سرور |
| ورکر | Cloudflare Workers، نام `sobhansamadi` | آدرس: `https://sobhansamadi.mehdifx21hoseini.workers.dev` |
| دیتابیس | Cloudflare D1، نام `sobhan-bot-db` (binding: `DB`) | تنها منبعِ داده |
| زمان‌بندها | ۵ کران در `bot/wrangler.toml` + ورک‌فلوهای GitHub | سقف پلن رایگان: ۵ کران |
| پنل CRM | فایل‌های ریشه: `index.html`، `dashboard.html`، `js/…` | API را از ورکر می‌گیرد |
| مینی‌اپ تقویم | منبع `src/econ-app/` → خروجی `econ-app.html` | از مسیر `/econ/app` ورکر سرو می‌شود |
| بک‌آپ دیتابیس | ورک‌فلوی `db-backup.yml` → مخزن خصوصیِ جدا | جمعه‌ها، رمزگذاری AES-256 |

---

## ۲) شاخه‌ها و دیپلوی

از ۸ نوامبر **همه‌چیز در `main` است**: کد ورکر، ورک‌فلوها، پنل و همین
راهنما. شاخه‌ی `claude/sleepy-curie-mygu0v` که تا آن روز ورکر از آن
منتشر می‌شد، با `main` کاملاً یکی شده است.

| شاخه | کاربرد |
|---|---|
| `main` | **شاخه‌ی اصلی.** ورک‌فلوهای GitHub Actions از اینجا اجرا می‌شوند، و ورکر باید از اینجا منتشر شود (پایین را ببینید). |
| `claude/sleepy-curie-mygu0v` | شاخه‌ی دیپلوی قدیمی؛ همان محتوای `main`. بعد از عوض کردنِ شاخه‌ی ساخت در کلادفلر، می‌شود پاکش کرد. |
| `claude/mentorai-kb` | فقط فایلِ پایگاه دانش MentorAI (`mentorai_export/academy_bot_kb.json`). |

### یک قدمِ دستی در کلادفلر (یک‌بار)
شاخه‌ای که ورکر از آن ساخته می‌شود در پنل کلادفلر تعیین می‌شود و از
گیت‌هاب عوض نمی‌شود:

Cloudflare → Workers & Pages → `sobhansamadi` → Settings → Build →
**Branch control** → Production branch را `main` بگذارید.

تا وقتی این را عوض نکرده‌اید، هر تغییرِ کد باید به هر دو شاخه برود (یا
شاخه‌ی قدیمی هم‌زمان با `main` به‌روز شود).

نشانه‌ی اینکه دیپلوی رسیده: `GET /health` عددِ بیلد (`crm-d2-NN`) را
برمی‌گرداند. این عدد در `bot/src/worker.js` (ثابت `BUILD`) با هر تغییر
یکی بالا می‌رود.

### تنظیم Workers Builds (اگر روزی از نو ساخته شود)
1. Cloudflare → Workers & Pages → Create → Import a repository
2. مخزن `sobhansamadi`، **Root directory: `bot`**
3. شاخه‌ی ساخت: `main`
4. Secretها را دوباره بگذارید (بخش ۴)
5. webhook تلگرام را تنظیم کنید (بخش ۹)

> ⚠️ متغیر متنی را در پنل کلادفلر اضافه نکنید: هر بیلد تنظیمات را با
> `wrangler.toml` جایگزین می‌کند و متغیرهای پنل پاک می‌شوند. آدرس‌ها در
> `wrangler.toml`، کلیدها به‌صورت **Secret**.

---

## ۳) زمان‌بندها (کران‌های کلادفلر)

در `bot/wrangler.toml` و هم‌نام در `bot/src/worker.js`:

| کران (UTC) | تهران | کار |
|---|---|---|
| `*/10 * * * *` | هر ۱۰ دقیقه | همگام‌سازیِ آینه‌ی تقویم، صندوق خروجیِ لیدها، نگهداری |
| `0 4 * * *` | ۷:۳۰ صبح | شروع خلاصه‌ی صبح + فراخوانیِ ورک‌فلوی `econ-digest.yml` |
| `*/5 * * * *` | هر ۵ دقیقه | هشدار پیش از خبر، ادامه‌ی خلاصه/اعلان‌ها، صف پیام همگانی؛ ساعت ۰۵:۳۰ UTC دورِ دومِ خلاصه |
| `17 * * * *` | ساعتی | جمع‌آوری مستقیم تقویم (ForexFactory و تعطیلات) |
| `30 17 * * *` | ۲۱:۰۰ | گزارش روزانه‌ی فروش |

پلن رایگان فقط ۵ کران می‌دهد و هر ۵ پر است؛ کارِ تازه باید روی یکی از
همین‌ها سوار شود.

---

## ۴) کلیدها و تنظیمات (فقط نام‌ها)

### Cloudflare Worker → Settings → Variables and Secrets (نوع Secret)
| نام | کاربرد |
|---|---|
| `BOT_TOKEN` | توکن ربات تلگرام |
| `WEBHOOK_SECRET` | امضای webhook تلگرام |
| `ADMIN_KEY` | کلید مسیرهای `/admin/*` (همان مقدارِ `WORKER_ADMIN_KEY` در GitHub) |
| `GEMINI_API_KEY` | دستیار هوش مصنوعی |
| `GITHUB_DISPATCH_TOKEN` | تا ورکر بتواند ورک‌فلوهای گیت‌هاب را راه بیندازد |
| `ECON_EXPORT_KEY` | تبادل با n8n (تقویم) |
| `ECON_INGEST_KEY` | دریافت داده‌ی تقویم از ورک‌فلوهای FF |
| `CRM_LEAD_INTAKE_KEY` | پل لید به n8n/CRM |
| `MENTORING_INTAKE_KEY` | فرم منتورینگ سایت |
| `PAYMENT_INTAKE_KEY` | دریافت پرداخت |
| `CONTENT_CHANNEL_ID` / `CONTENT_CHANNEL_USERNAME` / `SUPPORT_USERNAME` / `CRM_AUTH_VERIFY_URL` | تنظیمات جانبی (ممکن است در پنل یا toml باشند) |

### `bot/wrangler.toml` → `[vars]` (غیرمحرمانه)
`ECON_EXPORT_URL`، `ECON_EXPLAIN_URL`، `ECON_MINIAPP_URL`،
`CRM_LEAD_INTAKE_URL`، `CRM_MIGRATE_URL`، `CRM_MENTORING_INTAKE_URL`،
`CRM_EXPORT_URL`، `GITHUB_REPO`، `GITHUB_REF_NAME`، `WORKER_BASE_URL`.

### GitHub → Settings → Secrets and variables → Actions
| نام | کاربرد |
|---|---|
| `WORKER_ADMIN_KEY` | همه‌ی ورک‌فلوهایی که ورکر را صدا می‌زنند |
| `CLOUDFLARE_API_TOKEN` | بک‌آپ D1 (دسترسی D1: Edit) |
| `CLOUDFLARE_ACCOUNT_ID` | شناسه‌ی حساب |
| `CLOUDFLARE_ANALYTICS_TOKEN` | گزارش مصرف (فقط Account Analytics: Read) |
| `BACKUP_REPO` / `BACKUP_REPO_TOKEN` / `BACKUP_PASSPHRASE` | بک‌آپ هفتگی |
| `ECON_EXPORT_KEY` / `ECON_INGEST_KEY` | ورک‌فلوهای FF |

> ⚠️ `BACKUP_PASSPHRASE` اگر گم شود، فایل‌های بک‌آپ برای همیشه باز نمی‌شوند.
> حتماً در پسوردمنیجر باشد.

### کلیدهای روشن/خاموش در دیتابیس (جدول `bot_config`)
| کلید | معنی |
|---|---|
| `econ_worker_sender` | ارسال‌های تقویم از ورکر (on) |
| `econ_audience_snapshot` | عکسِ فهرستِ مخاطب (پیش‌فرض روشن؛ `off` = مسیر قدیمی) |
| `econ_batch_claim` | ثبتِ دسته‌ای پیام‌های روزانه (از ۸ نوامبر؛ `off` = تک‌به‌تک). **فقط بین دو روز عوض شود.** |
| `econ_greet` | سلام دوشنبه |
| `econ_notice` | اطلاعیه‌های تاریخ‌دار |
| `econ_result_notice` | اعلام نتیجه‌ی خبر (فعلاً خاموش) |
| `econ_worker_ingest` / `econ_worker_explain` | جمع‌آوری و تحلیل تقویم از ورکر |
| `econ_digest_done` / `econ_greet_done` / … | پرچمِ «امروز تمام شد» (خودکار) |

---

## ۵) دیتابیس D1

جدول‌های اصلی (طرح کامل در `bot/schema.sql`، `bot/schema-crm.sql`،
`bot/schema-econ.sql` و `ensure*Schema` داخل کد):

- **کاربران ربات:** `user_state` (هر کسی که ربات را استارت کرده؛ `blocked_at`، `last_interaction_at`، `sent_digest`/`sent_greet`/…)، `user_source`، `phone_book`
- **تقویم اقتصادی:** `econ_events`، `econ_labels`، `econ_holidays`، `econ_ai_cache`، `econ_subscriber` (تنظیمات هشدار هر نفر)، `econ_sent_log` (دفتر ارسال هشدار)، `econ_sync_state`
- **CRM و پنل:** `crm_leads`، `crm_orders`، `crm_products`، `crm_calls`، `crm_support_tickets`، `crm_ticket_messages`، `crm_broadcasts` و `crm_broadcast_recipients`، `crm_admin_users`، `crm_session`، `crm_activity_log`، `crm_mentoring_requests`، `crm_mirror`، …
- **لید و پشتیبانی قدیمی:** `leads`، `lead_outbox`، `support_tickets`، `mentoring_intake`
- **محتوا:** `content_library` (فایل‌ها)، `text_content` (متن‌ها)، `button_labels`، `bot_links`، `content_requests`
- **هوش مصنوعی:** `ai_kb`، `ai_kb_usage`، `ai_log`، `kb_source`
- **گواهی‌نامه:** `cert_jobs`
- **تنظیمات و حالت:** `bot_config`

سقف پلن رایگان D1: **۵ میلیون خواندن و ۱۰۰ هزار نوشتن در روز.** وضعیت
فعلی (نوامبر): خواندن ~۰٫۴ تا ۱٫۴ میلیون، نوشتن ~۴۰ تا ۷۹ هزار — که
بیشترِ نوشتن از ثبتِ خلاصه‌ی صبح بود و از ۹ نوامبر باید ~۱۷ هزار کم شود.

---

## ۶) ورک‌فلوهای GitHub Actions (`.github/workflows/`)

| فایل | زمان | کار |
|---|---|---|
| `econ-digest.yml` | ۰۴:۰۰ UTC + فراخوانی از ورکر (۰۴:۰۰ و ۰۵:۳۰) | ۶ کارگر موازی خلاصه‌ی صبح را به همه می‌فرستند |
| `econ-greet.yml` | دوشنبه ۰۵:۰۰ UTC | سلام هفتگی |
| `econ-notice.yml` | ۰۴:۴۵، ۰۵:۱۵، ۰۵:۴۵ UTC | اطلاعیه‌های تاریخ‌دار (`bot/src/content/notices.js`) |
| `econ-alert.yml` | فراخوانی از ورکر سرِ هر پنجره | هشدار پیش از خبر به همه‌ی مشترکان |
| `ff-calendar.yml` | ساعتی دقیقه‌ی ۹ | خواندن تقویم ForexFactory |
| `ff-actuals.yml` | روزهای کاری هر ۳۰ دقیقه | خواندن عددهای منتشرشده |
| `db-backup.yml` | جمعه ۰۳:۰۰ UTC | بک‌آپ رمزگذاری‌شده‌ی D1 (۱۲ نسخه‌ی آخر) — **آخرین اجرای موفق: ۶ نوامبر** |
| `ops-cf-usage.yml` | دستی | مصرف D1 و ورکر، سنگین‌ترین کوئری‌ها، نوشتن ساعت‌به‌ساعت |
| `ops-probe.yml` | دستی، ورودی `path` | صدا زدن یک مسیر `/admin/*` و نمایش پاسخ |
| `cert-render.yml` | دستی/فراخوانی | ساخت گواهی‌نامه |
| `econ-app.yml` | روی push | نگهبانِ ساختِ مینی‌اپ |
| `bot-load-test.yml`، `debug-curl.yml` | دستی | ابزار عیب‌یابی |

گیت‌هاب کرانِ مخزنی را که ۶۰ روز کامیت نگرفته خاموش می‌کند — اگر پروژه
مدتی بی‌تغییر ماند، هر دو ماه یک کامیت کوچک بزنید.

---

## ۷) ربات: منو و دستورها

**منوی اصلی** (`bot/src/menu.js`، چیدمان فعلی):
1. تقویم اقتصادی و سشن (تمام‌عرض)
2. دوره‌های رایگان + ویدیوهای لایو ترید
3. کتاب‌های روانشناسی + ویس‌های روانشناسی
4. 🤖 اکسپرت SSProX (تمام‌عرض)
5. شرکت در مجموعه آموزشی پیشرفته (سبز)
6. بروکر معتمد + پشتیبانی
7. درباره ما

رنگ دکمه‌ها فقط آبی/سبز/قرمز است (محدودیت تلگرام). نامِ دکمه‌ها را می‌شود
بدون کدنویسی با `/labels` عوض کرد؛ نام‌های قدیمی خودکار کار می‌کنند.

**دستورهای مدیر** (فقط برای مالک): `/labels` نام دکمه‌ها، `/edit` متن
بخش‌ها، `/links` لینک‌ها، `/members` آمار اعضا، `/phones` شماره‌ها،
`/econsender` وضعیت ارسال تقویم، `/kbsync` `/kblist` `/kbadd` `/kbdel`
پایگاه دانش AI، `/aistats` آمار AI، `/unanswered` سؤال‌های بی‌پاسخ،
`/cert` `/certassets` گواهی‌نامه، `/setanim`، `/diag`، `/delete`،
`/resetchannel`.

**محتوا از کانال:** فایل یا متن با هشتگ کد (مثل `#EXPERT_MT5_FILE`) در
کانال محتوا ← خودکار در `content_library` / `text_content` می‌نشیند.

---

## ۸) کارهای روزمره (دستورالعمل‌ها)

### دیدن آمار و سلامت
- Actions → **Ops Probe** → Run workflow، `path` یکی از این‌ها:
  - `/admin/members` — چند نفر فعال‌اند (۵ دقیقه تا ۳۰ روز)
  - `/admin/econ-sender` — خلاصه‌ی امروز به چند نفر رسید، صف، عکس
  - `/admin/econ-alerts?days=2` — هشدارهای دو روز اخیر
  - `/admin/usage?days=30` — مصرفِ محتوا، AI، لیدها
  - `/admin/status` — وضعیت همگام‌سازی تقویم
- Actions → **Ops CF Usage** — مصرف D1 هفت روز اخیر.
- در ربات: `/members`، `/econsender`.

### فرستادن اطلاعیه به همه
1. متن را در `bot/src/content/notices.js` با کلیدِ **تاریخ تهران** اضافه کنید
   (`"2026-11-20": TEXT`)، push به شاخه‌ی دیپلوی.
2. `/admin/notice-preview` برای دیدن متن.
3. پرچم را روشن کنید: Ops Probe با `path=/admin/econ-notice?state=on`.
4. ورک‌فلوی `econ-notice.yml` همان روز ارسال می‌کند (یا دستی Run).
5. بعد از اتمام: `/admin/econ-notice?state=off`.

### فوروارد یک پست از کانال به همه (پادکست، ویدیو، متن)
همان مسیرِ بالا، فقط به‌جای متن لینکِ پست:
1. لینک پست را از کانال بردارید (Copy Post Link)، مثل
   `https://t.me/sobhanforex/1850`. شرط‌ها: ربات عضو کانال باشد و
   «Restrict saving content» کانال خاموش باشد.
2. پیش‌نمایش فقط برای مدیر: Ops Probe با
   `path=/admin/notice-preview?link=https://t.me/sobhanforex/1850` — پست
   برای مدیر فوروارد می‌شود و پاسخ نوعش را می‌گوید (audio، video، ...).
3. در `bot/src/content/notices.js` اضافه کنید:
   `"2026-11-20": { forward: "https://t.me/sobhanforex/1850" },`
4. ادامه مثل اطلاعیه‌ی متنی (مرحله‌های ۳ تا ۵ بالا).

پیام با «Forwarded from» و نام کانال می‌رسد. فایل روی تلگرام می‌ماند،
پس هزینه‌ی یک پادکست یا ویدیو با یک متن فرقی ندارد (هر بار ارسال به همه
حدود ۱٬۰۰۰ نوشتن D1). تا پایان ارسال پست را از کانال پاک نکنید.

پیام همگانیِ دلخواه هم از **پنل CRM → پیام همگانی** (`broadcast.html`)
ممکن است.

### خاموش کردن اضطراری
- همه‌ی ارسال‌های تقویم: `bot_config.econ_worker_sender = off`
- برگشت به claimِ تک‌به‌تک: `econ_batch_claim = off` (بین دو روز)
- برگشت ورکر به نسخه‌ی قبل: Cloudflare → Worker → Deployments → Rollback

### بازگردانی دیتابیس
- خطای اخیر (تا ۳۰ روز): Time Travel
  ```
  npx wrangler d1 time-travel info    sobhan-bot-db --timestamp=2026-11-01T07:00:00Z
  npx wrangler d1 time-travel restore sobhan-bot-db --timestamp=2026-11-01T07:00:00Z
  ```
- از دست رفتن حساب کلادفلر: آخرین فایل از مخزن خصوصی بک‌آپ ←
  `gpg -d dump.sql.gpg > dump.sql` (با `BACKUP_PASSPHRASE`) ←
  `npx wrangler d1 execute <db> --remote --file dump.sql`
  (جزئیات در `docs/backup.md`).

---

## ۹) ساختِ دوباره از صفر (بدترین حالت)

1. **کد:** از فایل `sobhansamadi-full.bundle` همین بسته (۵۴۹ کامیت، سه
   شاخه، از ۲۷ ژوئن ۲۰۲۶ تا امروز):
   ```
   git clone sobhansamadi-full.bundle sobhansamadi
   cd sobhansamadi
   git remote set-url origin https://github.com/<حساب>/<مخزن-تازه>.git
   git push origin 'refs/remotes/origin/*:refs/heads/*'
   ```
2. **دیتابیس:** در کلادفلر یک D1 تازه بسازید، `database_id` را در
   `bot/wrangler.toml` بگذارید، آخرین بک‌آپ را import کنید (بخش ۸).
3. **ورکر:** Workers Builds را مثل بخش ۲ وصل کنید (Root: `bot`).
4. **Secretها:** همه‌ی نام‌های بخش ۴ را در ورکر و در GitHub دوباره بگذارید.
5. **webhook تلگرام:** آدرسِ webhook `https://<worker>/webhook/tg` است و
   تلگرام هدرِ مخفیِ `WEBHOOK_SECRET` را همراهش می‌فرستد. خودِ ورکر این را
   تنظیم می‌کند: Ops Probe با `path=/admin/webhook` وضعیت را نشان می‌دهد، و
   `path=/admin/webhook?apply=yes` آن را روی آدرس فعلی ثبت می‌کند (اول
   `BOT_TOKEN` و `WEBHOOK_SECRET` باید Secret شده باشند).
6. **آدرس‌ها:** اگر آدرس ورکر عوض شد، `WORKER_BASE_URL` در `wrangler.toml`،
   `BASE` در ورک‌فلوها، و `WORKER_BASE` / `MIRROR_BASE` در `js/data.js` را
   عوض کنید.
7. **کران‌ها:** خودکار از `wrangler.toml` می‌آیند.
8. **آزمون:** `/health`، یک `/start` در ربات، Ops Probe روی
   `/admin/econ-sender`.

---

## ۱۰) تست‌ها

در `bot/test/`، با Node 22 (`node test/<name>.test.mjs`):
`econSnapshot`، `batchClaim`، `alertDrain`، `alertLevels`، `dayClaim`،
`dbReads`، `digestWindow`، `digestRetry`، `kbSsprox`، `geminiRetry`. چند
تست قدیمی (`aiStyle`، `botLinks`، `buttonLabels`، `certificate`، `phones`،
`unanswered`) به ماژول‌هایی وابسته‌اند که در این محیط نصب نیستند و از قبل
اجرا نمی‌شدند.

---

## ۱۱) تاریخچه‌ی تصمیم‌های مهم (چرا این‌طوری است)

- **عکسِ فهرستِ مخاطب** (اکتبر): بدون آن هر دورِ ارسال ۱۶ هزار ردیف
  می‌خواند؛ ۱۲ اکتبر سقف ۵ میلیون پر شد و ربات ساکت شد.
- **قفلِ ساختِ عکس** (۱۴ اکتبر): شش کارگر هم‌زمان ۳۹ بار عکس ساختند.
- **`stopped` به‌جای `throttled`** (۲۸ اکتبر): خطای تلگرام وسط ارسال باعث
  شد خلاصه فقط به ۵٬۷۴۴ نفر برسد؛ دورِ دومِ ۰۵:۳۰ هم از همان روز اضافه شد.
- **هشدار فقط برای خبرهای دلار** (۵ نوامبر): خبرهای ارزهای دیگر هر ۵ دقیقه
  کل جدول مشترکان را می‌خواندند (۲۴۵ هزار خواندن بی‌فایده تا صبح).
- **ثبتِ دسته‌ای** (۸ نوامبر): ۸۵٪ نوشتنِ روزانه از ثبتِ تک‌به‌تکِ خلاصه بود.

جزئیاتِ هر کدام در کامنت‌های همان بخش از کد آمده است.

---

## ۱۲) بسته‌ی بکاپ

این راهنما در مخزن در `docs/GUIDE.md` است. بسته‌ی بکاپِ جدا (zip) این فایل‌ها را دارد:

| فایل | محتوا |
|---|---|
| `GUIDE.md` | همین راهنما |
| `sobhansamadi-full.bundle` | **کل مخزن با همه‌ی تاریخچه و همه‌ی شاخه‌ها** (بازگردانی: `git clone`) |
| `source-deploy-branch/` و `source-main/` | کدِ دو شاخه در لحظه‌ی بکاپ (از ۸ نوامبر یکی‌اند) |
| `INVENTORY.txt` | فهرست دقیقِ کلیدها، جدول‌ها، مسیرها، دستورها، کامیت‌ها |

**چیزهایی که در این بسته نیست و باید جدا نگه داشته شوند:**
1. مقدار Secretها (توکن ربات، کلیدها، عبارت عبور بک‌آپ) — در پسوردمنیجر.
2. خودِ داده‌های دیتابیس — بک‌آپ هفتگیِ رمزگذاری‌شده در مخزن خصوصی، و
   Time Travel ۳۰روزه در کلادفلر.
3. گردش‌کارهای n8n روی سرور `96825.7host.cloud` — از داخل خودِ n8n
   export بگیرید (فقط بخشی از آن‌ها در پوشه‌ی `n8n/` مخزن مستند شده).
4. دسترسی‌ها: حساب کلادفلر، حساب گیت‌هاب، BotFather.
