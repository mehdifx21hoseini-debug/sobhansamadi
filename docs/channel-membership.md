# Strict channel membership

All private bot interactions require a fresh Telegram `getChatMember` result. There are no owner or certificate-admin exemptions. `member`, `administrator`, `creator`, and `restricted` with `is_member: true` are accepted. Missing/unknown statuses, Telegram errors, rate limits and database/configuration errors deny access. No positive membership result is cached.

`channelMembership.js` is shared by the interaction gate, grammY delivery transformer, miniapp API and every direct Telegram content sender. The required channel is read from the current `TG_CHANNEL` setting without a stale/default fallback on database errors. Group interactions cannot expose private bot features.

Only the fixed membership/retry prompt is allowed through without membership. Incoming channel ingestion, administrative maintenance/read-only diagnostics, and deletion of old messages are not content deliveries to a user.

Miniapp actions (data, explanation and subscription included) check membership after validating Telegram's signed identity. The UI starts locked, rechecks when returning to the page and checks while visible. This does not erase files or messages that were already delivered, and does not make public website resources private.

Automatic news, alerts, broadcasts, previews, CRM notifications and certificates check the recipient before delivery. Non-members are counted separately as `membership_skipped`, not as users who blocked the bot. Verification outages keep pending work retryable. The send budget is 12 recipients per round to leave room for membership requests; drain workflow round limits have been increased accordingly.

Diagnostics: authenticated `GET /admin/membership` checks the selected user (defaults to the owner) and the bot's channel status without delivering a message.

Validation:

```sh
cd bot
node --import ./test/grammyWeb.register.mjs --test test/*.test.mjs
CHECK=1 node --import ./test/grammyWeb.register.mjs test/freePlanBudget.harness.mjs
cd ..
node scripts/build-econ-app.mjs --check
# With a local HTTP server and Chromium:
APP_URL=http://127.0.0.1:8768/econ-app.html PLAYWRIGHT_CHROMIUM=/usr/bin/chromium node scripts/smoke-econ-app.mjs
```
