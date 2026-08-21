import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const linkPreviewSource = readFileSync(new URL('./octoLinkPreview.ts', import.meta.url), 'utf8');
const OWN_QQ_MESSAGE_SELECTOR = 'body[data-octo-skin="qq2014"]:not([data-octo-qq-self-left]) .wk-msg-row--send:not(:has(.ai-badge))';

describe('QQ 2014 link action alignment', () => {
  it('keeps sent-message action rows on the same right edge as their bubble', () => {
    expect(linkPreviewSource).toContain(
      `${OWN_QQ_MESSAGE_SELECTOR} .octo-link-actions,\n    ${OWN_QQ_MESSAGE_SELECTOR} .octo-github-links {\n      justify-content: flex-end;`,
    );
  });
});

describe('link action fallback icon', () => {
  it('uses a web glyph so the fallback does not duplicate the external-link arrow', () => {
    expect(linkPreviewSource).toContain("'octo-link-action-icon is-fallback', 'aria-hidden': 'true' }, ['🌐']");
  });
});
