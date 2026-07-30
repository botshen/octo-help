import { describe, expect, it } from 'vitest';
import { extractPetSpeech, PetSpeechDeduper } from './octoPetSpeech';

function message(overrides: Record<string, unknown> = {}) {
  return {
    message: {
      messageSeq: 42,
      fromUID: 'user-1',
      from: { title: '小明' },
      contentType: 1,
      content: { text: '你好' },
      ...overrides,
    },
  };
}

describe('extractPetSpeech', () => {
  it('extracts sender, text and a stable message key', () => {
    expect(extractPetSpeech(message())).toEqual({
      key: '42',
      sender: '小明',
      summary: '你好',
    });
  });

  it('prefers clientMsgNo while a server sequence may still be provisional', () => {
    const speech = extractPetSpeech(message({
      messageSeq: 0,
      clientMsgNo: 'client-42',
    }));
    expect(speech?.key).toBe('client-42');
  });

  it('collapses whitespace and truncates long text', () => {
    const speech = extractPetSpeech(message({
      content: { text: `第一行\n${'很长'.repeat(30)}` },
    }));
    expect(speech?.summary).not.toContain('\n');
    expect(speech?.summary.endsWith('…')).toBe(true);
    expect(speech?.summary.length).toBe(52);
  });

  it.each([
    [2, '[图片]'],
    [4, '[语音]'],
    [5, '[视频]'],
    [8, '[文件]'],
    [999, '[新消息]'],
  ])('uses a readable fallback for content type %s', (contentType, expected) => {
    const speech = extractPetSpeech(message({ contentType, content: {} }));
    expect(speech?.summary).toBe(expected);
  });

  it('prefers the SDK digest for rich messages', () => {
    const speech = extractPetSpeech(message({
      contentType: 8,
      content: { conversationDigest: '[文件] 项目说明.pdf' },
    }));
    expect(speech?.summary).toBe('[文件] 项目说明.pdf');
  });

  it('filters sent, system and revoked messages', () => {
    expect(extractPetSpeech(message(), { sentBySelf: true })).toBeNull();
    expect(extractPetSpeech(message(), { system: true })).toBeNull();
    expect(extractPetSpeech({ ...message(), revoke: true })).toBeNull();
  });
});

describe('PetSpeechDeduper', () => {
  it('records each message key only once', () => {
    const deduper = new PetSpeechDeduper();
    expect(deduper.has('message-1')).toBe(false);
    deduper.add('message-1');
    deduper.add('message-1');
    expect(deduper.has('message-1')).toBe(true);
  });
});
