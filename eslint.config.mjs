import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint rules for this repo, with an emphasis on the invariants that have
 * actually bitten us. Style is left mostly alone; the custom rules below encode
 * constraints that are easy to violate accidentally and expensive to notice.
 */
export default tseslint.config(
  {
    ignores: [
      '.output/**',
      '.wxt/**',
      'node_modules/**',
      'design-demos/**',
      'utils/octoBeautify.css',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TypeScript already resolves globals and undefined identifiers, and
      // eslint's core rule has no browser/node lib knowledge here — it only
      // produced false positives for `console`, `process` and `URL`.
      'no-undef': 'off',
      // The codebase reads React fiber internals and untyped page objects, where
      // `any` is the honest type. Keep it visible but not blocking.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Empty catch is a deliberate pattern here: every beautify pass is wrapped
      // so one failing pass cannot take down the rest of the sync.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // ---- project-specific invariants ---------------------------------------
  {
    files: ['utils/**/*.ts', 'entrypoints/**/*.ts', 'entrypoints/**/*.tsx'],
    ignores: ['utils/octoSelectors.ts', '**/*.test.ts'],
    rules: {
      // Octo class names must come from utils/octoSelectors.ts. They used to be
      // duplicated across six modules, so a rename on Octo's side had to be
      // found in every copy — and missing one produced a half-working
      // extension rather than an obvious failure.
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value=/\\.wk-[a-z]/]",
          message:
            'Octo DOM selectors belong in utils/octoSelectors.ts (single source of truth + compat self-check). Import OCTO_SELECTORS instead of inlining a .wk-* class.',
        },
        {
          // MAIN-world code runs with the page's privileges, so an innerHTML
          // template is a script-injection sink as soon as any interpolated
          // value becomes user-configurable.
          selector:
            "AssignmentExpression[left.property.name='innerHTML'], AssignmentExpression[left.property.name='outerHTML']",
          message:
            'Do not assign innerHTML/outerHTML: this code runs in the page MAIN world. Build nodes with createElement + textContent.',
        },
      ],
    },
  },

  // The pixi.js implementation must stay out of the always-injected bundle.
  {
    files: ['entrypoints/octo.content.ts', 'entrypoints/sidepanel/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/utils/octoBeautify',
              message:
                'Importing the beautify engine here drags in its stylesheet and pixi.js as dead code (once 231 KB in the content script). Take defaults from @/utils/octoThemeCatalog.',
            },
            {
              name: '@/utils/octoFullscreenKickPixi',
              message:
                'pixi.js must only be reachable from entrypoints/octo-kick-world.ts, which is injected on demand.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['utils/octoBeautify.ts', 'entrypoints/octo-main-world.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: './octoFullscreenKickPixi',
              message:
                'Use ./octoFullscreenKickLazy. Importing the pixi implementation directly puts ~540 KB of WebGL engine into the always-injected main-world bundle.',
            },
          ],
        },
      ],
    },
  },
);
