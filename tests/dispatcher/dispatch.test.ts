import { describe, expect, it } from 'vitest';
import { dispatch } from '../../src/dispatcher/dispatch.js';
import type { DispatchPayload, DispatchConfig } from '../../src/dispatcher/types.js';

type Call = { url: string; form: FormData };

function stubFetch(responses: readonly (Response | Error)[]) {
  const calls: Call[] = [];
  let i = 0;
  const fn: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : '';
    const body = init?.body;
    if (!(body instanceof FormData)) {
      return Promise.reject(new Error('expected FormData body'));
    }
    calls.push({ url, form: body });
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
  bodyHtml: '<p>a page</p>',
};

describe('dispatch', () => {
  it('posts a single sendDocument with chat_id, caption, and the HTML body as a file', async () => {
    const { fn, calls } = stubFetch([jsonResponse({ ok: true, result: { message_id: 42 } })]);

    const result = await dispatch(payload, config, fn);

    expect(result).toEqual({ ok: true, messageIds: [42] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.telegram.org/botTKN/sendDocument');

    const form = calls[0]!.form;
    expect(form.get('chat_id')).toBe('CHAT');
    expect(form.get('caption')).toBe('source: browser\n\nHello\nhttps://example.com/post');

    const doc = form.get('document');
    expect(doc).toBeInstanceOf(File);
    if (doc instanceof File) {
      expect(doc.name).toBe('hello.html');
      expect(doc.type).toBe('text/html');
      const text = await doc.text();
      expect(text.startsWith('<!doctype html>')).toBe(true);
      expect(text).toContain('<p>a page</p>');
    }
  });

  it('sends a long page in one request (no chunking)', async () => {
    const longPage = 'long '.repeat(20000); // ~100k chars — would have been many sendMessage parts
    const { fn, calls } = stubFetch([jsonResponse({ ok: true, result: { message_id: 7 } })]);

    const result = await dispatch({ ...payload, bodyHtml: longPage }, config, fn);

    expect(result).toEqual({ ok: true, messageIds: [7] });
    expect(calls).toHaveLength(1);
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
});
