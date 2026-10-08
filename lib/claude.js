'use strict';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

async function askClaude({ system, messages, maxTokens = 400, timeoutMs = 20_000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: maxTokens,
        system,
        messages,
      }),
      signal: controller.signal,
    });

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
    return text;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { askClaude };
