import { Hono } from 'hono';
import { postsRoutes } from './handlers/posts';
import { toProblemBody } from './http/error-mapping';
import { PROBLEM_JSON_MEDIA_TYPE } from './http/errors';

/** RFC 9457 の `instance` メンバはパス相当が一般的なので、URL からパスだけを抽出。 */
function instanceFromUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function createApp() {
  const app = new Hono();

  // 認証不要・常時 200 を返すヘルスチェック。Playwright の webServer.url
  // 起動待ちプローブ（200-399 を ready とみなす）で使う。tenantContext を
  // 適用しないため /posts より前にマウントする。
  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.route('/posts', postsRoutes);

  app.onError((err, c) => {
    const { body, status } = toProblemBody(err, instanceFromUrl(c.req.url));
    return c.body(JSON.stringify(body), status, {
      'Content-Type': PROBLEM_JSON_MEDIA_TYPE,
    });
  });

  return app;
}
