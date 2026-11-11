// تست‌ها روی Node اجرا می‌شوند ولی ورکر نسخه‌ی وبِ grammY را می‌گیرد
// (fetchِ سراسری). بی‌این، Node نسخه‌ی خودش را با کلاینتِ HTTPِ جدا
// برمی‌دارد و fetchِ ساختگیِ تست دیده نمی‌شود.
export async function resolve(spec, ctx, next) {
  if (spec === "grammy") return next("grammy/web", ctx);
  return next(spec, ctx);
}
