// آزمون نگاشت فرم سایت، روی همان payloadهای واقعی که در n8n ثبت شده‌اند.
import assert from "node:assert";
import fs from "node:fs";

const code = fs.readFileSync(new URL("./wf21-normalize-intake.js", import.meta.url), "utf8");
const run = (body, headers = { "x-api-key": "K" }) => {
  const $input = { first: () => ({ json: { body, headers } }) };
  return new Function("$input", code)($input)[0].json;
};

let pass = 0; const ok = n => { pass++; console.log("  ✓ " + n); };

// اجرای ۵۱۹۰۶ - همان چیزی که امروز از سایت آمد و رد شد.
const real1 = {"4":"arianaserico","5":"09120427008","6":"کمتر از 6 ماه","7":"خیر ندارم","8":"-","9":"-",
 "10":"پرایس اکشن","12":"سبحان صمدی","13":"کسب درآمد دلاری","14":"خیر ندارم","15":"-","16":"",
 "18":"ارایه و نظارت بر تمرین ها","19":"آریا ناصری","id":"30184","form_id":"2","post_id":null,
 "date_created":"2026-08-28 15:22:39","is_starred":"0","is_read":"0","ip":"5.119.114.230",
 "source_url":"https://sobhansamadi.com/x","user_agent":"Mozilla/5.0","currency":"USD",
 "payment_status":null,"status":"active"};

console.log("\nدرخواست واقعی امروز:");
const r1 = run(real1);
assert.equal(r1.full_name, "آریا ناصری");
assert.equal(r1.phone, "09120427008");
assert.equal(r1.telegram_id, "arianaserico");
ok("نام، شماره و تلگرام درست استخراج شدند");
assert.equal(r1.message, "ارایه و نظارت بر تمرین ها");
ok("متن درخواست از فیلد ۱۸");

const a1 = JSON.parse(r1.answers_json);
assert.equal(a1.market_experience, "کمتر از 6 ماه");
assert.equal(a1.has_real_account, "خیر ندارم");
assert.equal(a1.styles_learned, "پرایس اکشن");
assert.equal(a1.teacher_name, "سبحان صمدی");
assert.equal(a1.trading_goal, "کسب درآمد دلاری");
ok("پاسخ‌های پرسشنامه زیر کلیدهای درست نشستند");

// ترتیب باید همان ترتیب سوال‌های فرم باشد، نه ترتیب دلخواه.
assert.deepEqual(Object.keys(a1).slice(0, 3), ["market_experience", "has_real_account", "real_account_duration"]);
ok("ترتیب پاسخ‌ها همان ترتیب پرسشنامه است");

for (const junk of ["id", "form_id", "ip", "user_agent", "currency", "status", "source_url"]) {
  assert.ok(!(junk in a1), junk + " نباید در پاسخ‌ها باشد");
}
ok("اطلاعات فنی وردپرس (ip، مرورگر، ارز…) وارد پاسخ‌ها نمی‌شود");

// اجرای ۴۴۸۷۱ - یک درخواست کامل با متن بلند.
const real2 = {"4":"Abbaslkg Rad@","5":"09155097551","6":"بیش از 5 سال","7":"بله دارم",
 "8":"حدود شش سال با حساب ریل کار کردم","9":"چند سال پیش تا حداکثر 7 هزار دلار حساب ریل داشتم",
 "10":"چندتا سبک پرایس اکشن داشتم","12":"چندتا استاد داشتم","13":"آزادی عمل","14":"بله استراتژی معاملاتی دارم",
 "15":"","16":"","18":"با سلام\r\nمن مدت دوسال هست هر روز با استاد صمدی معامله میکنم","19":"عباس قاسمی راد",
 "id":"30175","form_id":"2","ip":"5.232.53.15","currency":"USD","status":"active"};

console.log("\nدرخواست واقعی دوم:");
const r2 = run(real2);
assert.equal(r2.full_name, "عباس قاسمی راد");
assert.equal(r2.phone, "09155097551");
ok("نمونه‌ی دوم هم درست نگاشته شد");
assert.ok(r2.message.includes("مدت دوسال"));
ok("متن چندخطی سالم می‌ماند");
const a2 = JSON.parse(r2.answers_json);
assert.ok(!("strategy_performance" in a2) && !("strategy_image_url" in a2));
ok("فیلدهای خالی جا نمی‌افتند - نه به‌صورت رشته‌ی خالی");

console.log("\nحالت‌های مرزی:");
// فرم دیگری با شماره‌های دیگر: نباید حدس بزند.
const otherForm = run({ "19": "چیزی", "5": "09120000000", form_id: "7" });
assert.equal(otherForm.full_name, "");
ok("فرم با شناسه‌ی دیگر نگاشت نمی‌شود - داده زیر شماره‌ی خودش می‌ماند");
assert.ok("19" in JSON.parse(otherForm.answers_json));
ok("ولی گم هم نمی‌شود");

// اگر روزی سایت نام‌های درست بفرستد، همان‌ها باید برنده باشند.
const named = run({ full_name: "نام درست", phone: "09121111111", "19": "نام شماره‌ای", form_id: "2" });
assert.equal(named.full_name, "نام درست");
ok("اگر سایت نام واقعی بفرستد، بر نگاشت شماره‌ای اولویت دارد");

// شماره‌ی تلفن با فرمت‌های دیگر.
assert.equal(run({ "5": "+989120427008", form_id: "2" }).phone, "09120427008");
assert.equal(run({ "5": "9120427008", form_id: "2" }).phone, "09120427008");
assert.equal(run({ "5": "0912 042 7008", form_id: "2" }).phone, "09120427008");
ok("شماره با +۹۸، بدون صفر، و با فاصله همه یکسان می‌شوند");

// کلید API از هدر خوانده می‌شود.
assert.equal(run({ form_id: "2" }, { "x-api-key": "SECRET" }).api_key, "SECRET");
ok("کلید API از هدر");

// بدنه‌ی خالی نباید بترکاند.
const empty = run({});
assert.equal(empty.full_name, "");
assert.equal(empty.answers_count, 0);
ok("بدنه‌ی خالی خطا نمی‌دهد");

console.log("\n" + pass + " آزمون، همه سبز.\n");
