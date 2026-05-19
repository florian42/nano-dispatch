import { describe, expect, it } from 'vitest';
import { splitForTelegram, TELEGRAM_LIMIT } from '../../src/dispatcher/split.js';
import { composeBody } from '../../src/dispatcher/compose.js';

describe('splitForTelegram', () => {
  const base = {
    url: 'https://example.com/post',
    title: 'Hello',
    bodyMarkdown: '# Article\n\nfirst paragraph',
  };

  it('returns a single part identical to composeBody when under the limit', () => {
    const parts = splitForTelegram({ ...base, selection: 'q', note: 'n' });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(composeBody({ ...base, selection: 'q', note: 'n' }));
    expect(parts[0]).not.toMatch(/\(\d+\/\d+\)/);
  });

  it('splits long bodyMarkdown into ordered parts under the limit, each tagged with (n/N)', () => {
    const para = 'lorem ipsum dolor sit amet '.repeat(40); // ~1080 chars
    const longBody = Array.from({ length: 10 }, () => para).join('\n\n'); // ~10800 chars
    const parts = splitForTelegram({ ...base, bodyMarkdown: longBody });

    expect(parts.length).toBeGreaterThan(1);
    const N = parts.length;
    parts.forEach((part, i) => {
      expect(part.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
      expect(part.startsWith(`source: browser\n(${i + 1}/${N})\n\n`)).toBe(true);
    });
  });

  it('places the full structural frame only in part 1; parts 2..N are pure page continuation', () => {
    const longPage = 'paragraph '.repeat(2000); // ~20000 chars, no \n\n
    const parts = splitForTelegram({
      ...base,
      selection: 'the quote',
      note: 'the note',
      bodyMarkdown: longPage,
    });

    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toContain('# Hello');
    expect(parts[0]).toContain('## Selection');
    expect(parts[0]).toContain('the quote');
    expect(parts[0]).toContain('## Note');
    expect(parts[0]).toContain('the note');
    expect(parts[0]).toContain('## Page');

    for (const part of parts.slice(1)) {
      expect(part).not.toContain('## Selection');
      expect(part).not.toContain('## Note');
      expect(part).not.toContain('# Hello');
      expect(part).not.toContain('## Page');
    }
  });

  it('does not split mid-paragraph when paragraph boundaries are available', () => {
    const paraA = 'A'.repeat(2500);
    const paraB = 'B'.repeat(2500);
    const paraC = 'C'.repeat(2500);
    const parts = splitForTelegram({
      ...base,
      bodyMarkdown: `${paraA}\n\n${paraB}\n\n${paraC}`,
    });

    expect(parts.length).toBeGreaterThan(1);
    for (const para of [paraA, paraB, paraC]) {
      const containing = parts.filter((p) => p.includes(para));
      expect(containing).toHaveLength(1);
    }
  });
});
