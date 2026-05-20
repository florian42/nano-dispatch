import { describe, expect, it } from 'vitest';
import { dispatch } from '../../src/dispatcher/dispatch.js';
import type { DispatchPayload, DispatchConfig, Sender } from '../../src/dispatcher/types.js';

type Call = Parameters<Sender['sendDocument']>[0];

function stubSender(responses: readonly ({ messageId: number } | Error)[]): {
  sender: Sender;
  calls: Call[];
} {
  const calls: Call[] = [];
  let i = 0;
  const sender: Sender = {
    sendDocument: (input) => {
      calls.push(input);
      const next = responses[i] ?? responses[responses.length - 1];
      i += 1;
      if (next === undefined) return Promise.reject(new Error('no stub response'));
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next);
    },
  };
  return { sender, calls };
}

const config: DispatchConfig = {
  apiId: 12345,
  apiHash: 'HASH',
  session: 'SESSION',
  peer: '@nanoclaw',
};

const payload: DispatchPayload = {
  url: 'https://example.com/post',
  title: 'Hello',
  bodyHtml: '<p>a page</p>',
};

describe('dispatch', () => {
  it('sends one document with the composed caption + HTML body to the configured peer', async () => {
    const { sender, calls } = stubSender([{ messageId: 42 }]);

    const result = await dispatch(payload, config, sender);

    expect(result).toEqual({ ok: true, messageIds: [42] });
    expect(calls).toHaveLength(1);

    const call = calls[0]!;
    expect(call.peer).toBe('@nanoclaw');
    expect(call.caption).toBe('source: browser\n\nHello\nhttps://example.com/post');
    expect(call.fileName).toBe('hello.html');
    expect(call.mimeType).toBe('text/html');

    const text = new TextDecoder().decode(call.fileBytes);
    expect(text.startsWith('<!doctype html>')).toBe(true);
    expect(text).toContain('<p>a page</p>');
  });

  it('maps AUTH_KEY_UNREGISTERED → unauthorized', async () => {
    const { sender } = stubSender([new Error('AUTH_KEY_UNREGISTERED')]);
    const result = await dispatch(payload, config, sender);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unauthorized');
  });

  it('maps PEER_ID_INVALID → bad_chat', async () => {
    const { sender } = stubSender([new Error('PEER_ID_INVALID')]);
    const result = await dispatch(payload, config, sender);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_chat');
  });

  it('maps FLOOD_WAIT_<n> → rate_limited and surfaces the wait seconds', async () => {
    const { sender } = stubSender([new Error('FLOOD_WAIT_30')]);
    const result = await dispatch(payload, config, sender);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('rate_limited');
      expect(result.detail).toContain('retry_after=30');
    }
  });

  it('maps NETWORK_ERROR (transport failure from the Sender adapter) → network', async () => {
    const { sender } = stubSender([new Error('NETWORK_ERROR: ECONNREFUSED')]);
    const result = await dispatch(payload, config, sender);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('network');
  });

  it('falls through to unknown and preserves the original message in detail', async () => {
    const { sender } = stubSender([new Error('INTERNAL_SERVER_ERROR')]);
    const result = await dispatch(payload, config, sender);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unknown');
      expect(result.detail).toContain('INTERNAL_SERVER_ERROR');
    }
  });
});
