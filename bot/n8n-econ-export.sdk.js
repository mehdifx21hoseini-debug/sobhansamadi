// کد SDK گردش‌کار WF-Econ-Export در n8n - تنها نقطه‌ای که ورکر از n8n
// داده می‌گیرد.
//
// این گردش‌کار فقط می‌خواند: چهار جدول تقویم را برمی‌دارد و به‌صورت JSON
// برمی‌گرداند. عمداً جدا از WF-Economic-Calendar (۱۳۴ نود، چهار زمان‌بند
// فعال) ساخته شده تا دست بردن در آن لازم نباشد.
//
// اینجا نگه داشته می‌شود تا اگر گردش‌کار در n8n پاک یا خراب شد، از همین
// فایل بشود دوباره ساختش. با mcp create_workflow_from_code ساخته می‌شود.
//
// کلید مشترک عمداً اینجا نیست. این مخزن عمومی است، پس هر چیزی که در آن
// کامیت شود برای همیشه در تاریخچه‌ی گیت عمومی می‌ماند - حتی اگر بعداً
// پاکش کنیم. موقع بازسازی، REPLACE_WITH_SHARED_KEY را با همان مقداری
// عوض کنید که در ECON_EXPORT_KEY کلادفلر نشسته، و نتیجه را کامیت نکنید.

import { workflow, node, trigger, ifElse, expr } from '@n8n/workflow-sdk';

const hook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Export Webhook',
    parameters: {
      httpMethod: 'POST',
      path: 'econ/export',
      responseMode: 'responseNode',
      options: {},
    },
  },
});

const checkKey = ifElse({
  version: 2.2,
  config: {
    name: 'Check Key',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 1 },
        conditions: [
          {
            leftValue: expr('{{ $json.body.key }}'),
            operator: { type: 'string', operation: 'equals' },
            rightValue: 'REPLACE_WITH_SHARED_KEY',
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  },
});

const getEvents = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Export Get Events',
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'id', value: 'k4SSI7xHeLsgqN1v', cachedResultName: 'econ_calendar_events' },
      returnAll: true,
    },
  },
});

const getLabels = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Export Get Labels',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'id', value: 'yCBiAKi244SN2v1M', cachedResultName: 'econ_event_labels' },
      returnAll: true,
    },
  },
});

const getHolidays = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Export Get Holidays',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'id', value: 'cvTe5Y21HGuN4wVw', cachedResultName: 'econ_calendar_holidays' },
      returnAll: true,
    },
  },
});

const getCache = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Export Get AI Cache',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'id', value: 'tVwx8QE4l9xVWi80', cachedResultName: 'econ_ai_cache' },
      returnAll: true,
    },
  },
});

const buildPayload = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Export Payload',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "// Read-only snapshot for the Cloudflare Worker mirror. Nothing here writes\n// back to the calendar tables, so this endpoint cannot disturb the\n// ingestion schedules that own them.\nfunction rows(name) {\n  try { return $(name).all().map(i => i.json).filter(r => r && Object.keys(r).length > 0); }\n  catch (e) { return []; }\n}\n\n// Only a window around today is useful to the bot: the today and week views\n// never look further out, and shipping the full history would grow the\n// payload without changing a single rendered message.\nfunction ymd(d) { return d.toISOString().slice(0, 10); }\nconst now = new Date();\nconst from = new Date(now.getTime() - 8 * 86400000);\nconst to = new Date(now.getTime() + 30 * 86400000);\nconst lo = ymd(from), hi = ymd(to);\n\nconst events = rows('Export Get Events')\n  .filter(r => r.event_id && r.date && String(r.date) >= lo && String(r.date) <= hi)\n  .map(r => ({\n    event_id: r.event_id, date: r.date, time: r.time, event: r.event,\n    event_fa: r.event_fa, importance: r.importance, forecast: r.forecast,\n    previous: r.previous, actual: r.actual, status: r.status,\n    source: r.source, last_updated: r.last_updated,\n  }));\n\nconst labels = rows('Export Get Labels')\n  .filter(r => r.match_text)\n  .map(r => ({\n    match_text: r.match_text, label_fa: r.label_fa,\n    label_short_en: r.label_short_en, direction: r.direction,\n    priority: r.priority, active: r.active,\n  }));\n\nconst holidays = rows('Export Get Holidays')\n  .filter(r => r.date && String(r.date) >= lo && String(r.date) <= hi)\n  .map(r => ({\n    date: r.date, name: r.name, name_fa: r.name_fa,\n    country: r.country, market_status: r.market_status,\n  }));\n\n// The AI answers are the whole reason n8n stays in the loop, so they ship\n// whole - but only today's, since the bot only ever reads today's key.\nconst todayKey = ymd(now);\nconst ai_cache = rows('Export Get AI Cache')\n  .filter(r => r.cache_key && r.answer && String(r.cache_key).indexOf(todayKey) === 0)\n  .map(r => ({ cache_key: r.cache_key, answer: r.answer, created_at: r.created_at }));\n\nreturn [{ json: { success: true, generated_at: new Date().toISOString(), events, labels, holidays, ai_cache } }];",
    },
  },
});

const respondOk = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond Export',
    parameters: {
      respondWith: 'firstIncomingItem',
      options: {},
    },
  },
});

const respondDenied = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond Denied',
    parameters: {
      respondWith: 'json',
      responseBody: '={{ { success: false, error: "unauthorized" } }}',
      options: { responseCode: 401 },
    },
  },
});

export default workflow('wf-econ-export', 'WF-Econ-Export')
  .add(hook)
  .to(
    checkKey
      .onTrue(getEvents.to(getLabels.to(getHolidays.to(getCache.to(buildPayload.to(respondOk))))))
      .onFalse(respondDenied)
  );
