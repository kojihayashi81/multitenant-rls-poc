/**
 * Unit tests for the tenantContext Hono middleware.
 *
 * No database access. We mount the middleware on a tiny Hono app, drive it
 * with app.request(), and assert the RFC 9457 problem+json body that the
 * global onError handler in createApp() ultimately serialises.
 */

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { tenantContext, type AppEnv } from '../../src/middleware/tenant-context';

const T1 = '01900000-0000-7000-8000-000000000001';

function buildHarness() {
  // We re-use createApp() for its onError mapping, but mount a synthetic
  // /__probe route so we don't need DB access. The probe simply echoes
  // c.get('tenantId') so we can assert the middleware set it.
  const app = createApp();
  const probe = new Hono<AppEnv>()
    .use('*', tenantContext)
    .get('/', (c) => c.json({ tenantId: c.get('tenantId') }));
  app.route('/__probe', probe);
  return app;
}

describe('tenantContext middleware', () => {
  it('valid x-tenant-id を渡すと next が呼ばれ、c.get("tenantId") に検証済み値がセットされる', async () => {
    const app = buildHarness();
    const res = await app.request('/__probe', {
      headers: { 'x-tenant-id': T1 },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tenantId: T1 });
  });

  it('x-tenant-id が無いと 401 + application/problem+json + TENANT_HEADER_MISSING を返す', async () => {
    const app = buildHarness();
    const res = await app.request('/__probe');

    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain(
      'application/problem+json',
    );

    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      code: 'TENANT_HEADER_MISSING',
      status: 401,
      title: 'Tenant header missing',
    });
    expect(body.type).toContain('tenant-header-missing');
    expect(body.instance).toBe('/__probe');
  });

  it('x-tenant-id が UUIDv7 でないと 400 + VALIDATION_ERROR + invalidParams を返す', async () => {
    const app = buildHarness();
    const res = await app.request('/__probe', {
      headers: { 'x-tenant-id': 'not-a-uuid' },
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain(
      'application/problem+json',
    );

    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      title: 'Validation failed',
    });
    expect(body.errors).toBeInstanceOf(Array);
    expect(body.errors[0]?.name).toBe('x-tenant-id');
  });

  it('UUIDv4（v7 でない UUID）も拒否される', async () => {
    const app = buildHarness();
    // Valid v4 but not v7 (version digit at pos 14 is "4")
    const v4 = '00000000-0000-4000-8000-000000000000';
    const res = await app.request('/__probe', {
      headers: { 'x-tenant-id': v4 },
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});
