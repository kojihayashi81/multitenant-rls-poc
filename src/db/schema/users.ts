import { foreignKey, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { tenantsTable } from "./tenants";

const id = uuid()
  .primaryKey()
  .$defaultFn(() => uuidv7());

const tenantId = uuid("tenant_id")
  .notNull();

const email = text()
  .notNull();

const name = text()
  .notNull();

const createdAt = timestamp({ withTimezone: true })
  .defaultNow()
  .notNull();

const updatedAt = timestamp({ withTimezone: true })
  .defaultNow()
  .notNull();

export const usersTable = pgTable('users', {
  id: id,
  tenantId: tenantId,
  email: email,
  name: name,
  createdAt: createdAt,
  updatedAt: updatedAt,
}, (table) => [
  foreignKey({
    name: "tenant_id_fk",
    columns: [table.tenantId],
    foreignColumns: [tenantsTable.id],
  })
    .onDelete('cascade')
]);
