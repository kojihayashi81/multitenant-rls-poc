# rls-poc

PostgreSQL Row Level Security の学習用 POC。Hono + Drizzle ORM + PostgreSQL 16。

## Prerequisites

- Node.js >= 20
- pnpm
- Docker / Docker Compose

## Setup

```sh
cp .env.example .env
pnpm install
pnpm db:up
```

## Scripts

| script | purpose |
| --- | --- |
| `pnpm dev` | Hono サーバ起動（watch） |
| `pnpm db:up` / `db:down` / `db:reset` | Postgres コンテナ管理 |
| `pnpm db:psql` | コンテナ内 psql に入る |
| `pnpm typecheck` | tsc --noEmit |
| `pnpm test` | vitest |

## 設計判断 / 学んだこと

（フェーズ 5 で本人が記述）
