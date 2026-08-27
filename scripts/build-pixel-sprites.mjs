/**
 * Single source of truth for the pixel skin's sprites.
 *
 * The sprites are hand-written bitmaps (one character per pixel) rendered to
 * tiny 24x24 PNGs and inlined into octoBeautify.css as base64 data URLs. They
 * total under 1 KB, which is why they are inlined rather than shipped as
 * web-accessible files: a static file would need a new message type, a content
 * script change and a MAIN-world handler just to hand the URL across, and the
 * MAIN world cannot call browser.runtime.getURL() itself.
 *
 * Swapping the character art means editing SPRITES below and re-running this
 * script. It rewrites ONLY the region between the PIXEL-SPRITES markers in
 * octoBeautify.css — every hand-written rule outside them is left alone.
 *
 *   node scripts/build-pixel-sprites.mjs
 *
 * Sprites are emitted at 1x. The stylesheet scales them with
 * `image-rendering: pixelated`, so nearest-neighbour keeps them crisp at any
 * size and we never ship a second resolution.
 */
import { deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

// NES 2C02 palette picks. Kept to 4 colours + transparent per sprite, which is
// what real NES hardware allowed once two sprites were overlaid.
export const NES = {
  black: [0x00, 0x00, 0x00], white: [0xfc, 0xfc, 0xfc],
  blue: [0x00, 0x70, 0xec], ltblue: [0x3c, 0xbc, 0xfc], dkblue: [0x00, 0x00, 0xa8],
  gold: [0xf8, 0xb8, 0x00], dkgold: [0xc8, 0x78, 0x00], drkgold: [0x88, 0x50, 0x00],
  sand: [0xe8, 0xc8, 0x78], dksand: [0xc8, 0xa0, 0x48],
  wood: [0xa8, 0x58, 0x20], dkwood: [0x68, 0x30, 0x08],
  kelp: [0x00, 0xa8, 0x00], dkkelp: [0x00, 0x68, 0x00],
  shade: [0xa8, 0xc8, 0xd8],
  suit: [0xf8, 0x78, 0x58], dksuit: [0xa8, 0x40, 0x28],
  glass: [0x3c, 0xbc, 0xfc],
  // 背景气泡专用：铺在整个聊天区上，必须是纹理而不是前景
  tank: [0xd8, 0xd8, 0xe0], dktank: [0x90, 0x90, 0xa0],
  bubbleRim: [0xd8, 0xf0, 0xff, 0x6e],
  bubbleFill: [0xc0, 0xe4, 0xff, 0x1c],
};
export const PAL = {
  K: NES.black, W: NES.white, B: NES.blue, L: NES.ltblue, D: NES.dkblue,
  Y: NES.gold, O: NES.dkgold, X: NES.drkgold,
  S: NES.sand, s: NES.dksand,
  N: NES.wood, n: NES.dkwood,
  V: NES.kelp, v: NES.dkkelp,
  P: NES.shade,
  U: NES.suit, u: NES.dksuit, T: NES.glass,
  A: NES.tank, a: NES.dktank,
  b: NES.bubbleRim, i: NES.bubbleFill,
};

// Shared head + face. Reused verbatim by every character pose: redrawing the
// face per pose is how the jump frame ended up looking like a different
// creature during design.
export const FACE = [
  '.......KKKKKKKKKK.......',
  '.....KKBBBBBBBBBBKK.....',
  '....KBBBBBBBBBBBBBBK....',
  '...KBBBBBBBBBBBBBBDDK...',
  '..KBBBBBBBBBBBBBBBBDDK..',
  '..KBBBBBBBBBBBBBBBBDDK..',
  '..KBBWWWBBBBBBBBWWWBDK..',
  '..KBWWWWWBBBBBBWWWWWDK..',
  '..KBWWKWWBBBBBBWWKWWDK..',
  '..KBWWWWWBBBBBBWWWWWDK..',
  '..KBBWWWBBBBBBBBWWWBDK..',
  '..KBBBBBBBBBBBBBBBBDDK..',
  '..KBBBBBBKBBBBKBBBBDDK..',
  '..KBBBBBBBKKKKBBBBBDDK..',
  '...KBBBBBBBBBBBBBBDDK...',
];

export const SPRITES = {
  stand: [...FACE,
    '...KBBBBBKKBBKKBBBBDK...',
    '..KBBBBBK.KBBK.KBBBDDK..',
    '.KBBBBK...KBBK...KBBDDK.',
    'KBBBBK....KBBK....KBBDDK',
    'KBBBK.....KBBK.....KBDDK',
    'KBBK......KBBK......KBDK',
    '.KBBK.....KBBK.....KBDK.',
    '..KKK......KK......KKK..',
    '........................',
  ],
  // Arms tucked in — reads as "mid-jump" against the splayed standing pose.
  jump: [...FACE,
    '...KBBBBBKKBBKKBBBBDK...',
    '....KBBBK.KBBK.KBBBDK...',
    '.....KBBK.KBBK.KBBDK....',
    '.....KBBK.KBBK.KBBDK....',
    '......KBK.KBBK.KBDK.....',
    '......KBK.KBBK.KBDK.....',
    '.......KK.KBBK.KK.......',
    '..........KBBK..........',
    '..........KKKK..........',
  ],
  // 真人成员 = 潜水员，AI = 章鱼。一眼分清谁在说话是这套形象的全部意义，
  // 所以两者的剪影要差得够远：硬装备配直角肩，对比软身子加触手。
  //
  // 细节取自真实潜水装备 —— 圆面镜、背后的气瓶、大脚蹼。这些是现实里的东西，
  // 任何潜水题材都在画；刻意没有去照着某个游戏的主角捏，那类具体角色设计
  // 跟当初那套马里奥道具是同一种麻烦。
  diver: [
    '.......KKKKKKKK.........',
    '.....KKWWWWWWWWKK.......',
    '....KWWWWWWWWWWWWK......',
    '....KWWKKKKKKKKWWK......',
    '....KWKTTTTTTTTKWK......',
    '....KWKTTTTTTTTKWK......',
    '....KWWKKKKKKKKWWK......',
    '.....KWWWWWWWWWWK.......',
    '......KKWWWWWWKK........',
    '.....KKKUUUUUUKKK.......',
    '....KAAKUUaaUUKAAK......',
    '....KAAKUUaaUUKAAK......',
    '....KAAKUUaaUUKAAK......',
    '....KAaKUUaaUUKAaK......',
    '.....KKKUUaaUUKKK.......',
    '......KUUUUUUUUK........',
    '......KUUUUUUUUK........',
    '.......KUUKKUUK.........',
    '......KKUUK.KUUKK.......',
    '.....KUUUUK.KUUUUK......',
    '....KUuuuuK.KUuuuuK.....',
    '....KuuuuK...KuuuuK.....',
    '.....KKKK.....KKKK......',
    '........................',
  ],
  // 跳跃姿：屈膝、脚蹼并拢下摆
  'diver-jump': [
    '.......KKKKKKKK.........',
    '.....KKWWWWWWWWKK.......',
    '....KWWWWWWWWWWWWK......',
    '....KWWKKKKKKKKWWK......',
    '....KWKTTTTTTTTKWK......',
    '....KWKTTTTTTTTKWK......',
    '....KWWKKKKKKKKWWK......',
    '.....KWWWWWWWWWWK.......',
    '......KKWWWWWWKK........',
    '.....KKKUUUUUUKKK.......',
    '....KAAKUUaaUUKAAK......',
    '....KAAKUUaaUUKAAK......',
    '....KAAKUUaaUUKAAK......',
    '....KAaKUUaaUUKAaK......',
    '.....KKKUUaaUUKKK.......',
    '......KUUUUUUUUK........',
    '.......KUUUUUUK.........',
    '........KUUUUK..........',
    '........KUUUUK..........',
    '.......KKUUUUKK.........',
    '......KUuuuuuuUK........',
    '......KuuuuuuuuK........',
    '.......KKKKKKKK.........',
    '........................',
  ],
  // Banner 与场景元素。整套是海洋的：角色是章鱼，场景也得是水下，
  // 而不是天空加砖地——那套（天空蓝、白云、错缝砖、带竖槽的金币、绿水管）
  // 是另一个人的视觉词汇，凑在一起指向性太强，跟章鱼也不搭。
  bubble: [
    '....bbbb........................',
    '..bbbbbbbb......................',
    '.bbbiiiibbb.....................',
    '.bbiiiiiibb.....................',
    'bbiiiiiiiibb....................',
    'bbiiiiiiiibb....................',
    'bbiiiiiiiibb....................',
    'bbiiiiiiiibb....................',
    '.bbiiiiiibb.....................',
    '.bbbiiiibbb.....................',
    '..bbbbbbbb......................',
    '....bbbb........................',
    '................................',
    '..................bbbb..........',
    '.................bbbbbb.........',
    '................bbbiibbb........',
    '................bbiiiibb........',
    '................bbiiiibb........',
    '................bbbiibbb........',
    '.................bbbbbb.........',
    '..................bbbb..........',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
  ],
  // 海床：沙面 + 零散石子。左右无缝（没有结构性接缝，任意错位都接得上）。
  seabed: [
    'KKKKKKKKKKKKKKKK',
    'SSSSSSSSSSSSSSSS',
    'SSsSSSSSSSSsSSSS',
    'SSSSSSSSSSSSSSSS',
    'SSSSSsSSSSSSSSSS',
    'SSSSSSSSSSSSSSsS',
    'SSSSSSSSSSSSSSSS',
    'SsSSSSSSSsSSSSSS',
    'SSSSSSSSSSSSSSSS',
    'SSSSSSSSSSSSSSSS',
    'SSSSSSsSSSSSSSSS',
    'SSSSSSSSSSSSSSSS',
    'SSsSSSSSSSSSSsSS',
    'SSSSSSSSSSSSSSSS',
    'SSSSSSSSSSSSSSSS',
    'SSSSSSSSSSSSSSSS',
  ],
  // 海草：竖向平铺，波浪走向靠左右各偏一格做出来。
  kelp: [
    '..KVVK..',
    '..KVVK..',
    '.KVVK...',
    '.KVVK...',
    'KVVK....',
    'KVVK....',
    '.KVVK...',
    '.KVVK...',
    '..KVVK..',
    '..KVVK..',
    '...KVVK.',
    '...KVVK.',
    '....KVVK',
    '....KVVK',
    '...KVVK.',
    '...KVVK.',
  ],
  // 沉船木箱，替掉原来那块带铆钉的金砖（那是问号砖的位置）。
  chest: [
    '........................',
    '.....KKKKKKKKKKKKKK.....',
    '...KKNNNNNNNNNNNNNNKK...',
    '..KNNNNNNNNNNNNNNNNNNK..',
    '..KNYYNNNNNNNNNNNNYYNK..',
    '..KNYYNNNNNNNNNNNNYYNK..',
    '..KNNNNNNNNNNNNNNNNNNK..',
    '..KKKKKKKKKKKKKKKKKKKK..',
    '..KNNNNNNNNKYYKNNNNNNK..',
    '..KNYYNNNNNKYYKNNNYYNK..',
    '..KNYYNNNNNKKKKNNNYYNK..',
    '..KNNNNNNNNNNNNNNNNNNK..',
    '..KNNNNNNNNNNNNNNNNNNK..',
    '..KNYYNNNNNNNNNNNNYYNK..',
    '..KNYYNNNNNNNNNNNNYYNK..',
    '..KNNNNNNNNNNNNNNNNNNK..',
    '..KnnnnnnnnnnnnnnnnnnK..',
    '..KKKKKKKKKKKKKKKKKKKK..',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  // 撞开态：盖子掀起、内部见底。
  'chest-open': [
    '........................',
    '..KKKKKKKKKKKKKKKK......',
    '.KNNNNNNNNNNNNNNNNK.....',
    '.KNYYNNNNNNNNNNYYNK.....',
    '.KNNNNNNNNNNNNNNNNK.....',
    '..KKKKKKKKKKKKKKKK......',
    '..KKKKKKKKKKKKKKKKKKKK..',
    '..KnnnnnnnnnnnnnnnnnnK..',
    '..KnPPPPPPPPPPPPPPPPnK..',
    '..KnPnnnnnnnnnnnnnnPnK..',
    '..KnPnnnnnnnnnnnnnnPnK..',
    '..KnPnnnnnnnnnnnnnnPnK..',
    '..KnPPPPPPPPPPPPPPPPnK..',
    '..KNYYNNNNNNNNNNNNYYNK..',
    '..KNYYNNNNNNNNNNNNYYNK..',
    '..KNNNNNNNNNNNNNNNNNNK..',
    '..KnnnnnnnnnnnnnnnnnnK..',
    '..KKKKKKKKKKKKKKKKKKKK..',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  // 珍珠，替掉带中央竖槽的金币（那个竖槽是马里奥金币的招牌）。
  pearl: [
    '........................',
    '........................',
    '........................',
    '........KKKKKKKK........',
    '......KKWWWWWWWWKK......',
    '.....KWWWWWWWWWWWWK.....',
    '....KWWLWWWWWWWWWWWK....',
    '....KWLWWWWWWWWWWPWK....',
    '...KWWLWWWWWWWWWWPPWK...',
    '...KWWWWWWWWWWWWWPPWK...',
    '...KWWWWWWWWWWWWPPPWK...',
    '...KWWWWWWWWWWWPPPPWK...',
    '...KWWWWWWWWWWPPPPPWK...',
    '....KWWWWWWWPPPPPPWK....',
    '....KWWWWWPPPPPPPPWK....',
    '.....KWWPPPPPPPPPPK.....',
    '......KKPPPPPPPPKK......',
    '........KKKKKKKK........',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
};

/**
 * Nine-slice dialog frames, one per bubble tier.
 *
 * A real FC dialog box is a tile-built frame, not a CSS line: `border: 2px
 * solid` plus an inset shadow only imitates the look, and it stops being a
 * pixel at all once the browser scales it. These are 8x8 tiles sliced at 2,
 * drawn with border-width 4px so each source pixel lands on exactly 2 screen
 * pixels — the same 2px grid the 48px sprites use.
 *
 * Four source pixels of frame (the first cut of this) worked out to 8px of
 * chrome wrapped around every single message, which is a lot of noise down a
 * long list and pads each bubble out by that much. Two is enough to read as a
 * frame.
 *
 * Two details are what make it read as FC rather than as a generic double-lined
 * box: the corners drop their outermost pixel (the stepped "pixel round corner"
 * every NES dialog has), and the inner lining is directional — highlight along
 * the top/left, shade along the bottom/right — so the frame catches light
 * instead of being a flat outline.
 */
export const FRAME_TIERS = {
  'frame-ai':    { H: [0xfc, 0xf8, 0xe0], M: [0xf8, 0xb8, 0x00], C: [0xfc, 0xf0, 0xc8] },
  'frame-me':    { H: [0xe8, 0xf6, 0xff], M: [0x00, 0x70, 0xec], C: [0xd8, 0xec, 0xfc] },
  'frame-other': { H: [0xe4, 0xff, 0xff], M: [0x00, 0xa8, 0xa8], C: [0xd8, 0xfc, 0xfc] },
};

export const FRAME = [
  '.KKKKKK.',
  'KKHHHHKK',
  'KHCCCCMK',
  'KHCCCCMK',
  'KHCCCCMK',
  'KHCCCCMK',
  'KMMMMMMK',
  '.KKKKKK.',
];

// ---- PNG encoding (8-bit RGBA) -------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
export function png(rows, palette = PAL) {
  const w = rows[0].length;
  const h = rows.length;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  rows.forEach((row, y) => {
    const off = y * (w * 4 + 1);
    raw[off] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const col = palette[row[x]];
      const i = off + 1 + x * 4;
      if (!col) continue; // '.' stays transparent
      raw[i] = col[0]; raw[i + 1] = col[1]; raw[i + 2] = col[2]; raw[i + 3] = col[3] ?? 255;
    }
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- emit ----------------------------------------------------------------
// Guarded so other tooling can import the bitmaps without rewriting the sheet.
if (process.argv[1] && process.argv[1].endsWith('build-pixel-sprites.mjs')) {
  const BEGIN = '            /* PIXEL-SPRITES:BEGIN — 由 scripts/build-pixel-sprites.mjs 生成，勿手改 */';
  const END = '            /* PIXEL-SPRITES:END */';

  let total = 0;
  const frameVars = Object.entries(FRAME_TIERS).map(([name, tier]) => {
    const pal = {
      K: [0x10, 0x10, 0x18],
      H: tier.H,
      M: tier.M,
      C: tier.C,
      D: tier.M.map((v) => Math.round(v * 0.62)),
    };
    const buf = png(FRAME, pal);
    total += buf.length;
    return `                --octo-px-${name}: url("data:image/png;base64,${buf.toString('base64')}");`;
  });

  const vars = Object.entries(SPRITES).map(([name, rows]) => {
    const w = rows[0].length;
    rows.forEach((r, i) => {
      if (r.length !== w) throw new Error(`${name}: row ${i} is ${r.length} wide, expected ${w}`);
    });
    const buf = png(rows);
    total += buf.length;
    return `                --octo-px-${name}: url("data:image/png;base64,${buf.toString('base64')}");`;
  });

  const block = [
    BEGIN,
    '            body[data-octo-skin="pixel"] {',
    ...vars,
    ...frameVars,
    '            }',
    END,
  ].join('\n');

  const cssPath = new URL('../utils/octoBeautify.css', import.meta.url);
  const css = readFileSync(cssPath, 'utf8');
  const marker = new RegExp(`${BEGIN.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  if (!marker.test(css)) {
    throw new Error('octoBeautify.css 里找不到 PIXEL-SPRITES 标记区，先加上标记再运行');
}
writeFileSync(cssPath, css.replace(marker, block.trim().replace(/^\s+/, '')));
console.log(`${Object.keys(SPRITES).length} sprites + ${Object.keys(FRAME_TIERS).length} frames, ${total} B raw PNG -> inlined into octoBeautify.css`);
}
