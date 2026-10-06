'use strict';

// WhatsApp Cloud API webhook: answers incoming messages with Claude.
// GET  = Meta's one-time webhook verification.
// POST = incoming events (signature-checked before anything else happens).

const crypto = require('crypto');
const {
  SYSTEM_PROMPT,
  FALLBACK_NON_TEXT,
  FALLBACK_ERROR,
  FALLBACK_RATE_LIMIT,
} = require('../lib/lisync-assistant');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_GRAPH_VERSION = 'v23.0';

const MAX_INPUT_CHARS = 1000;
const MAX_REPLY_CHARS = 1500;
const MAX_TOKENS = 400;
const MAX_BODY_BYTES = 1_000_000;
const MAX_MESSAGE_AGE_S = 300;
const HISTORY_MESSAGES = 10;
const HISTORY_TTL_MS = 30 * 60 * 1000;
const MAX_MESSAGES_PER_HOUR = 30;
const MAX_TRACKED = 500;

// Best-effort memory. A serverless instance can be recycled at any time, so
// this only helps while it stays warm; nothing here is relied on for safety.
const histories = new Map();
const seenIds = new Set();
const rateWindows = new Map();

const env = (name) => process.env[name] || '';
const mask = (waId) => `…${String(waId).slice(-4)}`;

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function safeEqual(a, b) {
  return crypto.timingSafeEqual(digest(a), digest(b));
}

function validSignature(rawBody, header, secret) {
  if (!secret || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(expected, header.slice('sha256='.length));
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (req.readableEnded) return resolve(Buffer.alloc(0));
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function seenBefore(id) {
  if (seenIds.has(id)) return true;
  seenIds.add(id);
  if (seenIds.size > MAX_TRACKED) seenIds.delete(seenIds.values().next().value);
  return false;
}

function rateCheck(waId) {
  const now = Date.now();
  let entry = rateWindows.get(waId);
  if (!entry || now - entry.start > 3_600_000) {
    entry = { start: now, count: 0, notified: false };
    rateWindows.set(waId, entry);
    if (rateWindows.size > MAX_TRACKED) rateWindows.delete(rateWindows.keys().next().value);
  }
  entry.count += 1;
  if (entry.count <= MAX_MESSAGES_PER_HOUR) return 'ok';
  if (!entry.notified) {
    entry.notified = true;
    return 'notify';
  }
  return 'ignore';
}

function getHistory(waId) {
  const now = Date.now();
  let entry = histories.get(waId);
  if (!entry || now - entry.touched > HISTORY_TTL_MS) {
    entry = { turns: [], touched: now };
    histories.set(waId, entry);
    if (histories.size > MAX_TRACKED) histories.delete(histories.keys().next().value);
  }
  entry.touched = now;
  return entry;
}

function toWhatsAppFormat(text) {
  return text
    .replace(/\*\*(.+?)\*\*/gs, '*$1*')
    .replace(/^#{1,6}\s*/gm, '')
    .trim()
    .slice(0, MAX_REPLY_CHARS);
}

async function askClaude(waId, userText) {
  const history = getHistory(waId);
  const messages = [...history.turns, { role: 'user', content: userText }];

  const res = await fetchWithTimeout(
    ANTHROPIC_URL,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env('ANTHROPIC_API_KEY'),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env('ANTHROPIC_MODEL') || DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages,
      }),
    },
    20_000
  );

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(`anthropic ${res.status} ${detail?.error?.type || ''}`.trim());
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  if (!text) throw new Error('anthropic returned no text');

  const reply = toWhatsAppFormat(text);
  history.turns.push({ role: 'user', content: userText }, { role: 'assistant', content: reply });
  while (history.turns.length > HISTORY_MESSAGES) history.turns.splice(0, 2);
  return reply;
}

async function graphPost(payload) {
  const version = env('WHATSAPP_GRAPH_VERSION') || DEFAULT_GRAPH_VERSION;
  const url = `https://graph.facebook.com/${version}/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`;
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env('WHATSAPP_ACCESS_TOKEN')}`,
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    },
    10_000
  );
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(`whatsapp ${res.status} ${detail?.error?.message || ''}`.trim());
  }
}

const sendText = (to, body) => graphPost({ to, type: 'text', text: { body } });
const markRead = (messageId) => graphPost({ status: 'read', message_id: messageId });

async function handleMessage(message) {
  const { id, from, timestamp, type } = message;
  if (!id || !from || seenBefore(id)) return;

  if (Number(timestamp) && Date.now() / 1000 - Number(timestamp) > MAX_MESSAGE_AGE_S) {
    console.log(`skip stale message from ${mask(from)}`);
    return;
  }

  const read = markRead(id).catch(() => {});

  if (type !== 'text') {
    await sendText(from, FALLBACK_NON_TEXT);
    await read;
    return;
  }

  const text = String(message.text?.body || '').trim().slice(0, MAX_INPUT_CHARS);
  if (!text) return;

  const limit = rateCheck(from);
  if (limit === 'ignore') return;
  if (limit === 'notify') {
    await sendText(from, FALLBACK_RATE_LIMIT);
    return;
  }

  let reply;
  try {
    reply = await askClaude(from, text);
  } catch (error) {
    console.error(`claude failed for ${mask(from)}: ${error.message}`);
    reply = FALLBACK_ERROR;
  }

  await sendText(from, reply);
  await read;
  console.log(`replied to ${mask(from)} (in ${text.length} chars, out ${reply.length} chars)`);
}

function verifyWebhook(req, res) {
  const expected = env('WHATSAPP_VERIFY_TOKEN');
  if (!expected) {
    console.error('WHATSAPP_VERIFY_TOKEN is not set');
    res.statusCode = 500;
    return res.end('not configured');
  }
  const params = new URL(req.url, 'http://localhost').searchParams;
  const ok =
    params.get('hub.mode') === 'subscribe' &&
    params.get('hub.verify_token') &&
    safeEqual(params.get('hub.verify_token'), expected);

  if (!ok) {
    res.statusCode = 403;
    return res.end('forbidden');
  }
  res.statusCode = 200;
  res.setHeader('content-type', 'text/plain');
  return res.end(params.get('hub.challenge') || '');
}

async function receiveEvent(req, res) {
  const missing = [
    'ANTHROPIC_API_KEY',
    'WHATSAPP_APP_SECRET',
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
  ].filter((name) => !env(name));
  if (missing.length) {
    console.error(`missing environment variables: ${missing.join(', ')}`);
    res.statusCode = 500;
    return res.end('not configured');
  }

  const raw = await readRawBody(req);
  if (!validSignature(raw, req.headers['x-hub-signature-256'], env('WHATSAPP_APP_SECRET'))) {
    console.error('rejected webhook call: invalid signature');
    res.statusCode = 401;
    return res.end('invalid signature');
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    res.statusCode = 400;
    return res.end('bad json');
  }

  if (payload.object === 'whatsapp_business_account') {
    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        for (const message of change.value?.messages || []) {
          try {
            await handleMessage(message);
          } catch (error) {
            console.error(`could not handle message: ${error.message}`);
          }
        }
      }
    }
  }

  // Always 200 once the signature is valid, so Meta doesn't retry-storm us.
  res.statusCode = 200;
  return res.end('EVENT_RECEIVED');
}

async function handler(req, res) {
  try {
    if (req.method === 'GET') return verifyWebhook(req, res);
    if (req.method === 'POST') return await receiveEvent(req, res);
    res.statusCode = 405;
    res.setHeader('allow', 'GET, POST');
    return res.end();
  } catch (error) {
    console.error(`webhook error: ${error.message}`);
    res.statusCode = 500;
    return res.end('error');
  }
}

module.exports = handler;
// The signature is computed over the exact bytes Meta sent, so the body must stay raw.
module.exports.config = { api: { bodyParser: false } };
