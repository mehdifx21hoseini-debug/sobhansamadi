import { Lead } from "./types";

const daysAgo = (n: number, h = 10, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

export const initialLeads: Lead[] = [
  {
    id: "L-1042",
    fullName: "رضا محمدی",
    phone: "0912 340 1187",
    level: "متوسط",
    topic: "می‌خوام بدونم مجموعه آموزشی پیشرفته برای کسی که تازه شروع کرده مناسبه یا نه.",
    preferredTime: "امروز، بعدازظهر ۱۶ تا ۱۸",
    status: "پاسخ‌داده‌نشده",
    createdAt: daysAgo(0, 9, 15),
    registrationSent: false,
  },
  {
    id: "L-1041",
    fullName: "سارا کریمی",
    phone: "0935 118 4402",
    level: "پیشرفته",
    topic: "شرایط اقساط ثبت‌نام و تاریخ شروع دوره بعدی رو می‌خوام بدونم.",
    preferredTime: "فردا صبح، قبل از ساعت ۱۱",
    status: "پاسخ‌داده‌نشده",
    createdAt: daysAgo(0, 8, 40),
    registrationSent: false,
  },
  {
    id: "L-1040",
    fullName: "علی نصیری",
    phone: "0919 662 7730",
    level: "مبتدی",
    topic: "هنوز مطمئن نیستم کدوم دوره مناسب منه، نیاز به راهنمایی دارم.",
    preferredTime: "هر زمان بعد از ساعت ۱۷",
    status: "تماس گرفته شد",
    createdAt: daysAgo(1, 11, 5),
    registrationSent: true,
    note: "با علی تماس گرفتم، به دوره پیشرفته علاقه‌مند بود. گفت تا آخر هفته تصمیم می‌گیره.",
  },
  {
    id: "L-1039",
    fullName: "مریم احمدی",
    phone: "0993 210 5567",
    level: "متوسط",
    topic: "آیا دوره ضبط‌شده هم هست یا فقط زنده برگزار میشه؟",
    preferredTime: "امروز عصر",
    status: "پاسخ نداد",
    createdAt: daysAgo(1, 14, 20),
    registrationSent: false,
    note: "دو بار تماس گرفتم، جواب نداد. فردا دوباره امتحان می‌کنم.",
  },
  {
    id: "L-1038",
    fullName: "محمد رضایی",
    phone: "0901 774 3321",
    level: "پیشرفته",
    topic: "قیمت نهایی و شرایط تخفیف گروهی رو می‌خوام بدونم.",
    preferredTime: "فردا بعدازظهر",
    status: "پاسخ‌داده‌نشده",
    createdAt: daysAgo(1, 16, 0),
    registrationSent: false,
  },
  {
    id: "L-1037",
    fullName: "نگار حسینی",
    phone: "0938 445 9012",
    level: "مبتدی",
    topic: "برای شروع از کجا باید مطالعه رو شروع کنم؟",
    preferredTime: "امروز، هر ساعتی",
    status: "تماس گرفته شد",
    createdAt: daysAgo(2, 10, 10),
    registrationSent: true,
    note: "ثبت‌نام کرد، لینک پرداخت ارسال شد.",
  },
  {
    id: "L-1036",
    fullName: "امیر صادقی",
    phone: "0912 887 2245",
    level: "متوسط",
    topic: "دوره روانشناسی رو هم می‌خوام همزمان با پیشرفته بردارم، امکانش هست؟",
    preferredTime: "فردا ساعت ۱۰ تا ۱۲",
    status: "پاسخ نداد",
    createdAt: daysAgo(2, 12, 30),
    registrationSent: false,
  },
  {
    id: "L-1035",
    fullName: "زهرا قاسمی",
    phone: "0919 003 8871",
    level: "پیشرفته",
    topic: "می‌خواستم بدونم مدرک پایان دوره معتبره یا نه.",
    preferredTime: "امروز صبح",
    status: "پاسخ‌داده‌نشده",
    createdAt: daysAgo(0, 9, 50),
    registrationSent: false,
  },
];

export const REGISTRATION_MESSAGE_TEMPLATE = `سلام {نام} عزیز، وقت بخیر 🌷
ممنون از تماسی که داشتیم.
شرایط ثبت‌نام مجموعه آموزشی پیشرفته به شرح زیره:

📌 مدت دوره: ۳ ماه
📌 نحوه برگزاری: آنلاین + پشتیبانی گروهی
📌 امکان پرداخت اقساطی

برای ثبت‌نام نهایی از لینک زیر استفاده کنید:
academy.example.com/register

هر سوالی داشتید در خدمتتون هستیم 🙏`;
