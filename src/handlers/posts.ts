import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { postsTable } from '../db/schema';
import { withTenant } from '../db/with-tenant';
import { NotFoundError } from '../http/errors';
import { item, list } from '../http/response';
import { HttpStatus } from '../http/status';
import { zv } from '../http/zod-validator';
import { tenantContext, type AppEnv } from '../middleware/tenant-context';
import {
  createPostBodySchema,
  postIdParamSchema,
  updatePostBodySchema,
} from '../schemas/posts';

export const postsRoutes = new Hono<AppEnv>()
  .use('*', tenantContext)

  .get('/', async (c) => {
    const tenantId = c.get('tenantId');
    const posts = await withTenant(tenantId, async (tx) =>
      tx.select().from(postsTable),
    );
    return c.json(list(posts), HttpStatus.OK);
  })

  .get('/:id', zv('param', postIdParamSchema), async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.valid('param');

    const rows = await withTenant(tenantId, async (tx) =>
      tx.select().from(postsTable).where(eq(postsTable.id, id)).limit(1),
    );

    const post = rows[0];
    if (!post) {
      throw new NotFoundError('post', id);
    }
    return c.json(item(post), HttpStatus.OK);
  })

  .post('/', zv('json', createPostBodySchema), async (c) => {
    const tenantId = c.get('tenantId');
    const body = c.req.valid('json');

    const created = await withTenant(tenantId, async (tx) =>
      tx
        .insert(postsTable)
        .values({
          tenantId,
          userId: body.userId,
          title: body.title,
          body: body.body ?? null,
        })
        .returning(),
    );

    // .returning() は INSERT が成功した時点で必ず 1 件返るので非 null。
    return c.json(item(created[0]!), HttpStatus.CREATED);
  })

  .put(
    '/:id',
    zv('param', postIdParamSchema),
    zv('json', updatePostBodySchema),
    async (c) => {
      const tenantId = c.get('tenantId');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      const patch: { title?: string; body?: string | null } = {};
      if (body.title !== undefined) patch.title = body.title;
      if (body.body !== undefined) patch.body = body.body;

      const updated = await withTenant(tenantId, async (tx) =>
        tx
          .update(postsTable)
          .set(patch)
          .where(eq(postsTable.id, id))
          .returning(),
      );

      const post = updated[0];
      if (!post) {
        throw new NotFoundError('post', id);
      }
      return c.json(item(post), HttpStatus.OK);
    },
  )

  .delete('/:id', zv('param', postIdParamSchema), async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.valid('param');

    const deleted = await withTenant(tenantId, async (tx) =>
      tx.delete(postsTable).where(eq(postsTable.id, id)).returning(),
    );

    if (deleted.length === 0) {
      throw new NotFoundError('post', id);
    }
    return c.body(null, HttpStatus.NO_CONTENT);
  });
