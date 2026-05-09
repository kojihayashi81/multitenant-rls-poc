/**
 * 成功レスポンスの共通エンベロープ。
 *
 * RFC 9457 Problem Details が「失敗」の表現を統一するのと対称に、本 PoC では
 * 「成功」も `data` を必須キーとした単一の形に揃える。これにより：
 *   - クライアントは常に `body.data` を見れば本体を取り出せる
 *   - 一覧系の `meta`（count, ページング等）と単体系を、同じ envelope の
 *     拡張として表現できる（JSON:API 流儀に近い）
 *
 * 失敗側 (`ProblemDetails`) と違って公式 RFC は無いが、「単数 `data` キーに
 * 包む」のが最も広く使われている事実上の標準なので、それを基底とする。
 */

/** 単一リソースの成功レスポンス。POST/PUT/GET-by-id で使う。 */
export type ItemResponse<TData> = {
  data: TData;
};

/** 一覧レスポンスのメタ情報。最低限 count、必要に応じて拡張（page, total 等）。 */
export type ListMeta = {
  count: number;
};

/** 一覧の成功レスポンス。GET /posts のような複数件返却で使う。 */
export type ListResponse<TItem, TMeta extends ListMeta = ListMeta> = {
  data: TItem[];
  meta: TMeta;
};

/** ItemResponse の生成ヘルパ。型推論を効かせるためだけの薄いラッパ。 */
export function item<T>(data: T): ItemResponse<T> {
  return { data };
}

/** ListResponse の生成ヘルパ。`count` は配列長から自動算出。 */
export function list<T>(items: T[]): ListResponse<T> {
  return { data: items, meta: { count: items.length } };
}
