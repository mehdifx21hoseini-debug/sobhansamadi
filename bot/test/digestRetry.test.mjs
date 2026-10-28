// دورِ دومِ خلاصه فقط ۰۵:۳۰ UTC می‌رود، هر روزِ هفته.
import assert from "node:assert/strict";
import { isDigestRetrySlot } from "../src/econ/digestRetry.js";

let n = 0;
const ok = (name, got, want) => {
  assert.equal(got, want, name);
  n++;
};

ok("۰۵:۳۰ سه‌شنبه", isDigestRetrySlot(new Date("2026-10-27T05:30:00Z")), true);
ok("۰۵:۳۰ شنبه (آخر هفته هم)", isDigestRetrySlot(new Date("2026-10-24T05:30:00Z")), true);
ok("۰۵:۳۰ یکشنبه", isDigestRetrySlot(new Date("2026-10-25T05:30:00Z")), true);
ok("با عددِ میلی‌ثانیه", isDigestRetrySlot(Date.parse("2026-10-28T05:30:00Z")), true);
ok("۰۵:۳۵ نه", isDigestRetrySlot(new Date("2026-10-28T05:35:00Z")), false);
ok("۰۵:۲۵ نه", isDigestRetrySlot(new Date("2026-10-28T05:25:00Z")), false);
ok("۰۴:۳۰ نه", isDigestRetrySlot(new Date("2026-10-28T04:30:00Z")), false);
ok("۱۷:۳۰ نه (کرانِ فروش)", isDigestRetrySlot(new Date("2026-10-28T17:30:00Z")), false);
ok("تاریخِ نامعتبر", isDigestRetrySlot(new Date("x")), false);
ok("ثانیه‌ی تأخیر همان تیک", isDigestRetrySlot(new Date("2026-10-28T05:30:07Z")), true);

console.log("digestRetry: " + n + " بررسی درست");
