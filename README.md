# rls-poc

PostgreSQL Row Level Security でマルチテナント分離を実装する学習用 PoC。
Hono + Drizzle ORM + PostgreSQL 16。

## このリポジトリで示しているもの

- **3 ロール構成**（`postgres` / `migrator` / `app_user`）でアプリ接続が DDL を打てない最小権限
- **`FORCE ROW LEVEL SECURITY`** によるテーブル所有者ごと封じ込め
- **トランザクション境界の `set_config('app.tenant_id', _, true)`** でセッション再利用時の汚染を防ぐ
- **RLS ポリシー** を `USING` / `WITH CHECK` のコマンド別（SELECT/INSERT/UPDATE/DELETE）で書き分け
- **HTTP 層**：`@hono/zod-validator` + RFC 9457 Problem Details + 単一の `errors` バケツ規約
- **多層テスト**：unit (vitest) / DB 統合 (vitest+real PG) / security (vitest) / E2E (Playwright)

## Prerequisites

- Node.js >= 20
- pnpm
- Docker / Docker Compose

## Quick start

```sh
cp .env.example .env
pnpm install
pnpm db:up                              # Postgres 16 を起動
pnpm drizzle-kit migrate                # スキーマ + ロール + RLS をマイグレート
pnpm db:seed                            # 開発用 fixture を流し込む
pnpm dev                                # http://localhost:3000
```

すぐに動作確認したいときは [API examples](#api-examples-curl) の curl を参照。

## Scripts

| script | purpose |
| --- | --- |
| `pnpm dev` | Hono サーバを watch モードで起動 |
| `pnpm start` | Hono サーバを起動（一回限り） |
| `pnpm db:up` / `db:down` / `db:reset` | Postgres コンテナ管理 |
| `pnpm db:psql` | コンテナ内 psql に入る |
| `pnpm db:seed` | `src/db/seeds/dev.sql` を流し込む |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | vitest（unit + integration + security） |
| `pnpm test:e2e` | Playwright（実サーバ越しの API E2E） |

## Architecture

### ロール構成

| ロール | 用途 | テーブル所有 | RLS の影響 |
| --- | --- | --- | --- |
| `postgres` (SUPERUSER) | DB 作成・seed・運用緊急対応 | × | バイパス |
| `migrator` | スキーマ DDL / ポリシー定義 | ○ | `FORCE` で同様にバイパス不可 |
| `app_user` | アプリの実行時接続 | × | ポリシーで完全に制約 |

`migrator` がテーブルを所有しても **`FORCE ROW LEVEL SECURITY`** を有効にしているので
所有者であっても RLS から逃げられない。アプリは **`APP_DATABASE_URL` (=`app_user`)** だけ
を環境変数で受け取る（`ADMIN_DATABASE_URL` はテストの seed リセット専用）。

### `withTenant` ヘルパ

```ts
await withTenant(tenantId, async (tx) => tx.select().from(postsTable));
```

内部実装：

1. `tenantIdSchema` (Zod `uuidv7`) で `tenantId` を**事前検証**（ZodError で fail-fast）
2. `db.transaction` の中で `SELECT set_config('app.tenant_id', $1, true)` を発行（`true` = `IS_LOCAL`）
3. コールバックに `tx` を渡す

`SET LOCAL` 相当の効果は **トランザクション終了で自動破棄** されるので、
プールがコネクションを再利用しても次のリクエストに `app.tenant_id` が漏れない。
セッションレベル `SET` ならどう汚染するかは `tests/db/with-tenant.test.ts` の
`DANGER` 節で characterization test として再現してある。

### RLS ポリシー設計

`src/db/migrations/0003_enable_rls.sql` 参照。

- 各テーブルに `ENABLE` + `FORCE ROW LEVEL SECURITY`
- **コマンド別**にポリシーを書き分け：
  - `SELECT` の `USING`：自テナントのみ可視
  - `INSERT` の `WITH CHECK`：自テナントの行しか書けない
  - `UPDATE` の `USING` + `WITH CHECK`：他テナントの行を更新できない、かつ別テナントへ tenant_id を変えられない
  - `DELETE` の `USING`：他テナントの行を消せない
- **`posts.user_id` の越境攻撃** に対しては `INSERT/UPDATE` の WITH CHECK に `EXISTS (SELECT 1 FROM users WHERE id = posts.user_id AND tenant_id = posts.tenant_id)` を入れて、user_id だけ別テナントに付け替える攻撃を遮断
- 設定参照は **厳格モード** `current_setting('app.tenant_id')::uuid`（第 2 引数なし）を使う。
  `withTenant` を呼び忘れた瞬間に `unrecognized configuration parameter` で停止する 設計
  （silent な空集合返却よりラウドに失敗させる方が事故を見つけやすい）

### HTTP エラー規約：RFC 9457 Problem Details

すべてのエラー応答は **`Content-Type: application/problem+json`** で返却。

```json
{
  "type":     "https://github.com/.../errors/validation-error",
  "code":     "VALIDATION_ERROR",
  "title":    "Validation failed",
  "status":   400,
  "detail":   "x-tenant-id header is not a valid UUIDv7",
  "instance": "/posts",
  "errors":   [{ "name": "x-tenant-id", "reason": "Invalid UUIDv7" }]
}
```

| キー | 意味 |
| --- | --- |
| `type` | エラー種別を識別する URI（クラスごとに固定） |
| `code` | クライアント側 switch の discriminator |
| `title` | エラーの簡潔な概要（クラスごとに固定） |
| `status` | HTTP status code |
| `detail` | インスタンスごとの人間可読な詳細 |
| `instance` | 発生したリクエストパス |
| `errors` | エラー種別ごとの追加情報（形は `code` で確定する共通バケツ） |

クライアント契約：

1. **`res.ok` が一次判定**（status code は HTTP の本義）
2. 失敗時は `body.code` で switch、必要なら `body.errors` を解釈
3. 成功時は `body.data` を起点に取り出す（`{ data: T }` or `{ data: T[], meta: { count } }`）

エラーの全分岐は `src/http/error-mapping.ts` の `toProblemBody` に集約：

| 入力 | 出力 |
| --- | --- |
| `AppError` 派生 | そのまま `toProblemDetails` に委譲 |
| `ZodError` | `ValidationError` に変換 |
| pg エラーコード `42501` | `RLSWriteError`（cause チェーンを 5 段までたどる） |
| Hono `HTTPException` | `about:blank` + `HTTP_EXCEPTION` |
| その他 | `INTERNAL_SERVER_ERROR`（stderr へログ） |

`src/app.ts` の `onError` は I/O のみ（toProblemBody → JSON.stringify → problem+json で返す）に絞られていて、
将来 traceId 埋め込みやエラーマスキングを追加する際の差し込み口が 1 箇所に集約されている。

### Status code マッピング

| シナリオ | status | 理由 |
| --- | --- | --- |
| `x-tenant-id` 不在 | **401** | 認証情報の不備（本番では JWT 不在に対応） |
| 入力バリデーション失敗 | **400** | クライアント入力の形式エラー |
| 自テナントに見えない id（他テナント or 不在） | **404** | RLS による存在隠蔽 |
| 越境 INSERT / UPDATE 試行 | **400** | 入力の業務的エラー（pg 42501） |
| `Hono.HTTPException` | err.status のまま | フレームワーク標準 |
| 想定外の例外 | **500** | サーバ責任 |

## Testing

| 層 | ランナー | ファイル | 件数 |
| --- | --- | --- | --- |
| Unit (pure) | vitest | `tests/http/error-mapping.test.ts` | 8 |
| Middleware (in-process) | vitest | `tests/middleware/with-tenant.test.ts` | 4 |
| DB integration | vitest | `tests/db/with-tenant.test.ts` | 6 |
| Security: failsafe | vitest | `tests/security/rls-failsafe.test.ts` | 9 |
| Security: header attack | vitest | `tests/security/header-attack.test.ts` | 7 |
| **E2E (out-of-process)** | **Playwright** | `tests/e2e/cross-tenant.spec.ts` | **8** |

実行：

```sh
pnpm test            # vitest 5 ファイル / 34 テスト
pnpm test:e2e        # Playwright 1 ファイル / 8 テスト（webServer が pnpm start を自動起動）
```

E2E は `playwright.config.ts` の `webServer` がローカルで動いているサーバを再利用する
（`reuseExistingServer: !CI`）ので、`pnpm dev` 起動中なら既存プロセスに接続する。

## API examples (curl)

サーバ起動後（`pnpm dev`）に試せる代表シナリオ。

```sh
T1=01900000-0000-7000-8000-000000000001
T2=01900000-0000-7000-8000-000000000002
T1_ALICE=01900000-0000-7000-8000-aaaaaaaaaaaa
T2_CAROL=01900000-0000-7000-8000-cccccccccccc
T2_POST=01900000-0000-7000-8000-ffffffffffff
```

| # | コマンド | 期待 |
| --- | --- | --- |
| 1 | `curl -i :3000/posts` | 401 `tenant-header-missing` |
| 2 | `curl -i :3000/posts -H "x-tenant-id: not-a-uuid"` | 400 `validation-error` + `errors[0].name=x-tenant-id` |
| 3 | `curl :3000/posts -H "x-tenant-id: $T1"` | 200, posts 2 件（Alice / Bob） |
| 4 | `curl :3000/posts -H "x-tenant-id: $T2"` | 200, posts 1 件（Carol） |
| 5 | `curl -i :3000/posts/$T2_POST -H "x-tenant-id: $T1"` | 404 `not-found`（存在隠蔽） |
| 6 | `curl -X POST :3000/posts -H "x-tenant-id: $T1" -H 'content-type: application/json' -d "{\"title\":\"hi\",\"userId\":\"$T1_ALICE\"}"` | 201, 作成された post |
| 7 | `curl -i -X POST :3000/posts -H "x-tenant-id: $T1" -H 'content-type: application/json' -d "{\"title\":\"x\",\"userId\":\"$T2_CAROL\"}"` | 400 `cross-tenant-violation` |
| 8 | `curl -i -X PUT :3000/posts/$T2_POST -H "x-tenant-id: $T1" -H 'content-type: application/json' -d '{"title":"hacked"}'` | 404 `not-found` |

## Project layout

```text
src/
├── app.ts                       Hono factory + onError（薄い I/O 層）
├── server.ts                    @hono/node-server エントリポイント
├── db/
│   ├── client.ts                pg.Pool + Drizzle (app_user 接続)
│   ├── with-tenant.ts           withTenant ヘルパ + tenantIdSchema
│   ├── schema/                  Drizzle スキーマ（tenants/users/posts）
│   ├── migrations/              0000-0003: 初期 → trigger → roles → RLS
│   └── seeds/dev.sql            開発用 fixture（UUIDv7、TRUNCATE で再投入可）
├── handlers/posts.ts            /posts CRUD（5 endpoint）
├── http/
│   ├── status.ts                HttpStatus 定数
│   ├── errors/index.ts          AppError 階層 + ProblemDetails 型 + 各種定数
│   ├── error-mapping.ts         任意の throw 値 → ProblemDetails の純粋関数
│   ├── response.ts              ItemResponse / ListResponse + ヘルパ
│   └── zod-validator.ts         @hono/zod-validator → ValidationError ラッパ
├── middleware/tenant-context.ts x-tenant-id 抽出 + 検証 + c.set
└── schemas/posts.ts             Zod スキーマ（param / create body / update body）

tests/
├── db/                          DB 統合（withTenant + 実 RLS）
├── middleware/                  app.request 駆動の middleware 単体
├── http/                        Pure 関数のユニット（error-mapping）
├── security/                    failsafe (RLS) と header attack
└── e2e/                         Playwright（実 HTTP 越し）
    ├── cross-tenant.spec.ts
    ├── global-setup.ts
    └── helpers/seed.ts
```

## 主な設計判断

### なぜ `SET LOCAL` か（セッション SET ではなく）

`pg.Pool` はリクエスト終了時にコネクションを物理的に切らずプールへ返す。セッション
レベル `SET` は接続が切れるまで残るので、**次のリクエストに前リクエストのテナント
コンテキストが漏れる**。`SET LOCAL`（`set_config(_, _, true)`）は現在の transaction
が終わると自動で巻き戻されるため、プール再利用と相性が良い。
`tests/db/with-tenant.test.ts` の `DANGER` 節がこの汚染を再現している。

### なぜ `FORCE ROW LEVEL SECURITY` か

`ENABLE ROW LEVEL SECURITY` だけだと **テーブル所有者** はポリシーをバイパスする。
本構成では `migrator` が所有者なので、`FORCE` を付けないと「マイグレータ接続を流用
した運用クエリ」がポリシーを無視する穴になる。

### なぜ `errors` を共通バケツにしたか

クライアントが「常に同じキー（`body.errors`）を見れば詳細を取り出せる」契約を立てる
ことで、エラー種別が増えても **`code` で switch する 1 箇所**を更新するだけで済む。
JSON:API のような業界慣例に近く、SSOT を強制可能にするための土台。

### なぜ Playwright の `request` フィクスチャだけ使うのか

PoC にフロントが無いので、ブラウザバイナリは不要。Playwright を選んだのは
「**実プロセスで起動した本物のサーバを実 HTTP で叩く**」黒箱層が欲しかったからで、
将来 UI を足したときに同じランナーで `page` フィクスチャに拡張できる。

## ドキュメント / マイルストン履歴

PoC は M2〜M6 のマイルストン単位で進めた。各回の **設計議論の Q&A ログ**（Claude
Code セッションの逐語）と **クリーンな仕様** は [docs/roadmap/](./docs/roadmap/) に。
全体俯瞰と原案からの差分は [docs/roadmap/README.md](./docs/roadmap/README.md)。

| ID | やったこと | ログ |
| --- | --- | --- |
| M2 | 3 ロール構成（`postgres` / `migrator` / `app_user`）と権限分離 | [M2.md](./docs/roadmap/M2.md) |
| M3 / M3_2 | RLS の `ENABLE` / `FORCE` と、コマンド別 `USING` / `WITH CHECK` ポリシー | [M3.md](./docs/roadmap/M3.md) / [M3_2.md](./docs/roadmap/M3_2.md) |
| M4 | `withTenant` ヘルパ（トランザクション内 `set_config`）と DB 統合テスト | [M4.md](./docs/roadmap/M4.md) |
| M5 | Hono ミドルウェア + posts CRUD + RFC 9457 Problem Details | [M5.md](./docs/roadmap/M5.md) |
| M6 | 破壊テスト：越境攻撃マトリクス（Playwright E2E）+ RLS failsafe + ヘッダ攻撃面 | [M6.md](./docs/roadmap/M6.md) |
