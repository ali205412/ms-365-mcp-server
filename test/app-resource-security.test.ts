import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  APP_ASSET_DIST_PATHS,
  APP_ASSET_SOURCE_DIR,
  scanAppAssets,
} from '../src/lib/mcp-apps/assets.js';
import {
  APP_UI_META,
  sanitizeHtmlSnippet,
  validateAppAssetText,
} from '../src/lib/mcp-apps/security.js';

const FORBIDDEN_MARKERS = ['access_token', 'refresh_token', 'client_secret', '.env'];

async function appUiMetaWithEnv(
  env: Record<string, string | undefined>
): Promise<typeof APP_UI_META> {
  const originalAppDomain = process.env.MS365_MCP_APP_DOMAIN;
  const originalPublicUrl = process.env.MS365_MCP_PUBLIC_URL;
  try {
    if (env.MS365_MCP_APP_DOMAIN === undefined) {
      delete process.env.MS365_MCP_APP_DOMAIN;
    } else {
      process.env.MS365_MCP_APP_DOMAIN = env.MS365_MCP_APP_DOMAIN;
    }
    if (env.MS365_MCP_PUBLIC_URL === undefined) {
      delete process.env.MS365_MCP_PUBLIC_URL;
    } else {
      process.env.MS365_MCP_PUBLIC_URL = env.MS365_MCP_PUBLIC_URL;
    }
    vi.resetModules();
    const mod = await import('../src/lib/mcp-apps/security.js');
    return mod.APP_UI_META;
  } finally {
    if (originalAppDomain === undefined) {
      delete process.env.MS365_MCP_APP_DOMAIN;
    } else {
      process.env.MS365_MCP_APP_DOMAIN = originalAppDomain;
    }
    if (originalPublicUrl === undefined) {
      delete process.env.MS365_MCP_PUBLIC_URL;
    } else {
      process.env.MS365_MCP_PUBLIC_URL = originalPublicUrl;
    }
    vi.resetModules();
  }
}

describe('MCP app resource security', () => {
  it('uses current MCP Apps metadata keys without legacy CSP directives', () => {
    expect(APP_UI_META.ui).toMatchObject({
      csp: {
        connectDomains: [],
        resourceDomains: [],
        baseUriDomains: [],
      },
      sandbox: 'allow-scripts',
      prefersBorder: true,
    });
    expect(APP_UI_META.ui.csp).not.toHaveProperty('defaultSrc');
    expect(APP_UI_META.ui.csp).not.toHaveProperty('scriptSrc');
    expect(APP_UI_META.ui.csp).not.toHaveProperty('connectSrc');
  });

  it('uses an HTTPS origin with explicit port for app UI domain metadata', async () => {
    const meta = await appUiMetaWithEnv({
      MS365_MCP_APP_DOMAIN: undefined,
      MS365_MCP_PUBLIC_URL: 'https://mcp.example.com:8443/path',
    });

    expect(meta.ui.domain).toBe('https://mcp.example.com:8443');
  });

  it('normalizes hostname-only app domain metadata to an HTTPS origin', async () => {
    const meta = await appUiMetaWithEnv({
      MS365_MCP_APP_DOMAIN: 'mcp.example.com',
      MS365_MCP_PUBLIC_URL: undefined,
    });

    expect(meta.ui.domain).toBe('https://mcp.example.com');
  });

  it('escapes user-provided HTML and text snippets before app rendering', () => {
    const unsafe = '<img src=x onerror="alert(1)"><script>alert("x")</script>&hello';

    expect(sanitizeHtmlSnippet(unsafe)).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;hello'
    );
  });

  it('rejects app assets containing token, secret, env, or external script markers', () => {
    for (const marker of FORBIDDEN_MARKERS) {
      expect(validateAppAssetText(`safe shell ${marker}`, `asset-${marker}.html`)).toEqual({
        ok: false,
        reason: expect.stringContaining(marker),
      });
    }

    expect(
      validateAppAssetText('<script src="http://evil.example/app.js"></script>', 'app.html')
    ).toEqual({
      ok: false,
      reason: expect.stringContaining('external script'),
    });
    expect(
      validateAppAssetText('<script src="https://evil.example/app.js"></script>', 'app.html')
    ).toEqual({
      ok: false,
      reason: expect.stringContaining('external script'),
    });
  });

  it('repo-owned app assets contain no forbidden markers or arbitrary external scripts', () => {
    const result = scanAppAssets(APP_ASSET_SOURCE_DIR);

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('dashboard app assets are part of the tsup copy pipeline', () => {
    const assetNames = [
      'app-shell.html',
      'inbox-triage.html',
      'calendar-brief.html',
      'teams-digest.html',
      'file-search.html',
      'permissions-overview.html',
      'connector-diagnostics.html',
      'skill-editor.html',
    ];

    for (const assetName of assetNames) {
      expect(fs.existsSync(path.join(APP_ASSET_SOURCE_DIR, assetName))).toBe(true);
      expect(APP_ASSET_DIST_PATHS).toContain(`dist/apps/${assetName}`);
    }
  });
});
