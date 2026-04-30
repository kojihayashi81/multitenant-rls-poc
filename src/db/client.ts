import 'dotenv/config';
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.APP_DATABASE_URL;

if (!connectionString) {
  throw new Error('env APP_DATABASE_URL is not set');
}

export const pool = new Pool({
  connectionString: connectionString,
  max: 10,
});

// casing: 'snake_case' must be passed at runtime too (drizzle.config.ts only
// affects drizzle-kit migration generation, not the runtime SQL builder).
// Without this, db.select() would emit `"createdAt"` while the DB has
// `created_at`, causing "column does not exist" errors.
export const db = drizzle({ client: pool, schema, casing: 'snake_case' });
