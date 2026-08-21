import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifestSource = readFileSync(new URL('../wxt.config.ts', import.meta.url), 'utf8');
const sidePanelSource = readFileSync(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8');
const contentScriptSource = readFileSync(new URL('../entrypoints/octo.content.ts', import.meta.url), 'utf8');
const backgroundSource = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
const linkPreviewSource = readFileSync(new URL('./octoLinkPreview.ts', import.meta.url), 'utf8');

describe('external link actions', () => {
  it('does not request all-site access or fetch page metadata', () => {
    expect(manifestSource).not.toContain('optional_host_permissions');
    expect(manifestSource).not.toContain("'https://*/*'");
    expect(sidePanelSource).not.toContain('browser.permissions');
    expect(contentScriptSource).not.toContain('linkPreviewFetch');
    expect(backgroundSource).not.toContain('linkPreviewFetch');
    expect(linkPreviewSource).not.toContain('linkPreviewFetch');
  });
});
