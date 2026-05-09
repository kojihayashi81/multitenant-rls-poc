/**
 * x-tenant-id ヘッダの攻撃面テスト（M6-C）。
 *
 * 既存の `tests/middleware/with-tenant.test.ts` は基本ケース
 * （missing / invalid UUID / valid / UUIDv4 拒否）をカバーする。
 * ここではそれを補完して、悪意あるヘッダや形式の揺れに対しても
 * 「黙って通す」ことが無いことを検証する。
 *
 * 全テスト DB 不要（middleware が DB 接続前に弾く）。
 */

import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';

const T1 = '01900000-0000-7000-8000-000000000001';
const T2 = '01900000-0000-7000-8000-000000000002';

describe('x-tenant-id header attack surface', () => {
  it('空文字列ヘッダは「不在」扱い → 401 TENANT_HEADER_MISSING', async () => {
    const app = createApp();
    const res = await app.request('/posts', {
      headers: { 'x-tenant-id': '' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('TENANT_HEADER_MISSING');
  });

  it('UUID 内部に空白が混じっていれば弾かれる（外側の OWS は HTTP 層で trim される）', async () => {
    // RFC 7230: HTTP の header-value は前後の OWS（optional whitespace）が
    // 取り除かれる。だから ` ${T1} ` を送っても middleware には trim 済の値が届く。
    // これは HTTP 仕様準拠の挙動なので、防御層として検証すべきは「値の中身に
    // 空白が紛れ込んだ場合に弾けるか」のほう。
    const app = createApp();
    const malformed = `${T1.slice(0, 18)} ${T1.slice(19)}`;
    const res = await app.request('/posts', {
      headers: { 'x-tenant-id': malformed },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it("SQL injection 風の payload は uuidv7 で弾かれる（DB に到達しない）", async () => {
    const app = createApp();
    const res = await app.request('/posts', {
      headers: {
        'x-tenant-id': `${T1}'; DROP TABLE posts; --`,
      },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('UUID の形式に近いが version 桁が 0 の値は弾かれる', async () => {
    const app = createApp();
    // version 桁を 0 に。シンタックスは UUID だが UUIDv7 ではない
    const v0 = '01900000-0000-0000-8000-000000000001';
    const res = await app.request('/posts', {
      headers: { 'x-tenant-id': v0 },
    });
    expect(res.status).toBe(400);
  });

  it('複数の x-tenant-id ヘッダはカンマ結合され、UUIDv7 として無効になる → 400', async () => {
    const app = createApp();
    // Headers コンストラクタが同名ヘッダをカンマ結合する仕様を利用。
    // 攻撃者が「正しい UUID を 2 つ並べて、サーバが片方だけ採用する実装に依存」
    // しようとしても、結合された "T1, T2" は UUID として無効。
    const headers = new Headers();
    headers.append('x-tenant-id', T1);
    headers.append('x-tenant-id', T2);

    const res = await app.request('/posts', { headers });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('1 文字でも文字数が足りない UUID は弾かれる', async () => {
    const app = createApp();
    const truncated = T1.slice(0, -1); // 末尾 1 文字落とし
    const res = await app.request('/posts', {
      headers: { 'x-tenant-id': truncated },
    });
    expect(res.status).toBe(400);
  });

  it('hex 範囲外の文字（g-z）が混じった UUID 風文字列は弾かれる', async () => {
    const app = createApp();
    const bogus = '01900000-0000-7000-8000-zzzzzzzzzzzz';
    const res = await app.request('/posts', {
      headers: { 'x-tenant-id': bogus },
    });
    expect(res.status).toBe(400);
  });
});
