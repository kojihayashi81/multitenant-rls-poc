/**
 * Tenant isolation の E2E 攻撃マトリクス（M6-A）。
 *
 * 実プロセスで起動した Hono サーバ（playwright.config.ts の webServer）に
 * 対し、Playwright の request フィクスチャから本物の HTTP を投げる。
 * vitest 側の `app.request()` テストとは別レイヤで、プロセス境界・
 * シリアライズ境界を含めた挙動を検証する。
 *
 * 各テストは beforeEach で seed を流し直すので互いに独立。
 */

import { expect, test } from '@playwright/test';
import { FIXTURES, reseed } from './helpers/seed';

const { T1, T2, T1_ALICE, T2_CAROL, T2_CAROL_POST } = FIXTURES;

test.beforeEach(async () => {
  await reseed();
});

test.describe('cross-tenant isolation matrix', () => {
  test('T1 で T2 の post を GET → 404 (existence-hiding)', async ({ request }) => {
    const res = await request.get(`/posts/${T2_CAROL_POST}`, {
      headers: { 'x-tenant-id': T1 },
    });

    expect(res.status()).toBe(404);
    expect(res.headers()['content-type']).toContain('application/problem+json');

    const body = await res.json();
    expect(body).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  test('T1 の posts 一覧は T1 の 2 件のみ', async ({ request }) => {
    const res = await request.get('/posts', {
      headers: { 'x-tenant-id': T1 },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta.count).toBe(2);
    expect(body.data.every((p: { tenantId: string }) => p.tenantId === T1)).toBe(
      true,
    );
  });

  test('T1 で T2 ユーザを userId に POST → 400 cross-tenant violation', async ({
    request,
  }) => {
    const res = await request.post('/posts', {
      headers: { 'x-tenant-id': T1 },
      data: { title: 'hijack', body: 'x', userId: T2_CAROL },
    });

    expect(res.status()).toBe(400);
    expect(res.headers()['content-type']).toContain('application/problem+json');

    const body = await res.json();
    expect(body).toMatchObject({
      code: 'CROSS_TENANT_VIOLATION',
      status: 400,
    });
  });

  test('T1 で T2 の post を PUT → 404', async ({ request }) => {
    const res = await request.put(`/posts/${T2_CAROL_POST}`, {
      headers: { 'x-tenant-id': T1 },
      data: { title: 'hacked' },
    });

    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
  });

  test('T1 で T2 の post を DELETE → 404', async ({ request }) => {
    const res = await request.delete(`/posts/${T2_CAROL_POST}`, {
      headers: { 'x-tenant-id': T1 },
    });

    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
  });

  test('POST body に tenantId: T2 を仕込んでも、結果は T1 として作られる（zod が削ぐ）', async ({
    request,
  }) => {
    const res = await request.post('/posts', {
      headers: { 'x-tenant-id': T1 },
      data: {
        title: 'extra-field',
        body: 'attempt',
        userId: T1_ALICE,
        tenantId: T2, // ← 攻撃者が仕込んだ余計なフィールド
      },
    });

    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.tenantId).toBe(T1);
  });

  test('T1 が攻撃を試みた後でも、T2 視点では post 集合が変化していない', async ({
    request,
  }) => {
    // 攻撃の数々（成功/失敗どちらでも T2 の集合に影響してはならない）
    await request.put(`/posts/${T2_CAROL_POST}`, {
      headers: { 'x-tenant-id': T1 },
      data: { title: 'hacked' },
    });
    await request.delete(`/posts/${T2_CAROL_POST}`, {
      headers: { 'x-tenant-id': T1 },
    });
    await request.post('/posts', {
      headers: { 'x-tenant-id': T1 },
      data: { title: 'cross', body: 'x', userId: T2_CAROL },
    });

    // T2 視点でリストを取得：Carol の 1 件のみ、内容も無傷であること
    const res = await request.get('/posts', {
      headers: { 'x-tenant-id': T2 },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: T2_CAROL_POST,
      tenantId: T2,
      title: 'Carol T2 post', // 改竄されていない
    });
  });

  test('全エラー応答が application/problem+json で返る', async ({ request }) => {
    const cases = [
      // 401: ヘッダ不在
      { req: () => request.get('/posts'), status: 401 },
      // 400: UUIDv7 でない
      {
        req: () =>
          request.get('/posts', { headers: { 'x-tenant-id': 'not-a-uuid' } }),
        status: 400,
      },
      // 404: 自テナント内に存在しない id
      {
        req: () =>
          request.get(`/posts/${T2_CAROL_POST}`, {
            headers: { 'x-tenant-id': T1 },
          }),
        status: 404,
      },
    ];

    for (const c of cases) {
      const res = await c.req();
      expect(res.status()).toBe(c.status);
      expect(res.headers()['content-type']).toContain(
        'application/problem+json',
      );
    }
  });
});
