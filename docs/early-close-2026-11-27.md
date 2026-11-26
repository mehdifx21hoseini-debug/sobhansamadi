# WM Markets early close, 27 November 2026

Verified on 26 November 2026 against the broker's public sources:

- Holiday schedule: https://en.wmmarkets.com/market-holiday/ (Persian: https://fa.wmmarkets.com/market-holiday/).
- Public holiday table 1, BZ–JO–SC–KE–KM, shows the same values as the supplied screenshot: 27/11/2026, Day after Thanksgiving, Dow Jones and US30CASH 20:12, spot gold 21:45. Forex (All) is Regular hours.
- Product outline: https://en.wmmarkets.com/products/ explicitly states: "Server Times: UTC+3 summer time; UTC+2 winter time".
- The public DST table 2 on the holiday page labels the 02/11/2026-onwards trading hours UTC+02:00.
- Tehran is UTC+03:30. Add 1 hour 30 minutes: Dow Jones/US30CASH 21:42 Tehran; gold 23:15 Tehran. Both remain on 27 November.

This is reduced trading hours on the day after Thanksgiving, not a statement that Friday is a US federal bank holiday or that forex is closed all day.

The notice is prepended to the existing morning digest only when its Tehran date is 2026-11-27. It says "today" and reserves message space before the news rows are fitted. It is not a separate broadcast, does not send anything on 26 November, and does not recur on later days. The existing membership requirement and delivery ledger remain in force.

Authenticated read-only preview: `/admin/market-close-notice?date=2026-11-27`.

The user requested final text approval before sending. The added announcement now defaults off via `early_close_20261127_approved`, independently of the ordinary digest. After explicit approval, set only this flag using authenticated `/admin/market-close-notice?state=on`; read-only preview reports `approved`. Leaving it unset/off preserves the normal news digest without this announcement.
