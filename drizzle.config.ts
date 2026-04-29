import * as dotenv from 'dotenv';
import { defineConfig } from 'drizzle-kit';

dotenv.config({ path: '.env' });

export default defineConfig({
  out: './src/db/migrations',
  schema: './src/db/schema/*',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.MIGRATOR_DATABASE_URL!,
  },
  verbose: true,
  strict: true,
  casing: 'snake_case',
  migrations: {
    schema: 'public',
    table: '__drizzle_migrations',
  }
})
