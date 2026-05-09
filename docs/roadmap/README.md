# Roadmap

PoC のマイルストン計画と実施記録。

## ファイルの性質

`M*.md` は **Claude Code セッションでの対話ログ**。各ファイルは「事前理解の確認 →
設計判断 → 実装範囲 → 完了判定」という Q&A 形式で進行しており、`⏺` マーカは Claude
の発言、地の文（質問への回答）はオーナー（@kojihayashi81）の判断を表す。

何を採用したか／なぜそう決めたかは対話の流れに残っているので、後から決定の経緯を
追える。一方で「現在の正解」は `M*.md` ではなく **コード本体** と
[../../README.md](../../README.md) を見るのが確実（マイルストン後の追加リファクタや
方針変更がコード側にだけ反映されているケースがある）。

## マイルストン一覧

| ID | テーマ | ログ | 状態 |
| --- | --- | --- | --- |
| M1 | 初期スキーマ + Drizzle 設定 | （リポジトリ初期コミット） | ✅ 完了 |
| M2 | 3 ロール構成 (`postgres` / `migrator` / `app_user`) | [M2.md](./M2.md) | ✅ 完了 |
| M3 | RLS ポリシー（`ENABLE` + `FORCE` とコマンド別 `USING` / `WITH CHECK`） | [M3.md](./M3.md) | ✅ 完了 |
| M4 | `withTenant` ヘルパ + DB 統合テスト | [M4.md](./M4.md) | ✅ 完了 |
| M5 | Hono ミドルウェア + 5 endpoint CRUD + RFC 9457 | [M5.md](./M5.md) | ✅ 完了 |
| M6 | 破壊テスト（security + E2E） | [M6.md](./M6.md) | ✅ 完了 |

## M5 実装での原案からの差分

`M5.md` の原案 → 実装で意図的に変更した点。理由はコード本体のコメントと
README の「主な設計判断」に残してある。

| 観点 | 原案 (M5.md) | 実装 |
| --- | --- | --- |
| ファイル配置 | `src/errors.ts` フラット | `src/http/errors/index.ts`（HTTP 層を `src/http/` に集約） |
| 成功レスポンス | 手書き `c.json({ posts })` | `{ data, meta? }` envelope を `src/http/response.ts` に共通化 |
| エラー応答の拡張 | RFC 例文に近い「トップレベルにスプレッド」案も検討 | 共通 `errors` バケツに統一（クライアント SSOT 重視） |
| エラー分岐の構造 | `app.onError` 内に if/else 集積 | 純粋関数 `toProblemBody` に分離（`src/http/error-mapping.ts`）し、`app.ts` は I/O のみ |
| 定数化 | リテラル散在 | `ErrorType` / `ErrorCode` / `PROBLEM_JSON_MEDIA_TYPE` に集約 |
| エントリポイント | `src/index.ts` を残す案も | `src/index.ts` 廃止、`src/server.ts` に統一 |
| `/health` エンドポイント | （言及なし） | Playwright `webServer` のヘルスプローブ用に追加 |

## M6 で増えたテスト層

`M5.md` 完了判定の curl 8 シナリオは **手動検証**。M6 でこれを自動化しつつ、
さらに防御層別のテストを追加した。詳細は [M6.md](./M6.md)。

| 層 | ランナー | 追加ファイル | 件数 |
| --- | --- | --- | --- |
| E2E (out-of-process) | Playwright | `tests/e2e/cross-tenant.spec.ts` | 8 |
| Security: RLS failsafe | vitest | `tests/security/rls-failsafe.test.ts` | 9 |
| Security: header attack | vitest | `tests/security/header-attack.test.ts` | 7 |

## 今後の候補（未着手）

- CI（GitHub Actions で `pnpm typecheck` + `pnpm test` + `pnpm test:e2e`）
- pagination / soft delete / audit log などの機能拡張
- クライアント型共有（モノレポ化したときに `packages/api-types/` へ切り出し）
- ADR（`docs/adr/`）として個別の意思決定を粒度を揃えて残す
