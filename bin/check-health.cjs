#!/usr/bin/env node
'use strict';
/**
 * Docker HEALTHCHECK probe.
 * Hits /healthz on the local HTTP server. Exits 0 on 200, 1 on any other status/error/timeout.
 * CJS on purpose: invoked by Docker HEALTHCHECK every 30s; no ESM loader cost.
 */
const http = require('node:http');

const port = process.env.PORT || process.env.MS365_MCP_HTTP_PORT || 3000;
const opts = { hostname: '127.0.0.1', port, path: '/healthz', timeout: 3000 };

const req = http.get(opts, (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1);
});
req.on('error', () => process.exit(1));
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
