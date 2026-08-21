import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const beautifyCss = readFileSync(new URL('./octoBeautify.css', import.meta.url), 'utf8');

const GLOBAL_THEME_SCOPE = 'body[data-octo-global-theme]:not([data-octo-global-theme="none"])';
const QQ_SELF_MESSAGE_SELECTOR = 'body[data-octo-skin="qq2014"]:not([data-octo-qq-self-left]) .wk-msg-row--send:not(:has(.ai-badge))';

describe('global theme modal palette', () => {
  it('keeps the 3D bot card outside the generic modal panel background', () => {
    expect(beautifyCss).toContain(`${GLOBAL_THEME_SCOPE} .wk-modal:not(.wk-bot-detail-modal),`);
    expect(beautifyCss).toContain(`${GLOBAL_THEME_SCOPE} .wk-modal:not(.wk-bot-detail-modal) .semi-modal-content,`);
    expect(beautifyCss).toContain(`${GLOBAL_THEME_SCOPE} .wk-modal:not(.wk-bot-detail-modal) .wk-modal-shell,`);
  });
});

describe('QQ 2014 sent attachment alignment', () => {
  it('keeps every direct message surface, including image and file cards, on the sent bubble edge', () => {
    expect(beautifyCss).toContain(
      `${QQ_SELF_MESSAGE_SELECTOR} .wk-msg-row-content > :not(.wk-msg-row-header) {`,
    );
  });

  it('keeps both reply-card DOM variants on the sent bubble edge', () => {
    expect(beautifyCss).toContain(
      `${QQ_SELF_MESSAGE_SELECTOR} .wk-msg-row-content .wk-reply-block,\n            ${QQ_SELF_MESSAGE_SELECTOR} .wk-msg-row-content .wk-message-text-reply {`,
    );
  });

  it('keeps reply cards within the QQ bubble width when their preview contains a long URL', () => {
    expect(beautifyCss).toContain(
      `${QQ_SELF_MESSAGE_SELECTOR} .wk-msg-row-content .wk-message-text-reply {\n                width: -moz-fit-content !important;\n                width: fit-content !important;\n                max-width: var(--q14-bubble-max) !important;`,
    );
  });
});
