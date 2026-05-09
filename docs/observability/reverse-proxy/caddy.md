# Caddy Reverse Proxy — ms-365-mcp-server v2

Caddy is the RECOMMENDED reverse proxy for ms-365-mcp-server v2 because:

- Automatic HTTPS via Let's Encrypt (operator provides DNS, Caddy does the rest).
- `flush_interval -1` directive correctly handles SSE (`/t/:tenantId/sse`) without buffering.
- Simple config — a few lines covers HTTP, SSE, metrics scrape, admin API isolation.

## Reference Caddyfile

```caddy
{
	# Enable OCSP stapling, HTTP/2 auto.
	email ops@example.com
}

# Main MCP surface — /t/:tenantId/{mcp,sse,messages}, /register, /authorize, /token, /.well-known/*
mcp.example.com {
	# Admin is intentionally not reachable from the public MCP hostname.
	handle /admin* {
		respond 404
	}

	# SSE + streamable HTTP need flush-on-write.
	# -1 = flush as soon as data arrives (no buffering).
	reverse_proxy ms-365-mcp-server:3000 {
		flush_interval -1
		# Long-lived connection timeouts for streaming transports.
		transport http {
			read_timeout 1h
			write_timeout 1h
			dial_timeout 30s
		}
	}

	# Security headers
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "strict-origin-when-cross-origin"
	}

	# Access log per RFC 5424 — JSON to stdout for container log aggregation.
	log {
		format json
	}
}

# Admin surface — separate subdomain (see Phase 4 admin dual-stack).
admin.example.com {
	reverse_proxy ms-365-mcp-server:3000 {
		# Admin endpoints start with /admin — no /t/:tenantId prefix.
		# If separating backends by path is preferred, use a path matcher.
	}
	# Admin endpoints should be behind a stricter network ACL or Entra SSO.
	# Document in your deployment runbook.
}

# Metrics port — optional public exposure with Bearer gate.
# If MS365_MCP_METRICS_BEARER is unset, DO NOT publish this block;
# bind 127.0.0.1:9464 only and let a local Prometheus scrape it.
metrics.example.com {
	reverse_proxy ms-365-mcp-server:9464
	# Optional: IP allowlist for Prometheus servers
	@prom {
		remote_ip 10.0.0.0/8
	}
	@denied not remote_ip 10.0.0.0/8
	respond @denied 403
}
```

## SSE Verification

After deploying, verify SSE is not buffered by Caddy:

```bash
curl -N https://mcp.example.com/t/tenant-a/sse
```

Should see events stream in real-time. If you see events arrive in bursts of 4KB, `flush_interval` is not set correctly.

The SSE Content-Type is `text/event-stream`; Caddy preserves this header end-to-end when `flush_interval -1` is set.

## Notes

- `flush_interval -1` is the KEY directive for SSE. Without it, Caddy buffers the response body and streams arrive in chunks.
- Read/write timeouts of 1h accommodate long-lived MCP stream transports. Adjust if your deployment sees shorter idle windows.
- Caddy automatically handles HTTP/2 upgrades — no extra config needed.
- For TLS internal to your network (container-to-container), set `auto_https off` and use a self-signed cert — documented in POLISH-01 (deferred).
