
import { foreignKey, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

const id = uuid()
  .primaryKey()
  .$defaultFn(() => uuidv7());

const tenantId = uuid("tenant_id")
  .notNull();

const userId = uuid("user_id")
  .notNull();

const title = text()
  .notNull();

const body = text();

const createdAt = timestamp({ withTimezone: true })
  .defaultNow()
  .notNull();

const updatedAt = timestamp({ withTimezone: true })
  .defaultNow()
  .notNull();

export const postsTable = pgTable('posts', {
  id: id,
  tenantId: tenantId,
  userId: userId,
  title: title,
  body: body,
  createdAt: createdAt,
  updatedAt: updatedAt,
}, (table) => [
  foreignKey({
    name: "tenant_id_fk",
    columns: [table.tenantId],
    foreignColumns: [tenantsTable.id],
  })
    .onDelete('cascade'),
  foreignKey({
    name: "user_id_fk",
    columns: [table.userId],
    foreignColumns: [usersTable.id],
  })
    .onDelete('cascade'),
]);
