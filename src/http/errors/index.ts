import { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpStatus } from "../status";

/**
 * fromZodError が必要とする最小の構造。
 * ZodError（公開クラス）でも $ZodError（@hono/zod-validator 経由で来る内部クラス）でも
 * このシグネチャを満たすので、Zod 内部実装の差を吸収できる。
 */
type ZodErrorLike = {
  issues: ReadonlyArray<{
    path: ReadonlyArray<PropertyKey>;
    message: string;
  }>;
};

export const TYPE_BASE = "https://github.com/kojihayashi81/multitenant-rls-poc/errors";

/**
 * RFC 9457 §3 が Problem Details レスポンスに義務付ける Content-Type。
 * 「ボディが Problem Details 形式である」ことをクライアントに伝えるシグナル。
 */
export const PROBLEM_JSON_MEDIA_TYPE = "application/problem+json" as const;

export const ErrorType = {
  VALIDATION: `${TYPE_BASE}/validation-error`,
  TENANT_HEADER: `${TYPE_BASE}/tenant-header-missing`,
  NOT_FOUND: `${TYPE_BASE}/not-found`,
  CROSS_TENANT: `${TYPE_BASE}/cross-tenant-violation`,
  DATABASE: `${TYPE_BASE}/database-error`,
  INTERNAL: `${TYPE_BASE}/internal-server-error`,
  /**
   * RFC 9457 §4.1: type が省略されたり `about:blank` の場合は
   * 「標準 HTTP ステータス以上の追加情報がない」ことを意味する。
   * Hono の HTTPException など、フレームワーク経由で出る汎用エラーで使う。
   */
  HTTP_EXCEPTION: 'about:blank',
} as const;

export type ErrorType = typeof ErrorType[keyof typeof ErrorType];

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  TENANT_HEADER_MISSING: 'TENANT_HEADER_MISSING',
  NOT_FOUND: 'NOT_FOUND',
  CROSS_TENANT_VIOLATION: 'CROSS_TENANT_VIOLATION',
  DATABASE_ERROR: 'DATABASE_ERROR',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  HTTP_EXCEPTION: 'HTTP_EXCEPTION',
} as const;

export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];

export type ProblemDetails<TErrors = undefined> = {
  type: ErrorType;
  code: ErrorCode;
  title: string;
  status: ContentfulStatusCode;
  detail: string;
  instance?: string;
} & (TErrors extends undefined ? {} : { errors: TErrors });

// ============================================================================
// 基底クラス（ジェネリックで errors の型を指定）
// ============================================================================

export abstract class AppError<TErrors = undefined> extends Error {
  /** エラーの種類を識別するURI (例: "/errors/not-found")。クラスごとに固定。 */
  abstract readonly type: ErrorType;
  /** エラーの種類を識別するURI (例: "/errors/not-found")。クラスごとに固定。 */
  abstract readonly code: ErrorCode;
  /** エラーの簡潔な概要 (例: "Not Found")。クラスごとに固定。 */
  abstract readonly title: string;
  /** HTTP ステータスコード (例: 404)。クラスごとに固定。 */
  abstract readonly status: ContentfulStatusCode;
  /** エラーに関する追加の構造化された詳細情報。クラスごとに型を固定（undefined = 拡張なし）。 */
  abstract readonly errors: TErrors;

  /**
   * このエラーの発生理由に関する人間可読な詳細メッセージ。
   * インスタンスごとに変わるため abstract ではなく constructor 注入で受ける
   * （Error.message と一致させるためにも super(detail) に渡す必要がある）。
   */
  constructor(public readonly detail: string) {
    super(detail);
    this.name = this.constructor.name;
  }

  toProblemDetails(instance?: string): ProblemDetails<TErrors> {
    const base = {
      type: this.type,
      code: this.code,
      title: this.title,
      status: this.status,
      detail: this.detail,
      ...(instance !== undefined ? { instance } : {}),
    };

    return (
      this.errors !== undefined
        ? { ...base, errors: this.errors }
        : base
    ) as ProblemDetails<TErrors>;
  }
}

// ============================================================================
// 各エラーの errors 拡張型
// ============================================================================

export type NotFoundErrors = {
  resource: string;
  id?: string;
};

export type InvalidParam = {
  name: string;
  reason: string;
};

/**
 * ValidationError の拡張ペイロードは「不正パラメータの配列」そのもの。
 * `errors` キーの下に `invalidParams` を挟まず、配列を直に置く。
 *
 * 設計方針：`errors` を「エラー種別ごとの拡張詳細を入れる共通バケツ」と
 * 位置づけ、形は `code` で discriminate する。クライアントは常に
 * `body.errors` を見れば詳細を取り出せ、形の解釈は `body.code` の switch
 * で型安全に行える。
 */
export type ValidationErrors = InvalidParam[];

export class ValidationError extends AppError<ValidationErrors> {
  readonly type = ErrorType.VALIDATION;
  readonly code = ErrorCode.VALIDATION_ERROR;
  readonly title = "Validation failed";
  readonly status = HttpStatus.BAD_REQUEST;
  readonly errors: ValidationErrors;

  constructor(detail: string, invalidParams: InvalidParam[]) {
    super(detail);
    this.errors = invalidParams;
  }

  /**
   * ZodError を ValidationError に変換する。
   *
   * @param zodError - Zod の safeParse / parse から返された ZodError
   * @param options.detail - 人間可読なエラー概要
   * @param options.fieldPathPrefix - issue.path の頭に付けるプレフィックス
   *   （例: "x-tenant-id" なら "x-tenant-id.0" のような name が出る）
   */
  static fromZodError(
    zodError: ZodErrorLike,
    options: { detail?: string; fieldPathPrefix?: string } = {},
  ): ValidationError {
    const { detail = "Request validation failed", fieldPathPrefix } = options;

    const invalidParams: InvalidParam[] = zodError.issues.map((issue) => {
      const path = [fieldPathPrefix, ...issue.path.map(String)].filter(Boolean);
      return {
        name: path.length > 0 ? path.join(".") : "(root)",
        reason: issue.message,
      };
    });

    return new ValidationError(detail, invalidParams);
  }
}

export class TenantHeaderMissingError extends AppError {
  readonly type = ErrorType.TENANT_HEADER;
  readonly code = ErrorCode.TENANT_HEADER_MISSING;
  readonly title = "Tenant header missing";
  readonly status = HttpStatus.UNAUTHORIZED;
  readonly errors = undefined;

  constructor(detail = "x-tenant-id header is missing") {
    super(detail);
  }
}

export class NotFoundError extends AppError<NotFoundErrors> {
  readonly type = ErrorType.NOT_FOUND;
  readonly code = ErrorCode.NOT_FOUND;
  readonly title = "Resource not found";
  readonly status = HttpStatus.NOT_FOUND;
  readonly errors: NotFoundErrors;

  constructor(resource: string, id?: string) {
    super(`${resource} not found`);
    this.errors = id ? { resource, id } : { resource };
  }
}

export class RLSWriteError extends AppError {
  readonly type = ErrorType.CROSS_TENANT;
  readonly code = ErrorCode.CROSS_TENANT_VIOLATION;
  readonly title = "Cross-tenant violation";
  readonly status = HttpStatus.BAD_REQUEST;
  readonly errors = undefined;

  constructor(
    detail = "The operation references data that does not belong to your tenant",
  ) {
    super(detail);
  }
}

export class DatabaseError extends AppError {
  readonly type = ErrorType.DATABASE;
  readonly code = ErrorCode.DATABASE_ERROR;
  readonly title = "Database error";
  readonly status = HttpStatus.INTERNAL_SERVER_ERROR;
  readonly errors = undefined;

  constructor(detail = "Database error") {
    super(detail);
  }
}
