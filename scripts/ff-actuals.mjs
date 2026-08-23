// Reads released "actual" values from the ForexFactory calendar page and
// posts them to the calendar's ingest webhook.
//
// Why a browser at all: FF's public JSON feed carries no actual values, and
// the site itself sits behind a Cloudflare JS challenge that a plain HTTP
// client cannot pass. A real Chromium solves the non-interactive challenge
// by simply executing it. This script only reads the public calendar page —
// three day pages per run, on a gentle schedule — and the data goes nowhere except
// our own private table.
import { chromium } from 'patchright';

const WEBHOOK = 'https://96825.7host.cloud/webhook/econ/actuals';
const KEY = process.env.FF_SYNC_KEY || '';
if (!KEY) {
  console.error('FF_SYNC_KEY is not set');
  process.exit(1);
}

// The calendar keys events by their US-Eastern date, so the day URLs are
// built in that zone regardless of where the runner happens to be.
function etParts(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const p = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  return { y: +p.year, m: +p.month, d: +p.day };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function dayUrl(p) {
  return `https://www.forexfactory.com/calendar?day=${MONTHS[p.m - 1]}${p.d}.${p.y}`;
}
function isoDate(p) {
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

async function readDay(page, p) {
  const url = dayUrl(p);
  console.log('reading', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // The Cloudflare interstitial auto-solves and redirects. Poll for up to a
  // minute; once one page passes, the clearance cookie carries the later
  // pages straight through. A day with no scheduled events (weekend,
  // holiday) has zero rows, so an empty page with the real title is a
  // success, not a block.
  const deadline = Date.now() + 60000;
  for (;;) {
    const ok = await page.locator('.calendar__row').first().isVisible().catch(() => false);
    if (ok) break;
    const title = await page.title().catch(() => '');
    const challenged = /just a moment|attention required/i.test(title);
    if (!challenged && /forex factory/i.test(title)) {
      await page.waitForTimeout(4000); // let late-rendering rows settle
      break;
    }
    if (Date.now() > deadline) {
      throw new Error(`stuck on "${title}" after 60s — likely blocked`);
    }
    if (challenged) console.log('  ...waiting out the challenge');
    await page.waitForTimeout(2500);
  }
  const rows = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('tr.calendar__row').forEach((tr) => {
      const t = (sel) => {
        const el = tr.querySelector(sel);
        return el ? el.textContent.trim() : '';
      };
      const title = t('.calendar__event-title') || t('.calendar__event');
      if (!title) return;
      out.push({
        title,
        currency: t('.calendar__currency'),
        actual: t('.calendar__actual'),
        forecast: t('.calendar__forecast'),
        previous: t('.calendar__previous'),
      });
    });
    return out;
  });
  return rows.map((r) => ({ ...r, date: isoDate(p) }));
}

// patchright (a Playwright fork that closes the CDP leaks Cloudflare's
// challenge script probes for) driving the runner's real Google Chrome,
// headed under xvfb. Vanilla Playwright never passed the challenge — both
// headless and headed runs sat on "Just a moment..." — because the
// automation is detectable at the protocol level, not the display level.
// No fake user agent and no hand-rolled stealth scripts: with a real
// Chrome binary those become mismatches that flag the browser instead.
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
});
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

let all = [];
let failures = 0;
// Today catches releases as they land; the previous two days catch late
// revisions, anything a failed earlier run missed, and Friday's releases
// when a run lands on a weekend.
for (const off of [0, -1, -2]) {
  try {
    all = all.concat(await readDay(page, etParts(off)));
  } catch (e) {
    failures++;
    console.error('day read failed:', e.message);
  }
}
await browser.close();

const events = all.filter((r) =>
  (r.currency === 'USD' || r.currency === 'All') && r.actual && r.actual.trim());
console.log(`rows read: ${all.length} | with USD/All actuals: ${events.length}`);

if (failures > 0 && all.length === 0) {
  // Every page that could have had rows was blocked - fail loudly so the
  // Actions run shows red. Zero rows with zero failures is just a quiet
  // stretch of the calendar (weekend, holiday).
  console.error('nothing readable at all');
  process.exit(1);
}

if (events.length === 0) {
  console.log('no released actuals right now - nothing to send');
  process.exit(0);
}

const res = await fetch(WEBHOOK, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    key: KEY,
    events: events.map((e) => ({ date: e.date, title: e.title, actual: e.actual })),
  }),
});
const body = await res.json().catch(() => ({}));
console.log('webhook:', res.status, JSON.stringify(body));
if (!res.ok || body.success !== true) process.exit(1);
if (failures > 0) process.exit(1); // sent what we had, but flag the miss
