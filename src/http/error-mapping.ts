/**
 * 任意の throw 値を RFC 9457 Problem Details ボディ + HTTP status に変換する
 * 純粋関数。Hono の Context には依存しないので、`instance` は呼び出し側で
 * 計算して渡す（テストでは固定文字列を渡せる）。
 *
 * onError の I/O から分岐ロジックを分離するための層。Strategy パターン化はせず、
 * if/else のまま「上から順に当てはまったものを採用」する読み下しを維持する。
 */

import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import {
  AppError,
  ErrorCode,
  ErrorType,
  RLSWriteError,
  ValidationError,
} from './errors';
import { HttpStatus } from './status';

/** PostgreSQL: insufficient_privilege（RLS ポリシー違反のときに発生）。 */
const PG_RLS_VIOLATION = '42501';

/**
 * pg のエラーは Drizzle の DrizzleQueryError などにラップされて来うるので、
 * `cause` チェーンを 5 段までたどって `code` を確認する。深く掘りすぎないのは
 * 循環参照や巨大オブジェクトでループしないため。
 */
function findPgErrorCode(err: unknown, code: string): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    if (typeof cur === 'object' && cur !== null) {
      if ((cur as { code?: unknown }).code === code) return true;
      cur = (cur as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return false;
}

export type ProblemMapping = {
  body: object;
  status: ContentfulStatusCode;
};

export function toProblemBody(err: unknown, instance: string): ProblemMapping {
  if (err instanceof AppError) {
    return { body: err.toProblemDetails(instance), status: err.status };
  }

  if (err instanceof ZodError) {
    const e = ValidationError.fromZodError(err);
    return { body: e.toProblemDetails(instance), status: e.status };
  }

  if (findPgErrorCode(err, PG_RLS_VIOLATION)) {
    const e = new RLSWriteError();
    return { body: e.toProblemDetails(instance), status: e.status };
  }

  if (err instanceof HTTPException) {
    return {
      body: {
        type: ErrorType.HTTP_EXCEPTION,
        code: ErrorCode.HTTP_EXCEPTION,
        title: 'HTTP error',
        status: err.status,
        detail: err.message || 'HTTP error',
        instance,
      },
      status: err.status,
    };
  }

  // ここに来るのは想定外。原因究明のためにスタックを残す。
  console.error('[UnhandledError]', err);
  return {
    body: {
      type: ErrorType.INTERNAL,
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'An unexpected error occurred',
      instance,
    },
    status: HttpStatus.INTERNAL_SERVER_ERROR,
  };
}
