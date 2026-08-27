import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const beautifyCss = readFileSync(new URL('./octoBeautify.css', import.meta.url), 'utf8');

/** Pull whole `{...}` blocks whose selector matches, brace-counted so nested
 *  keyframe bodies come out intact. */
function cssBlocks(selector: RegExp): string[] {
  const out: string[] = [];
  for (const match of beautifyCss.matchAll(selector)) {
    const open = beautifyCss.indexOf('{', match.index);
    if (open < 0) continue;
    let depth = 0;
    for (let i = open; i < beautifyCss.length; i++) {
      if (beautifyCss[i] === '{') depth++;
      else if (beautifyCss[i] === '}' && --depth === 0) {
        out.push(beautifyCss.slice(match.index, i + 1));
        break;
      }
    }
  }
  return out;
}

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

describe('message bubble sizing', () => {
  it('neutralizes octo-web nested fit-content hit areas', () => {
    expect(beautifyCss).toMatch(
      /\.wk-msg-row-body-hitarea\s*\{[^}]*width:\s*auto\s*!important;[^}]*max-width:\s*100%\s*!important;/s,
    );
  });
});

describe('pixel skin', () => {
  it('declares every sprite at an integer multiple of its bitmap size', async () => {
    // 类型来自 scripts/build-pixel-sprites.d.mts —— 脚本本身保持纯 JS，
    // 它要能在没有构建步骤的裸 node 下直接跑。
    const { SPRITES } = await import('../scripts/build-pixel-sprites.mjs');
    // CSS 里出现的 `--octo-px-<name>` 用了什么 background-size
    const declared: Record<string, Array<[number, number]>> = {};
    for (const m of beautifyCss.matchAll(
      /var\(--octo-px-([a-z-]+)\)[^,;]*?\/ (\d+)px (\d+)px/g,
    )) {
      (declared[m[1]] ??= []).push([Number(m[2]), Number(m[3])]);
    }
    expect(Object.keys(declared).length).toBeGreaterThan(0);
    for (const [name, sizes] of Object.entries(declared)) {
      const rows = (SPRITES as Record<string, string[]>)[name];
      expect(rows, `${name} 在生成脚本里不存在`).toBeDefined();
      for (const [w, h] of sizes) {
        expect(w % rows[0].length, `${name} 宽 ${w} 不是 ${rows[0].length} 的整数倍`).toBe(0);
        expect(h % rows.length, `${name} 高 ${h} 不是 ${rows.length} 的整数倍`).toBe(0);
      }
    }
  });

  const SKIN = 'body[data-octo-skin="pixel"]';

  it('inlines every sprite the skin references', () => {
    for (const name of ['stand', 'jump', 'chest', 'chest-open', 'pearl', 'bubble', 'seabed', 'kelp']) {
      expect(beautifyCss).toContain(`--octo-px-${name}: url("data:image/png;base64,`);
    }
  });

  it('keeps the generated sprite block inside its markers', () => {
    // Hand-written rules live outside them; build-pixel-sprites.mjs rewrites
    // only what is between. Losing a marker makes the script fail loudly.
    expect(beautifyCss).toContain('/* PIXEL-SPRITES:BEGIN');
    expect(beautifyCss).toContain('/* PIXEL-SPRITES:END */');
  });

  it('gives AI, self and other bubbles three distinct fills', () => {
    expect(beautifyCss).toContain(`${SKIN} .wk-msg-row:has(.ai-badge) .wk-markdown,`);
    expect(beautifyCss).toContain(`${SKIN} .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown {`);
    expect(beautifyCss).toContain(
      `${SKIN} .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown {`,
    );
  });

  it('scales sprites with nearest-neighbour so they never blur', () => {
    expect(beautifyCss).toContain('.octo-pixel-hit > * {\n                position: absolute;\n                image-rendering: pixelated;');
  });

  it('drives the bump scene entirely from keyframes', () => {
    for (const kf of ['oph-chest-face', 'oph-chest-bump', 'oph-hero-pose', 'oph-hero-jump', 'oph-pearl-a', 'oph-pearl-b', 'oph-pearl-c']) {
      expect(beautifyCss).toContain(`@keyframes ${kf} {`);
    }
  });

  it('never puts !important on an animated transform', () => {
    // `!important` on transform/opacity would override the keyframes themselves,
    // silently freezing the scene on its first frame.
    //
    // Scanned by structure, not by position. This used to take everything
    // between `.octo-pixel-hit {` and the reduced-motion query, which meant any
    // rule later added in that stretch got swept in — the scroll-time hover
    // suppression legitimately needs `transform: none !important` to beat the
    // base layer, and tripped this.
    const blocks = [
      ...cssBlocks(/\.octo-pixel-hit[^{,]*(?=\s*\{)/g),
      ...cssBlocks(/@keyframes oph-[\w-]+/g),
    ];
    expect(blocks.length).toBeGreaterThan(8);
    for (const block of blocks) {
      expect(block).not.toMatch(/transform:[^;]*!important/);
      expect(block).not.toMatch(/opacity:[^;]*!important/);
    }
  });

  it('reads each pearl landing off the pearl itself, not the scene', () => {
    // The pearl count is rolled per hit, so the landing vars cannot live on the
    // container — a fixed --oph-x1..xN set would cap how many pearls can fly.
    expect(beautifyCss).not.toMatch(/--oph-x\d/);
    expect(beautifyCss).toContain('var(--oph-x, -60px)');
    expect(beautifyCss).toContain('var(--oph-y, 40px)');
  });

  it('builds the bot card banner by stacking sprites, at integer scales only', () => {
    const banner = beautifyCss.slice(
      beautifyCss.indexOf(`${SKIN} .wk-bot-detail-header::before`),
    ).slice(0, 700);
    for (const sprite of ['stand', 'chest', 'seabed']) {
      expect(banner).toContain(`var(--octo-px-${sprite})`);
    }
    // 24px 与 16px 的源精灵只能按整数倍放；1.83 倍那种会把一个源像素
    // 切成宽窄不一的块，边缘立刻发脏。
    for (const [, size] of banner.matchAll(/\/ (\d+)px \d+px/g)) {
      expect([32, 48, 64, 72, 96]).toContain(Number(size));
    }
  });

  it('drifts the banner bubbles, and stops them under reduced motion', () => {
    // 气泡竖向平铺，一个循环走满一个 tile 高度，首尾才接得上；两层位移量不同
    // 才会错开成远近两层。改动画就要一起改这两个数。
    expect(beautifyCss).toContain('@keyframes octo-px-bubble-rise {');
    expect(beautifyCss).toContain('to { background-position: left 14% top -144px, left 68% top -96px; }');
    const reduced = beautifyCss.slice(beautifyCss.indexOf('@media (prefers-reduced-motion'));
    expect(reduced).toContain('.wk-bot-detail-header::after');
  });

  it('leaves the animated background-position free of !important', () => {
    // `background: … !important` 的简写会连 background-position 一起设成
    // !important，而 !important 压过 keyframes —— 动画照跑，位置却钉死。
    // 这条规则和它在基础层的对应规则都必须拆成 background-image 写。
    // 同一个选择器出现两次（另一处在 reduced-motion 查询里，只有 animation: none），
    // 要的是带背景声明的那条。
    const rule = cssBlocks(/body\[data-octo-skin="pixel"\] \.wk-bot-detail-header::after/g)
      .find((block) => block.includes('background-image'));
    expect(rule).toBeDefined();
    expect(rule).not.toMatch(/(^|[^-])background:/);
    expect(rule).toMatch(/background-position:[^;!]*;/);

    const [base] = cssBlocks(/(?<!\] )\.wk-bot-detail-header::after/g);
    expect(base).not.toMatch(/(^|[^-])background:/);
  });

  it('ships a whole-site palette that only sets --octo-global-* vars', () => {
    expect(beautifyCss).toContain('body[data-octo-global-theme="pixel"] {');
    expect(beautifyCss).toContain('--octo-global-accent: #0070ec;');
    // 硬投影：任何 blur 半径都会把它拉出 8-bit
    expect(beautifyCss).toContain('--octo-global-shadow: 3px 3px 0 rgba(16, 16, 24, 0.16);');
  });

  it('swaps the actor sprite by message origin', () => {
    // 关键帧只引用 --oph-stand/--oph-jump，具体精灵由 data-octo-actor 决定；
    // 关键帧里一旦直接写死某个精灵，另一个角色就永远换不过来。
    expect(beautifyCss).toContain('.octo-pixel-hit[data-octo-actor="human"] {');
    expect(beautifyCss).toContain('--oph-stand: var(--octo-px-diver);');
    const [pose] = cssBlocks(/@keyframes oph-hero-pose/g);
    expect(pose).toContain('var(--oph-stand)');
    expect(pose).not.toContain('--octo-px-');
  });

  it('paints the chat backdrop on the scrolling layer', () => {
    // Octo 给 .wk-conversation-messages 上了不透明底色，所以背景必须落在这一层；
    // 铺在外层 .wk-conversation-content 上会被它整个盖住，看不见任何效果。
    const rule = cssBlocks(/body\[data-octo-skin="pixel"\] \.wk-conversation-messages/g)
      .find((block) => block.includes('background-image'));
    expect(rule, '滚动层上没有背景图').toBeDefined();
    expect(rule).toContain('var(--octo-px-seabed)');
    expect(rule).toMatch(/background-position:[^;!]*;/);
  });

  it('repeats the frame declarations inside every bubble tier', () => {
    // 基础层给气泡的选择器带 :has()，特异性 (0,4,0)，压得过
    // body[data-octo-skin] .wk-markdown 的 (0,2,1)。边框只写在通用规则上时，
    // 真机上是底色换了、九宫格没出来 —— 因为底色恰好写在够格的三档里。
    for (const tier of ['ai', 'me', 'other']) {
      const rule = cssBlocks(new RegExp(`body\\[data-octo-skin="pixel"\\][^{]*?--octo-px-frame-${tier}`, 'g'))
        .find((block) => block.includes(`--octo-px-frame-${tier}`));
      const own = beautifyCss.slice(
        beautifyCss.indexOf(`--octo-px-frame-${tier}) !important;`),
      ).slice(0, 500);
      expect(own, `${tier} 档缺少 border-image-slice`).toContain('border-image-slice: 2 fill');
      expect(own, `${tier} 档缺少直角`).toContain('border-radius: 0');
      expect(rule ?? own).toBeDefined();
    }
  });

  it('hides the whole scene under reduced motion', () => {
    expect(beautifyCss).toContain('.octo-pixel-hit { display: none !important; }');
  });
});
