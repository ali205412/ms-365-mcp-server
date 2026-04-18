#!/usr/bin/env node
'use strict';
/**
 * Probe for v1 keytar leftovers (SECUR-07 / D-04 advisory).
 *
 * Exits 0 silently when keytar is not installed (v2 default — no leftovers
 * possible). Exits 2 with a migration-advice stderr message when keytar IS
 * installed AND entries for the ms-365-mcp-server service are present.
 *
 * Invoked by src/index.ts at stdio startup when the file-based token cache
 * is missing. CJS on purpose — avoids ESM loader overhead for what is
 * usually a one-shot check.
 */
const SERVICE = 'ms-365-mcp-server';

try {
  // eslint-disable-next-line global-require
  const keytar = require('keytar');
  Promise.all([
    keytar.getPassword(SERVICE, 'msal-token-cache'),
    keytar.getPassword(SERVICE, 'selected-account'),
  ])
    .then((results) => {
      const hasTokens = results.some((v) => v !== null && v !== undefined);
      if (hasTokens) {
        process.stderr.write(
          '\nms-365-mcp-server detected leftover v1 OS-keychain token entries.\n' +
            'To migrate them to the file-based cache, run:\n' +
            '  npx ms-365-mcp-server migrate-tokens\n' +
            'After verifying the migration worked, re-run with --clear-keytar\n' +
            'to delete the OS-keychain entries. See CHANGELOG.md for the v2\n' +
            'migration guide.\n\n'
        );
        process.exit(2);
      }
      process.exit(0);
    })
    .catch(() => process.exit(0));
} catch (_e) {
  // keytar not installed — no leftovers possible.
  process.exit(0);
}
