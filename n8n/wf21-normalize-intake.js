const item = $input.first().json;
const b = item.body || {};
const headers = item.headers || {};

function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.indexOf('98') === 0 && digits.length === 12) digits = '0' + digits.slice(2);
  else if (digits.length === 10 && digits[0] === '9') digits = '0' + digits;
  return digits;
}

// Keys are compared with spacing, ZWNJ and punctuation stripped, so the
// site may send either the English field name or the Persian question
// label from the form, in whatever punctuation it happens to use.
function canon(k) {
  return String(k).toLowerCase().replace(/[\s‌‎‏_\-?؟:.،,()\/]/g, '');
}

const FIELDS = {
  full_name: ['full_name', 'name', 'fullname', 'نام و نام خانوادگی'],
  phone: ['phone', 'mobile', 'tel', 'telephone', 'تلفن تماس شما', 'شماره تماس'],
  telegram_id: ['telegram_id', 'telegram', 'telegram_username', 'آیدی تلگرام'],
  email: ['email', 'ایمیل'],
  consultation_goal: ['consultation_goal', 'message', 'notes', 'هدف خود را از مشاوره توضیح دهید'],
  market_experience: ['market_experience', 'مدت زمان فعالیت شما در بازار های مالی'],
  has_real_account: ['has_real_account', 'real_account', 'سابقه فعالیت در حساب ریل دارید'],
  real_account_duration: ['real_account_duration', 'در صورت داشتن حساب ریل چه مدتی در آن معامله کردید'],
  capital_traded: ['capital_traded', 'با چه میزان سرمایه ای تا به امروز معامله کردید'],
  styles_learned: ['styles_learned', 'چه سبک هایی تا به امروز آموزش دیده اید'],
  teacher_name: ['teacher_name', 'در صورت تمایل نام استاد خود در آموزش را ذکر کنید'],
  trading_goal: ['trading_goal', 'هدف شما از تبدیل شدن به یک معامله گر چیست'],
  has_strategy: ['has_strategy', 'آیا استراتژی معاملاتی برای خود ایجاد کرده اید'],
  strategy_performance: ['strategy_performance', 'در صورت داشتن استراتژی بازدهی آن را لایو به چه بازار به چه صورتی است'],
  strategy_image_url: ['strategy_image_url', 'strategy_image', 'file', 'file_url', 'تصویر استراتژی']
};

// The site's form posts through a WordPress form plugin, which sends the
// answers keyed by field NUMBER, not by name: {"19":"علی","5":"0912..."}.
// Nothing above matches a bare number, so every field came out empty and
// validation rejected the submission with "full_name الزامی است." - the
// form has been live and silently dropping every request.
//
// The numbers are tied to one specific form, so the map is gated on
// form_id. If the form is ever rebuilt its ids shift, and a wrong map
// would quietly file answers under the wrong questions - worse than not
// mapping at all. On a different form_id these keys fall through to
// `extras`, where they are kept under their own name and stay visible.
const NUMERIC_FORMS = {
  '2': {
    '19': 'full_name',
    '5': 'phone',
    '4': 'telegram_id',
    '18': 'consultation_goal',
    '6': 'market_experience',
    '7': 'has_real_account',
    '8': 'real_account_duration',
    '9': 'capital_traded',
    '10': 'styles_learned',
    '12': 'teacher_name',
    '13': 'trading_goal',
    '14': 'has_strategy',
    '15': 'strategy_performance',
    '16': 'strategy_image_url'
  }
};
const numericMap = NUMERIC_FORMS[String(b.form_id || '').trim()] || {};

// Bookkeeping the form plugin attaches to every submission. These are not
// answers, and without dropping them the CRM would list "currency" and
// "user_agent" next to the real questions, and the Telegram notification
// would carry a browser string.
const META = ['id', 'form_id', 'post_id', 'date_created', 'date_updated', 'is_starred',
  'is_read', 'ip', 'source_url', 'user_agent', 'currency', 'payment_status', 'payment_date',
  'payment_amount', 'payment_method', 'transaction_id', 'is_fulfilled', 'created_by',
  'transaction_type', 'status'];
const metaSet = {};
META.forEach(function (k) { metaSet[k] = true; });

const lookup = {};
Object.keys(FIELDS).forEach(function (key) {
  FIELDS[key].forEach(function (a) { lookup[canon(a)] = key; });
});

const mapped = {};
const extras = {};
Object.keys(b).forEach(function (k) {
  if (canon(k) === 'apikey') return;
  if (metaSet[k]) return;
  const v = b[k];
  const text = (v === null || v === undefined)
    ? ''
    : (typeof v === 'object' ? JSON.stringify(v) : String(v)).trim();
  if (!text) return;
  // Field name first, then the numeric map: if the site is ever fixed to
  // send proper names, those win and this map becomes dead weight rather
  // than a second source of truth fighting the first.
  const target = lookup[canon(k)] || numericMap[k];
  // An unrecognised key is kept under its own name rather than dropped,
  // so a form change on the site can never silently lose an answer.
  if (target) mapped[target] = text; else extras[k] = text;
});

const ORDER = ['market_experience', 'has_real_account', 'real_account_duration', 'capital_traded', 'styles_learned', 'teacher_name', 'trading_goal', 'has_strategy', 'strategy_performance', 'strategy_image_url'];
const answers = {};
ORDER.forEach(function (k) { if (mapped[k]) answers[k] = mapped[k]; });
Object.keys(extras).forEach(function (k) { answers[k] = extras[k]; });

return [{ json: {
  api_key: (headers['x-api-key'] || b.api_key || '').toString().trim(),
  full_name: mapped.full_name || '',
  phone: normalizePhone(mapped.phone),
  telegram_id: mapped.telegram_id || '',
  email: mapped.email || '',
  message: mapped.consultation_goal || '',
  answers_json: JSON.stringify(answers),
  answers_count: Object.keys(answers).length,
  raw_payload: JSON.stringify(b)
} }];
