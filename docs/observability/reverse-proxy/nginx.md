# nginx Reverse Proxy — ms-365-mcp-server v2

nginx is documented as a SECONDARY alternative to Caddy (the recommended proxy). Use nginx when your ops team already operates an nginx fleet or your TLS + certificate-management setup is nginx-anchored.

## Critical SSE Directive: `proxy_buffering off`

Without `proxy_buffering off;`, nginx will buffer the SSE response body and client events will NOT stream. This is the single most-forgotten nginx setting for server-sent-events.

The SSE response carries `Content-Type: text/event-stream`; nginx's default buffering breaks it.

## Reference nginx.conf

```nginx
upstream ms365_mcp_server {
    server ms-365-mcp-server:3000;
    keepalive 32;
}

# Main MCP surface
server {
    listen 443 ssl http2;
    server_name mcp.example.com;

    ssl_certificate /etc/ssl/certs/mcp.example.com.crt;
    ssl_certificate_key /etc/ssl/private/mcp.example.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Admin is intentionally not reachable from the public MCP hostname.
    location ^~ /admin {
        return 404;
    }

    # SSE + streaming HTTP — CRITICAL buffering settings
    location ~ ^/t/[^/]+/(sse|messages|mcp) {
        proxy_pass http://ms365_mcp_server;
        proxy_http_version 1.1;

        # Buffering OFF — without this SSE does not stream.
        proxy_buffering off;
        # Ensure transfer-encoding: chunked is preserved end-to-end.
        proxy_cache off;

        # Long-lived connections.
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
        proxy_connect_timeout 30s;

        # Preserve client headers.
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";  # Clear Connection for HTTP/1.1 keepalive.
    }

    # OAuth + /.well-known endpoints — no streaming; standard proxy.
    location / {
        proxy_pass http://ms365_mcp_server;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Admin surface — separate server block, typically behind an IP allowlist.
server {
    listen 443 ssl http2;
    server_name admin.example.com;
    ssl_certificate /etc/ssl/certs/admin.example.com.crt;
    ssl_certificate_key /etc/ssl/private/admin.example.com.key;

    # Example: allowlist your ops network.
    allow 10.0.0.0/8;
    deny all;

    location / {
        proxy_pass http://ms365_mcp_server;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Metrics — same caveats as Caddy; only publish if Bearer-gated.
server {
    listen 9464;
    server_name metrics.example.com;
    # Allow Prometheus servers only.
    allow 10.0.0.0/8;
    deny all;

    location = /metrics {
        proxy_pass http://ms365_mcp_server:9464;
    }
}
```

## SSE Verification

```bash
curl -N https://mcp.example.com/t/tenant-a/sse
```

Events must stream in real-time. If they arrive in 4KB or 8KB bursts, `proxy_buffering off` is missing from the `location` block.

## Notes

- `proxy_cache off` is technically redundant when there's no cache zone, but defense-in-depth against a global default cache config.
- `proxy_http_version 1.1` + empty `Connection` header = keepalive-friendly.
- nginx's `proxy_read_timeout` defaults to 60s — MUST raise to 1h for MCP streams.
