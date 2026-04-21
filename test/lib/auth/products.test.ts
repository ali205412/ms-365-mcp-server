/**
 * Plan 05.1-06 Task 2 — PRODUCT_AUDIENCES table tests (per D-05).
 *
 * Exercises:
 *   - The 5-entry audience table with correct {scope, baseUrl, prefix} per
 *     CONTEXT D-05 Table.
 *   - Function-style scope/baseUrl resolution for exo + sp-admin (the two
 *     products that take per-tenant context).
 *   - sharepoint_domain Zod regex enforcement at both scope + baseUrl
 *     resolvers (T-5.1-06-c defense-in-depth).
 *   - Prefix-to-product mapping via extractProductFromAlias +
 *     isProductPrefix helpers.
 *
 * Tests P1-P7 (7 tests total). These are pure unit tests — no MSAL, no
 * network, no DB.
 *
 * Threat mitigations pinned:
 *   - T-5.1-06-c (sharepoint_domain injection): Test P4 asserts the Zod
 *     regex rejects dots.
 *   - T-5.1-06-d (alias collision across products): Tests P5-P7 pin the
 *     alpha-unique prefix mapping.
 */
import { describe, it, expect } from 'vitest';
import {
  PRODUCT_AUDIENCES,
  extractProductFromAlias,
  isProductPrefix,
  type Product,
} from '../../../src/lib/auth/products.js';

describe('plan 05.1-06 Task 2 — PRODUCT_AUDIENCES table (D-05)', () => {
  it('Test P1: PRODUCT_AUDIENCES has exactly 5 entries with expected keys', () => {
    expect(PRODUCT_AUDIENCES.size).toBe(5);
    const expectedProducts: Product[] = ['powerbi', 'pwrapps', 'pwrauto', 'exo', 'sp-admin'];
    for (const p of expectedProducts) {
      expect(PRODUCT_AUDIENCES.has(p)).toBe(true);
    }
  });

  it('Test P2: sp-admin scope({sharepointDomain: undefined}) throws', () => {
    const audience = PRODUCT_AUDIENCES.get('sp-admin');
    expect(audience).toBeDefined();
    expect(typeof audience!.scope).toBe('function');
    const resolver = audience!.scope as (ctx: { sharepointDomain?: string }) => string;
    expect(() => resolver({ sharepointDomain: undefined })).toThrow(
      /sharepoint_domain not configured/i
    );
  });

  it('Test P3: sp-admin baseUrl({sharepointDomain: "contoso"}) returns admin URL', () => {
    const audience = PRODUCT_AUDIENCES.get('sp-admin');
    expect(audience).toBeDefined();
    expect(typeof audience!.baseUrl).toBe('function');
    const resolver = audience!.baseUrl as (ctx: { sharepointDomain?: string }) => string;
    const url = resolver({ sharepointDomain: 'contoso' });
    expect(url).toBe(
      'https://contoso-admin.sharepoint.com/_api/SPO.TenantAdministrationOffice365Tenant'
    );
  });

  it('Test P4: sp-admin scope({sharepointDomain: "contoso.evil.com"}) throws (regex rejects dots)', () => {
    const audience = PRODUCT_AUDIENCES.get('sp-admin');
    expect(audience).toBeDefined();
    const scopeResolver = audience!.scope as (ctx: { sharepointDomain?: string }) => string;
    const baseUrlResolver = audience!.baseUrl as (ctx: { sharepointDomain?: string }) => string;
    // Regex `/^[a-z0-9-]{1,63}$/` must reject dots, slashes, uppercase —
    // defense-in-depth against attacker-planted tenant-column values
    // (T-5.1-06-c mitigation).
    expect(() => scopeResolver({ sharepointDomain: 'contoso.evil.com' })).toThrow(
      /invalid sharepoint_domain/i
    );
    expect(() => baseUrlResolver({ sharepointDomain: 'contoso.evil.com' })).toThrow(
      /invalid sharepoint_domain/i
    );
    // Uppercase + slashes also rejected.
    expect(() => scopeResolver({ sharepointDomain: 'CONTOSO' })).toThrow(
      /invalid sharepoint_domain/i
    );
    expect(() => scopeResolver({ sharepointDomain: 'contoso/evil' })).toThrow(
      /invalid sharepoint_domain/i
    );
  });

  it('Test P5: extractProductFromAlias("__powerbi__list-workspaces") returns {product, strippedAlias}', () => {
    const result = extractProductFromAlias('__powerbi__list-workspaces');
    expect(result).toEqual({ product: 'powerbi', strippedAlias: 'list-workspaces' });

    // sp-admin alias — product enum uses dash, prefix is __spadmin__ literal.
    const spResult = extractProductFromAlias('__spadmin__list-sites');
    expect(spResult).toEqual({ product: 'sp-admin', strippedAlias: 'list-sites' });

    // All 5 product prefixes map correctly.
    expect(extractProductFromAlias('__pwrapps__x')?.product).toBe('pwrapps');
    expect(extractProductFromAlias('__pwrauto__x')?.product).toBe('pwrauto');
    expect(extractProductFromAlias('__exo__get-mailbox')?.product).toBe('exo');
  });

  it('Test P6: extractProductFromAlias("list-mail-messages") returns null (not a product alias)', () => {
    expect(extractProductFromAlias('list-mail-messages')).toBeNull();
    expect(extractProductFromAlias('__beta__users')).toBeNull(); // __beta__ is Graph beta, NOT a product
    expect(extractProductFromAlias('get-me')).toBeNull();
    expect(extractProductFromAlias('')).toBeNull();
  });

  it('Test P7: isProductPrefix matches only known product prefixes', () => {
    expect(isProductPrefix('__spadmin__get-site')).toBe(true);
    expect(isProductPrefix('__powerbi__list-workspaces')).toBe(true);
    expect(isProductPrefix('__pwrapps__x')).toBe(true);
    expect(isProductPrefix('__pwrauto__x')).toBe(true);
    expect(isProductPrefix('__exo__get-mailbox')).toBe(true);

    expect(isProductPrefix('get-me')).toBe(false);
    expect(isProductPrefix('__beta__users')).toBe(false);
    expect(isProductPrefix('list-mail-messages')).toBe(false);
    expect(isProductPrefix('')).toBe(false);
  });

  it('Test P8: static audiences carry expected scope + baseUrl', () => {
    // Power BI — static strings, D-05 table.
    const pbi = PRODUCT_AUDIENCES.get('powerbi')!;
    expect(pbi.scope).toBe('https://analysis.windows.net/powerbi/api/.default');
    expect(pbi.baseUrl).toBe('https://api.powerbi.com/v1.0/myorg');
    expect(pbi.prefix).toBe('__powerbi__');

    const apps = PRODUCT_AUDIENCES.get('pwrapps')!;
    expect(apps.scope).toBe('https://api.powerapps.com/.default');
    expect(apps.prefix).toBe('__pwrapps__');

    const auto = PRODUCT_AUDIENCES.get('pwrauto')!;
    expect(auto.scope).toBe('https://service.flow.microsoft.com/.default');
    expect(auto.prefix).toBe('__pwrauto__');

    // Exchange — scope static, baseUrl function (tenantAzureId substitution).
    const exo = PRODUCT_AUDIENCES.get('exo')!;
    expect(exo.scope).toBe('https://outlook.office365.com/.default');
    expect(typeof exo.baseUrl).toBe('function');
    expect(exo.prefix).toBe('__exo__');
  });

  it('Test P9: exo baseUrl({tenantAzureId}) validates UUID shape', () => {
    const exo = PRODUCT_AUDIENCES.get('exo')!;
    const resolver = exo.baseUrl as (ctx: { tenantAzureId?: string }) => string;

    // Valid UUID shape (hex + dashes, 36 chars max).
    expect(resolver({ tenantAzureId: '12345678-1234-4567-8901-123456789012' })).toBe(
      'https://outlook.office365.com/adminapi/beta/12345678-1234-4567-8901-123456789012'
    );

    // Invalid shapes — path traversal / header injection / non-hex chars.
    // T-5.1-05-f defense-in-depth.
    expect(() => resolver({ tenantAzureId: undefined })).toThrow(/invalid tenantAzureId/i);
    expect(() => resolver({ tenantAzureId: '../../etc/passwd' })).toThrow(/invalid tenantAzureId/i);
    expect(() => resolver({ tenantAzureId: 'not-a-uuid-and-has-bad/chars' })).toThrow(
      /invalid tenantAzureId/i
    );
  });
});
