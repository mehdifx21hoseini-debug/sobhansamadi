import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHmac } from "node:crypto";
import { checkChannelMembership, memberFetch, requireChannelMembership } from "../src/channelMembership.js";
import { membershipGate } from "../src/membershipGate.js";
import { handleMiniapp } from "../src/econ/miniapp.js";
import { createBot } from "../src/bot.js";
import { runNotice, batchProgress, ensureSentSchema, resetSnapshotMemo } from "../src/econ/sender.js";
import { ensureSubscriberSchema } from "../src/econ/subscribers.js";
import { writeConfig } from "../src/content/channel.js";
import { telegramSender } from "../src/crm/telegramSend.js";
import { clearAll } from "../src/cache.js";

const TOKEN = "123456:unit-test";
let membership, failure, calls;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
function environment() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE user_state (telegram_user_id TEXT PRIMARY KEY, current_flow TEXT, current_step TEXT,
    temp_data TEXT, phone TEXT, intro_progress INTEGER DEFAULT 0, source_first_seen TEXT, last_interaction_at TEXT, blocked_at TEXT)`);
  const DB = { raw, prepare(sql) {
    let args = [];
    return { bind(...a) { args = a; return this; },
      async run() { const r = raw.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
      async first() { return raw.prepare(sql).get(...args) || null; },
      async all() { return { results: raw.prepare(sql).all(...args) }; },
    };
  }, async batch(items) { return Promise.all(items.map(item => item.run())); } };
  return { BOT_TOKEN: TOKEN, DB };
}
beforeEach(() => {
  clearAll(); resetSnapshotMemo(); calls = []; membership = { status: "member" }; failure = null;
  globalThis.fetch = async (url, init = {}) => {
    const method = String(url).split('/').pop();
    const body = init.body instanceof FormData ? { chat_id: init.body.get('chat_id') } : JSON.parse(init.body || '{}');
    calls.push({ method, body });
    if (method === 'getChatMember') {
      if (failure === 'network') throw new Error('offline');
      if (failure === 'malformed') return json({ ok: true });
      if (failure === '429') return json({ ok: false, parameters: { retry_after: 23 } }, 429);
      if (failure === '403') return json({ ok: false }, 403);
      return json({ ok: true, result: typeof membership === 'function' ? membership(body) : membership });
    }
    return json({ ok: true, result: { message_id: 1, chat: { id: Number(body.chat_id), type: 'private' }, date: 0 } });
  };
});
const deliveries = () => calls.filter(x => x.method !== 'getChatMember');

await test('every supported membership status and no positive membership cache', async () => {
  const env = environment();
  for (const [status, is_member, allowed] of [['member', null, true], ['creator', null, true], ['administrator', null, true], ['left', null, false], ['kicked', null, false], ['restricted', false, false], ['restricted', true, true], ['unknown', null, false]]) {
    membership = { status, is_member };
    assert.equal((await checkChannelMembership(env, 42)).member, allowed, status);
  }
  assert.equal(calls.length, 8);
});
await test('API failures, malformed replies and unavailable channel configuration deny access', async () => {
  const env = environment();
  for (const error of ['network', 'malformed', '429', '403']) {
    failure = error;
    const r = await checkChannelMembership(env, 42);
    assert.equal(r.member, false); assert.equal(r.reason, 'unavailable');
    await assert.rejects(requireChannelMembership(env, 42), { name: 'ChannelMembershipError' });
  }
  const bad = { BOT_TOKEN: TOKEN, DB: { prepare() { throw Error('D1 offline'); } } };
  const before = calls.length; assert.equal((await checkChannelMembership(bad,42)).member,false);assert.equal(calls.length,before);
});
await test('uses the configured channel, not a stale cached/default channel', async () => {
  const env=environment();await checkChannelMembership(env,42);
  env.DB.raw.prepare('INSERT INTO bot_links(key,url) VALUES (?,?)').run('TG_CHANNEL','https://t.me/another_academy');
  await checkChannelMembership(env,42);assert.equal(calls.at(-1).body.chat_id,'@another_academy');
});
await test('raw text, media, forwards, updates and multipart files never reach non-members', async () => {
  const env=environment();membership={status:'left'};
  for(const method of ['sendMessage','sendPhoto','sendVideo','forwardMessage','copyMessage','sendDocument','sendRichMessage','editMessageText']){
    const response=await memberFetch(env,'https://api.telegram.org/bot'+TOKEN+'/'+method,{method:'POST',body:JSON.stringify({chat_id:'6923823275',text:'private'})});
    assert.equal(response.status,403);assert.equal((await response.json()).membership_required,true);
  }
  const body=new FormData();body.append('chat_id','42');body.append('document',new Blob(['private']),'x.txt');
  assert.equal((await memberFetch(env,'https://api.telegram.org/bot'+TOKEN+'/sendDocument',{method:'POST',body})).status,403);
  assert.equal(deliveries().length,0);
  assert.equal((await telegramSender(env)('42','private')).ok,false);
});
await test('API outage suppresses delivery and can never mark it accepted', async () => {
  const env=environment();failure='429';
  const r=await memberFetch(env,'https://api.telegram.org/bot'+TOKEN+'/sendMessage',{body:JSON.stringify({chat_id:42,text:'private'})});
  assert.equal(r.status,503);assert.equal((await r.json()).parameters.retry_after,23);assert.equal(deliveries().length,0);
});
await test('leaving after an accepted delivery blocks the very next delivery', async () => {
  const env=environment();const url='https://api.telegram.org/bot'+TOKEN+'/sendMessage';const init={body:JSON.stringify({chat_id:42,text:'private'})};
  assert.equal((await memberFetch(env,url,init)).status,200);membership={status:'left'};
  assert.equal((await memberFetch(env,url,init)).status,403);assert.equal(deliveries().length,1);
});
await test('commands, old callbacks, owner and certificate admin have no bypass', async () => {
  const env=environment();membership={status:'left'};
  for(const id of [42,6923823275,171937271,6929332443]) {
    for(const data of [undefined,'CHECK_MEMBERSHIP','EXPERT_DOWNLOAD']) {
      let passed=false;
      const ctx={env,from:{id},chat:{id,type:'private'},message:{text:'/start'},callbackQuery:data?{data}:undefined,answerCallbackQuery:async()=>{}};
      await membershipGate()(ctx,async()=>{passed=true});assert.equal(passed,false);
    }
  }
  assert.ok(deliveries().every(x=>x.body.text.includes('عضویت') && x.body.reply_markup));
});
await test('membership middleware accepts a rejoined user, rejects groups and fails closed on outage', async () => {
  const env=environment();let passed=0;
  const ctx={env,from:{id:42},chat:{id:42,type:'private'}};
  await membershipGate()(ctx,async()=>passed++);assert.equal(passed,1);
  membership={status:'left'};await membershipGate()(ctx,async()=>passed++);assert.equal(passed,1);
  membership={status:'member'};await membershipGate()(ctx,async()=>passed++);assert.equal(passed,2);
  failure='network';await membershipGate()(ctx,async()=>passed++);assert.equal(passed,2);
  await membershipGate()({...ctx,chat:{id:-1,type:'group'}},async()=>passed++);assert.equal(passed,2);
});
function initData(id=42){
  const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id,first_name:'Test'})});
  const data=[...p].map(([k,v])=>k+'='+v).sort().join('\n');const secret=createHmac('sha256','WebAppData').update(TOKEN).digest();p.set('hash',createHmac('sha256',secret).update(data).digest('hex'));return p.toString();
}
await test('miniapp denies data, AI and subscriptions for a valid Telegram user who left', async () => {
  const env=environment();membership={status:'left'};
  for(const action of ['data','explain','subscribe','membership']){
    const r=await handleMiniapp(new Request('https://example/econ/miniapp',{method:'POST',body:JSON.stringify({action,initData:initData()})}),env);
    assert.equal(r.status,403);assert.equal((await r.json()).membership_required,true);
  }
  assert.equal(deliveries().length,0);
  membership={status:'member'};
  const r=await handleMiniapp(new Request('https://example/econ/miniapp',{method:'POST',body:JSON.stringify({action:'membership',initData:initData()})}),env);assert.equal(r.status,200);
});
await test('grammY transport also checks recipients, including calls outside message handlers', async () => {
  const env=environment();const bot=createBot(TOKEN,env,{id:999,is_bot:true,first_name:'Test',username:'test_bot'});
  membership={status:'left'};
  await assert.rejects(bot.api.sendMessage(6923823275,'private'),{name:'ChannelMembershipError'});
  assert.equal(deliveries().length,0);
  membership={status:'member'};await bot.api.sendMessage(42,'allowed');assert.equal(deliveries().length,1);
});
await test('scheduled broadcast skips non-members without marking them blocked or delivering content', async () => {
  const env=environment();await writeConfig(env,'econ_worker_sender','on');await writeConfig(env,'econ_notice','on');await ensureSubscriberSchema(env);await ensureSentSchema(env);
  env.DB.raw.exec("INSERT INTO user_state(telegram_user_id) VALUES ('42')");membership={status:'left'};
  await runNotice(env,new Date('2026-11-26T12:00:00Z'),{of:6,index:0},{campaignDriver:true});
  const b=await batchProgress(env,'notice','2026-11-24-bep20-video');
  assert.equal(b.sent,0);assert.equal(b.membership_skipped,1);assert.equal(b.blocked,0);assert.equal(deliveries().length,0);
  assert.equal(env.DB.raw.prepare("SELECT blocked_at FROM user_state WHERE telegram_user_id='42'").get().blocked_at,null);
});
