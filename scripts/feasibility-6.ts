// 実証6 の実装前の確認（PAY.JP テストモード）
// 1. seller の公開鍵だけで、payjp.js をヘッドレスブラウザで動かしてテストカードのトークンを作れるか
// 2. 公開鍵での POST /v1/tokens を、ブラウザを通さずに呼べるか（可否だけ記録。実装では使わない）
// 3. seller A の公開鍵で作ったトークンが、seller B のアカウントの与信で拒否されるか
import { BrowserMinter } from '../src/issuer/minter.ts';
import { Payjp, normalizeKey } from '../src/psp/payjp.ts';
import { PspError } from '../src/psp/types.ts';
import { commit, runnerRegion, stamp, writeJson } from './common.ts';

const env = (k: string) => (process.env[k] ? normalizeKey(process.env[k]!) : '');
const pkA = env('PAYJP_PUBLIC_KEY_A');
const skB = env('PAYJP_SECRET_KEY_B');
if (!/^pk_test_/.test(pkA)) throw new Error('PAYJP_PUBLIC_KEY_A must be a test public key (pk_test_...)');
const out: Record<string, unknown> = { run: `${stamp()}-feasibility-6`, commit: commit(), runner: await runnerRegion(), at: new Date().toISOString() };

// 1
let tokenFromA: string | undefined;
const minter = await BrowserMinter.start();
try {
  const r = await minter.mint(pkA);
  tokenFromA = r.token;
  out.browserToken = { ok: true, ms: r.ms, threeDSecureStatus: r.threeDSecure ?? null, tokenPrefix: r.token.slice(0, 4) };
} catch (e) {
  out.browserToken = { ok: false, error: (e as Error).message };
} finally {
  await minter.close();
}

// 2：ブラウザを通さず、公開鍵で POST /v1/tokens（テスト限定のヘッダは付けない）
{
  const res = await fetch('https://api.pay.jp/v1/tokens', {
    method: 'POST',
    headers: { authorization: 'Basic ' + Buffer.from(`${pkA}:`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ 'card[number]': '4242424242424242', 'card[exp_month]': '12', 'card[exp_year]': '2030', 'card[cvc]': '123' }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  out.publicKeyTokenWithoutBrowser = { status: res.status, ok: res.ok, errorCode: body?.error?.code ?? null, errorType: body?.error?.type ?? null, errorMessage: body?.error?.message ?? null, gotToken: typeof body?.id === 'string' && body.id.startsWith('tok_') };
}

// 3：A のトークンで B の与信
if (!tokenFromA) out.crossSeller = { skipped: 'no token from step 1' };
else if (!/^sk_test_/.test(skB)) out.crossSeller = { skipped: 'PAYJP_SECRET_KEY_B is not set' };
else {
  const b = new Payjp({ secretKey: skB });
  try {
    const c = await b.authorize({ amount: 50, token: tokenFromA, metadata: { run_id: String(out.run), purpose: 'feasibility-cross-seller' } });
    out.crossSeller = { rejected: false, chargeId: c.id };
    await b.release(c.id).catch(() => undefined);
  } catch (e) {
    out.crossSeller = { rejected: true, status: e instanceof PspError ? e.status : null, code: e instanceof PspError ? e.code : null, message: (e as Error).message };
  }
}

writeJson(`docs/runs/${out.run}.json`, out);
if (!(out.browserToken as any).ok) {
  console.log('STOP: payjp.js could not create a token in a headless browser');
  process.exit(2);
}
