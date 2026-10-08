'use strict';

// Public demo chat for the website. Anyone on the internet can reach this URL
// and every call costs money, so it is deliberately small and defensive.

const { WEB_SYSTEM_PROMPT } = require('../lib/lisync-assistant');
const { askClaude } = require('../lib/claude');

const MAX_BODY_BYTES = 8 * 1024;
const MAX_MESSAGES = 12;
const MAX_CHARS = 400;
const MAX_TOKENS = 350;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_TRACKED_IPS = 1000;

const hits = new Map();

function send(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  res.end(JSON.stringify(body));
}

function allowedOrigins() {
  return (process.env.CHAT_ALLOWED_ORIGINS || 'https://lisync.eu,https://www.lisync.eu')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

function overLimit(ip) {
  const now = Date.now();
  let entry = hits.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    entry = { start: now, count: 0 };
    hits.set(ip, entry);
    if (hits.size > MAX_TRACKED_IPS) hits.delete(hits.keys().next().value);
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT ? Math.ceil((entry.start + RATE_WINDOW_MS - now) / 1000) : 0;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Returns clean {role, content}[] or null. Must start with the visitor and
// alternate, ending on a visitor message, which is what the API requires.
function cleanMessages(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MESSAGES) return null;
  const messages = [];
  for (let i = 0; i < input.length; i += 1) {
    const { role, content } = input[i] || {};
    const expected = i % 2 === 0 ? 'user' : 'assistant';
    if (role !== expected || typeof content !== 'string') return null;
    const text = content.trim();
    if (!text || text.length > MAX_CHARS) return null;
    messages.push({ role, content: text });
  }
  return messages[messages.length - 1].role === 'user' ? messages : null;
}

async function handler(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { allow: 'POST' });

    if (!allowedOrigins().includes(req.headers.origin)) return send(res, 403, { error: 'forbidden' });

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY is not set');
      return send(res, 503, { error: 'not configured' });
    }

    const retryAfter = overLimit(clientIp(req));
    if (retryAfter) {
      return send(res, 429, { error: 'too many requests' }, { 'retry-after': String(retryAfter) });
    }

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (error) {
      if (error.status === 413) return send(res, 413, { error: 'too large' }, { connection: 'close' });
      return send(res, 400, { error: 'bad request' });
    }

    const messages = cleanMessages(payload?.messages);
    if (!messages) return send(res, 400, { error: 'bad request' });

    try {
      const reply = await askClaude({ system: WEB_SYSTEM_PROMPT, messages, maxTokens: MAX_TOKENS });
      return send(res, 200, { reply });
    } catch (error) {
      console.error(`chat upstream error: ${error.message}`);
      return send(res, 502, { error: 'upstream error' });
    }
  } catch (error) {
    console.error(`chat error: ${error.message}`);
    return send(res, 500, { error: 'error' });
  }
}

module.exports = handler;
