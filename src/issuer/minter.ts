// トークンを作る部分。テストカードの情報はこのファイルだけが持つ
// - BrowserMinter：seller の公開鍵で payjp.js（v2）をヘッドレスブラウザで動かし、カード入力欄にテストカードを入れてトークンを作る
// - MockMinter：テスト用（モックの PAY.JP に公開鍵ごとのトークンを作らせる）
import { createServer, type Server } from 'node:http';
import type { MockPayjpWorld } from '../psp/mock.ts';

const TEST_CARD = { number: '4242424242424242', exp: '12 / 30', cvc: '123' };

export interface TokenMinter {
  mint(publicKey: string): Promise<{ token: string; ms: number; threeDSecure?: string | null }>;
  close(): Promise<void>;
}

export class MockMinter implements TokenMinter {
  private readonly world: MockPayjpWorld;
  constructor(world: MockPayjpWorld) {
    this.world = world;
  }
  async mint(publicKey: string) {
    const t0 = Date.now();
    return { token: this.world.mintToken(publicKey), ms: Date.now() - t0 };
  }
  async close() {}
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="card"></div>
<script src="https://js.pay.jp/v2/pay.js"></script>
<script>
  const pk = decodeURIComponent(location.hash.slice(1));
  const payjp = Payjp(pk);
  const el = payjp.elements().create('card');
  el.mount('#card');
  window.__mint = async () => {
    try { return await payjp.createToken(el); } catch (e) { return { error: { message: String(e) } }; }
  };
</script></body></html>`;

/** payjp.js を localhost のページで動かす（seller の公開鍵ごとにページを開き直す） */
export class BrowserMinter implements TokenMinter {
  private browser: any;
  private server?: Server;
  private origin = '';

  static async start(): Promise<BrowserMinter> {
    const m = new BrowserMinter();
    const { chromium } = await import('playwright');
    m.browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
    await new Promise<void>((resolve) => {
      m.server = createServer((_q, r) => {
        r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        r.end(PAGE);
      }).listen(0, '127.0.0.1', () => {
        m.origin = `http://localhost:${(m.server!.address() as { port: number }).port}`;
        resolve();
      });
    });
    return m;
  }

  async mint(publicKey: string) {
    const t0 = Date.now();
    const page = await this.browser.newPage();
    try {
      await page.goto(`${this.origin}/#${encodeURIComponent(publicKey)}`);
      const frame = await (async () => {
        for (let i = 0; i < 50; i++) {
          const f = page.frames().find((x: any) => x.url().includes('element_iframe'));
          if (f && (await f.$('input[name="cardnumber"]'))) return f;
          await page.waitForTimeout(200);
        }
        throw new Error('payjp.js card element did not load');
      })();
      await frame.fill('input[name="cardnumber"]', TEST_CARD.number);
      await frame.fill('input[name="exp-date"]', TEST_CARD.exp);
      await frame.fill('input[name="cvc"]', TEST_CARD.cvc);
      const r = await page.evaluate('window.__mint()');
      if (!r?.id) throw new Error(`payjp.js createToken failed: ${JSON.stringify(r?.error ?? r).slice(0, 300)}`);
      return { token: r.id as string, ms: Date.now() - t0, threeDSecure: r.card?.three_d_secure_status ?? null };
    } finally {
      await page.close();
    }
  }

  async close() {
    await this.browser?.close();
    this.server?.close();
  }
}
