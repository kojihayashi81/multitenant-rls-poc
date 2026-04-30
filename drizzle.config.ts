import * as dotenv from 'dotenv';
import { defineConfig } from 'drizzle-kit';

dotenv.config({ path: '.env' });

export default defineConfig({
  out: './src/db/migrations',
  schema: './src/db/schema/*',
  dialect: 'postgresql',
  dbCredentials: {
    // Bootstrap-friendly: ADMIN_DATABASE_URL works on a fresh DB where the
    // migrator role does not yet exist (created by 0002). For production
    // deploys (where db:reset is not used), switching to MIGRATOR_DATABASE_URL
    // after the first migrate gives stricter least-privilege for ongoing DDL.
    url: process.env.ADMIN_DATABASE_URL!,
  },
  verbose: true,
  strict: true,
  casing: 'snake_case',
  migrations: {
    schema: 'public',
    table: '__drizzle_migrations',
  }
})
