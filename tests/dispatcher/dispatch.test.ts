import { describe, expect, it } from 'vitest';
import { dispatch } from '../../src/dispatcher/dispatch.js';
import type { DispatchPayload, DispatchConfig } from '../../src/dispatcher/types.js';

type Call = { url: string; body: unknown };

function stubFetch(responses: readonly (Response | Error)[]) {
  const calls: Call[] = [];
  let i = 0;
  const fn: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : '';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body;
    calls.push({ url, body });
    const next = responses[i] ?? responses[responses.length - 1];
    i += 1;
    if (next === undefined) return Promise.reject(new Error('no stub response'));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next.clone());
  };
  return { fn, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const config: DispatchConfig = { botToken: 'TKN', chatId: 'CHAT' };
const payload: DispatchPayload = {
  url: 'https://example.com/post',
  title: 'Hello',
  bodyMarkdown: 'a page',
};

describe('dispatch', () => {
  it('posts a single sendMessage to api.telegram.org with the composed body and returns the message id', async () => {
    const { fn, calls } = stubFetch([jsonResponse({ ok: true, result: { message_id: 42 } })]);

    const result = await dispatch(payload, config, fn);

    expect(result).toEqual({ ok: true, messageIds: [42] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.telegram.org/botTKN/sendMessage');
    expect(calls[0]?.body).toEqual({
      chat_id: 'CHAT',
      text: 'source: browser\n\n# Hello\nhttps://example.com/post\n\n## Page\na page',
      disable_web_page_preview: true,
    });
  });

  it('returns each message_id when the body splits across multiple sendMessage calls', async () => {
    const longPage = 'long '.repeat(2000); // ~10000 chars
    const { fn, calls } = stubFetch([
      jsonResponse({ ok: true, result: { message_id: 1 } }),
      jsonResponse({ ok: true, result: { message_id: 2 } }),
      jsonResponse({ ok: true, result: { message_id: 3 } }),
    ]);

    const result = await dispatch({ ...payload, bodyMarkdown: longPage }, config, fn);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.messageIds.length).toBeGreaterThan(1);
      expect(result.messageIds).toEqual(
        calls.map((_, i) => i + 1).slice(0, result.messageIds.length),
      );
    }
    // Every part body carries the (n/N) marker.
    const N = calls.length;
    calls.forEach((c, i) => {
      const text = (c.body as { text: string }).text;
      expect(text.startsWith(`source: browser\n(${i + 1}/${N})\n\n`)).toBe(true);
    });
  });

  it('maps 401 → unauthorized', async () => {
    const { fn } = stubFetch([
      jsonResponse({ ok: false, error_code: 401, description: 'Unauthorized' }, 401),
    ]);
    const result = await dispatch(payload, config, fn);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unauthorized');
  });

  it('maps 400 with "chat not found" → bad_chat', async () => {
    const { fn } = stubFetch([
      jsonResponse({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }, 400),
    ]);
    const result = await dispatch(payload, config, fn);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_chat');
  });

  it('maps 429 → rate_limited and includes retry_after in detail', async () => {
    const { fn } = stubFetch([
      jsonResponse(
        {
          ok: false,
          error_code: 429,
          description: 'Too Many Requests',
          parameters: { retry_after: 7 },
        },
        429,
      ),
    ]);
    const result = await dispatch(payload, config, fn);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('rate_limited');
      expect(result.detail).toContain('retry_after=7');
    }
  });

  it('maps fetch rejection → network', async () => {
    const { fn } = stubFetch([new Error('network down')]);
    const result = await dispatch(payload, config, fn);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('network');
  });

  it('falls through to "unknown" for unrecognised error responses', async () => {
    const { fn } = stubFetch([
      jsonResponse({ ok: false, error_code: 500, description: 'Internal Server Error' }, 500),
    ]);
    const result = await dispatch(payload, config, fn);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unknown');
      expect(result.detail).toContain('Internal Server Error');
    }
  });

  it('on partial failure, lists sent message_ids and the failing part in detail', async () => {
    const longPage = 'long '.repeat(2000);
    const { fn } = stubFetch([
      jsonResponse({ ok: true, result: { message_id: 11 } }),
      jsonResponse(
        {
          ok: false,
          error_code: 429,
          description: 'Too Many Requests',
          parameters: { retry_after: 2 },
        },
        429,
      ),
    ]);
    const result = await dispatch({ ...payload, bodyMarkdown: longPage }, config, fn);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('rate_limited');
      expect(result.detail).toContain('sent message_ids: [11]');
      expect(result.detail).toMatch(/failed at part 2\/\d+/);
    }
  });
});
