import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

const id = uuid()
  .primaryKey()
  .$defaultFn(() => uuidv7());

const name = text()
  .notNull();

const createdAt = timestamp({ withTimezone: true })
  .defaultNow()
  .notNull();

const updatedAt = timestamp({ withTimezone: true })
  .defaultNow()
  .notNull();

export const tenantsTable = pgTable("tenants", {
  id: id,
  name: name,
  createdAt: createdAt,
  updatedAt: updatedAt,
});
