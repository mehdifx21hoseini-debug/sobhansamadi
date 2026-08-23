// Reads released "actual" values from the ForexFactory calendar page and
// posts them to the calendar's ingest webhook.
//
// Why a browser at all: FF's public JSON feed carries no actual values, and
// the site itself sits behind a Cloudflare JS challenge that a plain HTTP
// client cannot pass. A real Chromium solves the non-interactive challenge
// by simply executing it. This script only reads the public calendar page —
// two pages per run, on a gentle schedule — and the data goes nowhere except
// our own private table.
import { chromium } from 'playwright';

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
  try {
    // The Cloudflare interstitial auto-solves and redirects; the calendar
    // table appearing is the signal that we are through.
    await page.waitForSelector('.calendar__row', { timeout: 45000 });
  } catch (e) {
    const title = await page.title();
    throw new Error(`calendar table never appeared (page title: "${title}") — likely blocked`);
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

const browser = await chromium.launch({
  args: ['--disable-blink-features=AutomationControlled'],
});
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1366, height: 900 },
  locale: 'en-US',
  timezoneId: 'America/New_York',
});
const page = await ctx.newPage();

let all = [];
let failures = 0;
// Today catches releases as they land; yesterday catches late revisions and
// anything a failed earlier run missed.
for (const off of [0, -1]) {
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

if (all.length === 0) {
  // Both pages blocked or empty - fail loudly so the Actions run shows red.
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
