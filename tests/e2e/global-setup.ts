import 'dotenv/config';
import { reseed } from './helpers/seed';

/**
 * Playwright globalSetup：全 spec が開始する前に 1 回だけ実行される。
 *
 * 各テストでも beforeEach で reseed するが、ここで一度走らせておくことで
 * 「webServer が起動した直後に /posts を叩いたら DB が空だった」という
 * race を避ける（最初のテストが beforeEach に到達するより前にサーバが
 * 何かしら走る可能性は無いが、明示的にカナリーとして DB 接続も確認する）。
 */
export default async function globalSetup(): Promise<void> {
  await reseed();
}
