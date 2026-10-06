'use strict';

// Run with: node --test tests/whatsapp.test.js
// Meta and Anthropic are faked, so no keys or network are needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me';
process.env.WHATSAPP_APP_SECRET = 'app-secret';
process.env.WHATSAPP_ACCESS_TOKEN = 'meta-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
process.env.ANTHROPIC_API_KEY = 'test-key';

const handler = require('../api/whatsapp.js');

const calls = { anthropic: [], graph: [] };
let claudeReply = () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'Hola, soy el asistente de LiSync.' }] }) });

globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  if (String(url).includes('api.anthropic.com')) {
    calls.anthropic.push({ body, headers: options.headers });
    return claudeReply();
  }
  calls.graph.push({ url: String(url), body, headers: options.headers });
  return { ok: true, status: 200, json: async () => ({}) };
};

const server = http.createServer(handler);
let base;
test.before(() => new Promise((resolve) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); })));
test.after(() => server.close());
test.beforeEach(() => { calls.anthropic.length = 0; calls.graph.length = 0; });

function request(method, path, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + path, { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, text: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const sign = (raw) => 'sha256=' + crypto.createHmac('sha256', 'app-secret').update(raw).digest('hex');

let counter = 0;
function webhook({ from = '34600000001', type = 'text', text = 'Hola', id, timestamp } = {}) {
  counter += 1;
  const message = { from, id: id || `wamid.${counter}`, type, timestamp: String(timestamp ?? Math.floor(Date.now() / 1000)) };
  if (type === 'text') message.text = { body: text };
  return { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [message] } }] }] };
}

function post(payload, { signature } = {}) {
  const raw = Buffer.from(JSON.stringify(payload), 'utf8');
  return request('POST', '/api/whatsapp', { body: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature ?? sign(raw) } });
}

const sentTexts = () => calls.graph.filter((c) => c.body.type === 'text').map((c) => c.body.text.body);

test('GET verification returns the challenge for the right token', async () => {
  const res = await request('GET', '/api/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc123');
  assert.equal(res.status, 200);
  assert.equal(res.text, 'abc123');
});

test('GET verification rejects a wrong token', async () => {
  const res = await request('GET', '/api/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc123');
  assert.equal(res.status, 403);
});

test('POST with a bad signature is rejected and costs nothing', async () => {
  const res = await post(webhook(), { signature: 'sha256=' + '0'.repeat(64) });
  assert.equal(res.status, 401);
  assert.equal(calls.anthropic.length, 0);
  assert.equal(calls.graph.length, 0);
});

test('POST with no signature is rejected', async () => {
  const res = await request('POST', '/api/whatsapp', { body: JSON.stringify(webhook()), headers: { 'content-type': 'application/json' } });
  assert.equal(res.status, 401);
  assert.equal(calls.anthropic.length, 0);
});

test('a text message gets a Claude reply sent to the same number', async () => {
  claudeReply = () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '**Hola**, ¿qué necesitas?' }] }) });
  const res = await post(webhook({ from: '34611111111', text: 'Quiero una web con ñ y tildes: café' }));
  assert.equal(res.status, 200);

  assert.equal(calls.anthropic.length, 1);
  assert.equal(calls.anthropic[0].headers['x-api-key'], 'test-key');
  assert.match(calls.anthropic[0].body.system, /LiSync/);
  assert.deepEqual(calls.anthropic[0].body.messages, [{ role: 'user', content: 'Quiero una web con ñ y tildes: café' }]);

  const send = calls.graph.find((c) => c.body.type === 'text');
  assert.match(send.url, /\/1234567890\/messages$/);
  assert.equal(send.headers.authorization, 'Bearer meta-token');
  assert.equal(send.body.to, '34611111111');
  assert.equal(send.body.text.body, '*Hola*, ¿qué necesitas?');
  assert.ok(calls.graph.some((c) => c.body.status === 'read'), 'marks the message as read');
});

test('follow-up messages carry the earlier conversation', async () => {
  const from = '34622222222';
  await post(webhook({ from, text: 'Hola' }));
  await post(webhook({ from, text: '¿Y cuánto cuesta?' }));
  assert.deepEqual(calls.anthropic[1].body.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(calls.anthropic[1].body.messages[2].content, '¿Y cuánto cuesta?');
});

test('non-text messages get a canned reply without calling Claude', async () => {
  const res = await post(webhook({ type: 'image', from: '34633333333' }));
  assert.equal(res.status, 200);
  assert.equal(calls.anthropic.length, 0);
  assert.match(sentTexts()[0], /mensajes de texto/);
});

test('delivery-status events are acknowledged and ignored', async () => {
  const payload = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'x', status: 'delivered' }] } }] }] };
  const res = await post(payload);
  assert.equal(res.status, 200);
  assert.equal(calls.anthropic.length, 0);
  assert.equal(calls.graph.length, 0);
});

test('a retried message (same id) is answered only once', async () => {
  const payload = webhook({ from: '34644444444', id: 'wamid.dup' });
  await post(payload);
  await post(payload);
  assert.equal(calls.anthropic.length, 1);
});

test('stale messages are ignored', async () => {
  const res = await post(webhook({ from: '34655555555', timestamp: Math.floor(Date.now() / 1000) - 3600 }));
  assert.equal(res.status, 200);
  assert.equal(calls.anthropic.length, 0);
  assert.equal(calls.graph.length, 0);
});

test('if Claude fails, the customer gets a fallback and Meta still gets 200', async () => {
  claudeReply = () => ({ ok: false, status: 529, json: async () => ({ error: { type: 'overloaded_error' } }) });
  const res = await post(webhook({ from: '34666666666' }));
  assert.equal(res.status, 200);
  assert.match(sentTexts()[0], /lisyncbussines@gmail\.com/);
});

test('a failed Claude call does not poison the conversation history', async () => {
  const from = '34677777777';
  claudeReply = () => ({ ok: false, status: 500, json: async () => ({}) });
  await post(webhook({ from, text: 'primero' }));
  claudeReply = () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) });
  calls.anthropic.length = 0;
  await post(webhook({ from, text: 'segundo' }));
  assert.deepEqual(calls.anthropic[0].body.messages, [{ role: 'user', content: 'segundo' }]);
});

test('one number cannot burn unlimited tokens: it is cut off after 30 messages an hour', async () => {
  claudeReply = () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) });
  const from = '34688888888';
  for (let i = 0; i < 35; i += 1) await post(webhook({ from, text: `m${i}` }));
  assert.equal(calls.anthropic.length, 30);
  assert.equal(sentTexts().filter((t) => /muchos mensajes/.test(t)).length, 1, 'notified exactly once');
});

test('unsupported methods are refused', async () => {
  const res = await request('DELETE', '/api/whatsapp');
  assert.equal(res.status, 405);
});
