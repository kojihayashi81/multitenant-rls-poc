/**
 * Pure unit tests for toProblemBody.
 *
 * Hono の Context にも Request にも依存しないので、エラーオブジェクトと
 * `instance` を直接渡して、Problem Details の本体構造だけを検証する。
 * 横断関心事（Content-Type、JSON シリアライズ）は app.ts 側の onError が担う。
 */

import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toProblemBody } from '../../src/http/error-mapping';
import {
  NotFoundError,
  TenantHeaderMissingError,
  ValidationError,
} from '../../src/http/errors';

const INSTANCE = '/posts/abc';

describe('toProblemBody', () => {
  it('AppError サブクラスはそのまま toProblemDetails に委譲', () => {
    const { body, status } = toProblemBody(
      new TenantHeaderMissingError(),
      INSTANCE,
    );
    expect(status).toBe(401);
    expect(body).toMatchObject({
      code: 'TENANT_HEADER_MISSING',
      status: 401,
      instance: INSTANCE,
    });
  });

  it('AppError 派生で errors 拡張を持つもの（NotFoundError）も保持される', () => {
    const { body } = toProblemBody(new NotFoundError('post', 'pid-1'), INSTANCE);
    expect(body).toMatchObject({
      code: 'NOT_FOUND',
      errors: { resource: 'post', id: 'pid-1' },
    });
  });

  it('生の ZodError は ValidationError 経由で 400 にマップ', () => {
    const schema = z.object({ id: z.uuidv7() });
    const result = schema.safeParse({ id: 'not-a-uuid' });
    if (result.success) throw new Error('expected parse failure');

    const { body, status } = toProblemBody(result.error, INSTANCE);
    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    expect((body as { errors: unknown[] }).errors).toBeInstanceOf(Array);
    expect((body as { errors: Array<{ name: string }> }).errors[0]?.name).toBe(
      'id',
    );
  });

  it('pg エラーコード 42501 は RLSWriteError (400, cross-tenant) にマップ', () => {
    const pgErr = Object.assign(new Error('row-level security'), {
      code: '42501',
    });
    const { body, status } = toProblemBody(pgErr, INSTANCE);
    expect(status).toBe(400);
    expect(body).toMatchObject({ code: 'CROSS_TENANT_VIOLATION', status: 400 });
  });

  it('Drizzle ラッパ越し（cause チェーン経由）の 42501 も拾える', () => {
    const inner = Object.assign(new Error('rls'), { code: '42501' });
    const wrapped = Object.assign(new Error('drizzle wrap'), { cause: inner });
    const { body } = toProblemBody(wrapped, INSTANCE);
    expect(body).toMatchObject({ code: 'CROSS_TENANT_VIOLATION' });
  });

  it('Hono の HTTPException は about:blank + HTTP_EXCEPTION でマップ', () => {
    const { body, status } = toProblemBody(
      new HTTPException(418, { message: "I'm a teapot" }),
      INSTANCE,
    );
    expect(status).toBe(418);
    expect(body).toMatchObject({
      type: 'about:blank',
      code: 'HTTP_EXCEPTION',
      status: 418,
      detail: "I'm a teapot",
    });
  });

  it('未知のエラーは 500 INTERNAL_SERVER_ERROR にフォールバック', () => {
    const { body, status } = toProblemBody(new Error('boom'), INSTANCE);
    expect(status).toBe(500);
    expect(body).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      status: 500,
    });
  });

  it('ValidationError そのものを直接渡しても保持される（再変換しない）', () => {
    const ve = new ValidationError('custom', [{ name: 'foo', reason: 'bar' }]);
    const { body, status } = toProblemBody(ve, INSTANCE);
    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: 'VALIDATION_ERROR',
      detail: 'custom',
      errors: [{ name: 'foo', reason: 'bar' }],
    });
  });
});
