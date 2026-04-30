import { sql } from "drizzle-orm";
import { z } from 'zod'
import { db } from "./client";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const tenantIdSchema = z.uuidv7()

export async function withTenant<T>(
  tenantId: string,
  callback: (tx: Tx) => Promise<T>
): Promise<T> {
  const validatedTenantId = tenantIdSchema.parse(tenantId); 

  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${validatedTenantId}, true)`);

    return await callback(tx);
  });
}
