import { createMiddleware } from 'hono/factory';
import { tenantIdSchema } from '../db/with-tenant';
import { TenantHeaderMissingError, ValidationError } from '../http/errors';

export type AppEnv = {
  Variables: {
    tenantId: string;
  };
};

export const tenantContext = createMiddleware<AppEnv>(async (c, next) => {
  const raw = c.req.header('x-tenant-id');

  if (!raw) {
    throw new TenantHeaderMissingError();
  }

  const result = tenantIdSchema.safeParse(raw);
  if (!result.success) {
    throw ValidationError.fromZodError(result.error, {
      detail: 'x-tenant-id header is not a valid UUIDv7',
      fieldPathPrefix: 'x-tenant-id',
    });
  }

  c.set('tenantId', result.data);
  await next();
});
