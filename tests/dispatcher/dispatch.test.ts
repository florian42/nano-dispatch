import { describe, expect, it } from 'vitest';
import { dispatch } from '../../src/dispatcher/dispatch.js';
import type { DispatchPayload, DispatchConfig, Sender } from '../../src/dispatcher/types.js';

type Call = Parameters<Sender['sendDocuments']>[0];

function stubSender(response: { messageIds: number[] } | Error): {
  sender: Sender;
  calls: Call[];
} {
  const calls: Call[] = [];
  const sender: Sender = {
    sendDocuments: (input) => {
      calls.push(input);
      if (response instanceof Error) return Promise.reject(response);
      return Promise.resolve(response);
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
  it('sends one page document (no selection) with the composed caption to the configured peer', async () => {
    const { sender, calls } = stubSender({ messageIds: [42] });

    const result = await dispatch(payload, config, sender);

    expect(result).toEqual({ ok: true, messageIds: [42] });
    expect(calls).toHaveLength(1);

    const call = calls[0]!;
    expect(call.peer).toBe('@nanoclaw');
    expect(call.files).toHaveLength(1);

    const page = call.files[0]!;
    expect(page.caption).toBe('source: browser\n\nHello\nhttps://example.com/post');
    expect(page.fileName).toBe('page-hello.html');
    expect(page.mimeType).toBe('text/html');

    const text = new TextDecoder().decode(page.fileBytes);
    expect(text.startsWith('<!doctype html>')).toBe(true);
    expect(text).toContain('<p>a page</p>');
  });

  it('sends page + selection as a two-file album when a selection is present', async () => {
    const { sender, calls } = stubSender({ messageIds: [42, 43] });

    const result = await dispatch(
      { ...payload, selection: 'the highlighted quote' },
      config,
      sender,
    );

    expect(result).toEqual({ ok: true, messageIds: [42, 43] });
    expect(calls[0]!.files).toHaveLength(2);

    const [page, selection] = calls[0]!.files;
    expect(page!.fileName).toBe('page-hello.html');
    expect(selection!.fileName).toBe('selection-hello.txt');
    expect(selection!.mimeType).toBe('text/plain');

    // The selection file carries the full highlight and a role marker.
    const selText = new TextDecoder().decode(selection!.fileBytes);
    expect(selText).toContain('role: selection');
    expect(selText).toContain('the highlighted quote');

    // The page document does NOT duplicate the selection.
    const pageText = new TextDecoder().decode(page!.fileBytes);
    expect(pageText).not.toContain('the highlighted quote');
  });

  it('maps AUTH_KEY_UNREGISTERED → unauthorized', async () => {
    const { sender } = stubSender(new Error('AUTH_KEY_UNREGISTERED'));
    const result = await dispatch(payload, config, sender);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unauthorized');
  });

  it('maps PEER_ID_INVALID → bad_chat', async () => {
    const { sender } = stubSender(new Error('PEER_ID_INVALID'));
    const result = await dispatch(payload, config, sender);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_chat');
  });

  it('maps FLOOD_WAIT_<n> → rate_limited and surfaces the wait seconds', async () => {
    const { sender } = stubSender(new Error('FLOOD_WAIT_30'));
    const result = await dispatch(payload, config, sender);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('rate_limited');
      expect(result.detail).toContain('retry_after=30');
    }
  });

  it('maps NETWORK_ERROR (transport failure from the Sender adapter) → network', async () => {
    const { sender } = stubSender(new Error('NETWORK_ERROR: ECONNREFUSED'));
    const result = await dispatch(payload, config, sender);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('network');
  });

  it('falls through to unknown and preserves the original message in detail', async () => {
    const { sender } = stubSender(new Error('INTERNAL_SERVER_ERROR'));
    const result = await dispatch(payload, config, sender);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unknown');
      expect(result.detail).toContain('INTERNAL_SERVER_ERROR');
    }
  });
});
