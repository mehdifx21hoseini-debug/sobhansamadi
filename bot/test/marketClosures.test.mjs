import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { EARLY_CLOSE_DATE, EARLY_CLOSES, SERVER_UTC_OFFSET_MINUTES, closeTimeInTehran, marketCloseNotice } from '../src/econ/marketClosures.js';
import { buildDigest, digestRef } from '../src/econ/sender.js';
import { ensureSchema as ensureEconSchema } from '../src/econ/store.js';
import { writeConfig } from "../src/content/channel.js";
import { clearAll } from '../src/cache.js';
const NativeDate = globalThis.Date;
function clock(iso) {
  const ms = new NativeDate(iso).getTime();
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [ms])); }
    static now() { return ms; }
  };
}
function env() {
  const raw = new DatabaseSync(':memory:');
  const DB = {raw, prepare(sql) { let args=[]; return {
    bind(...a){args=a;return this;},
    async run(){const r=raw.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};},
    async first(){return raw.prepare(sql).get(...args)||null;},
    async all(){return {results:raw.prepare(sql).all(...args)};},
  };}, async batch(stmts){return Promise.all(stmts.map(x=>x.run()));}};
  return {DB};
}
beforeEach(()=>clearAll());afterEach(()=>{globalThis.Date=NativeDate;});
await test('converts the exact broker screenshot hours using winter server UTC+2',()=>{
  assert.equal(EARLY_CLOSE_DATE,'2026-11-27');assert.equal(SERVER_UTC_OFFSET_MINUTES,120);
  assert.deepEqual(EARLY_CLOSES.map(x=>x.serverTime),['20:12','21:45']);
  assert.equal(closeTimeInTehran('20:12'),'۲۱:۴۲');assert.equal(closeTimeInTehran('21:45'),'۲۳:۱۵');
});
await test('notice is only for Friday, uses today, explains Thanksgiving and does not close all forex',()=>{
  for(const d of ['2026-11-26','2026-11-28','2027-11-27','invalid'])assert.equal(marketCloseNotice(d),'');
  const text=marketCloseNotice('2026-11-27');assert.ok(text.includes('امروز'));assert.ok(!text.includes('فردا'));
  assert.ok(text.includes('پس از تعطیلات شکرگزاری آمریکا'));assert.ok(text.includes('جفت‌ارزهای فارکس ساعات عادی دارند'));
  assert.ok(text.includes('WM Markets'));assert.ok(text.includes('به وقت ایران'));
});
await test('eligibility follows the Tehran date at the UTC midnight boundary',()=>{
  assert.equal(marketCloseNotice(digestRef(new NativeDate('2026-11-26T20:29:59Z'))),'');
  assert.notEqual(marketCloseNotice(digestRef(new NativeDate('2026-11-26T20:30:00Z'))),'');
  assert.equal(marketCloseNotice(digestRef(new NativeDate('2026-11-27T20:30:00Z'))),'');
});
await test('existing morning digest includes the notice on Friday, not on Thursday or Saturday',async()=>{
  for(const [iso,expected] of [['2026-11-26T04:00:00Z',false],['2026-11-27T04:00:00Z',true],['2026-11-28T04:00:00Z',false]]){
    clearAll();clock(iso);const e=env();await writeConfig(e,"early_close_20261127_approved","on");const d=await buildDigest(e,new Date());const text=d.markdown||d.text;
    assert.equal(text.includes('Early Close'),expected,iso);
    if(expected){assert.ok(text.indexOf('Early Close')<text.indexOf('اخبار مهم اقتصادی امروز'));assert.ok(text.includes('۲۱:۴۲'));assert.ok(text.includes('۲۳:۱۵'));assert.ok(!text.includes('امروز تعطیلی بانکی آمریکا'));}
  }
});
await test('long news summaries reserve room for both closing times',async()=>{
  clock('2026-11-27T04:00:00Z');const e=env();await writeConfig(e,'early_close_20261127_approved','on');await ensureEconSchema(e);
  const columns=e.DB.raw.prepare('PRAGMA table_info(econ_events)').all().map(x=>x.name);
  assert.ok(columns.includes('event_id'));
  const insert=e.DB.raw.prepare(`INSERT INTO econ_events(event_id,date,time,event,event_fa,currency,importance,status) VALUES(?,?,?,?,?,?,?,?)`);
  for(let i=0;i<60;i++)insert.run('test-'+i,'2026-11-27','10:00','Long economic title '+i,'شاخص اقتصادی آزمایشی با عنوان بلند '+i,'USD','high','upcoming');
  const d=await buildDigest(e,new Date());assert.ok(d.markdown.length<=4096,'Digest length '+d.markdown.length);
  assert.ok(d.markdown.includes('۲۱:۴۲'));assert.ok(d.markdown.includes('۲۳:۱۵'));
});

await test('announcement waits for explicit approval without suppressing the normal digest',async()=>{
  clock('2026-11-27T04:00:00Z');const e=env();
  let d=await buildDigest(e,new Date());assert.ok(d.markdown.includes('اخبار مهم اقتصادی امروز'));assert.ok(!d.markdown.includes('Early Close'));
  await writeConfig(e,'early_close_20261127_approved','on');d=await buildDigest(e,new Date());assert.ok(d.markdown.includes('Early Close'));
  await writeConfig(e,'early_close_20261127_approved','off');d=await buildDigest(e,new Date());assert.ok(!d.markdown.includes('Early Close'));
});
