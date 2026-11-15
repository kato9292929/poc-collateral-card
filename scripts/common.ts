// 実行スクリプトの共通部分：seller（facilitator＋リソースサーバ）の起動、PSP の選択、記録
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Payjp, normalizeKey } from '../src/psp/payjp.ts';
import { MockPayjp, MockPayjpWorld } from '../src/psp/mock.ts';
import type { Charge, Psp } from '../src/psp/types.ts';
import { CardFacilitator } from '../src/facilitator/card.ts';
import { startFacilitator } from '../src/facilitator/http.ts';
import { startServer } from '../src/server/app.ts';
import { BrowserMinter, MockMinter, type TokenMinter } from '../src/issuer/minter.ts';

export const JIN_LATEST = 'https://jin.x402jp.com/api/jin/latest';

export interface SellerKeys {
  name: 'A' | 'B';
  psp: Psp;
  publicKey: string;
  mock: boolean;
}

/** PAY.JP のキーがそろっていれば本物、--mock かキーが無ければモック */
export async function pickSetup(): Promise<{ sellers: Record<'A' | 'B', SellerKeys>; minter: TokenMinter; mode: string }> {
  const env = (k: string) => (process.env[k] ? normalizeKey(process.env[k]!) : undefined);
  const real = !process.argv.includes('--mock') && env('PAYJP_SECRET_KEY_A') && env('PAYJP_PUBLIC_KEY_A');
  if (!real) {
    const world = new MockPayjpWorld();
    return {
      sellers: {
        A: { name: 'A', psp: new MockPayjp(world, 'A'), publicKey: 'pk_test_A', mock: true },
        B: { name: 'B', psp: new MockPayjp(world, 'B'), publicKey: 'pk_test_B', mock: true },
      },
      minter: new MockMinter(world),
      mode: 'mock',
    };
  }
  if (!env('PAYJP_SECRET_KEY_B') || !env('PAYJP_PUBLIC_KEY_B')) throw new Error('seller B keys (PAYJP_SECRET_KEY_B / PAYJP_PUBLIC_KEY_B) are not set');
  return {
    sellers: {
      A: { name: 'A', psp: new Payjp({ secretKey: env('PAYJP_SECRET_KEY_A')! }), publicKey: env('PAYJP_PUBLIC_KEY_A')!, mock: false },
      B: { name: 'B', psp: new Payjp({ secretKey: env('PAYJP_SECRET_KEY_B')! }), publicKey: env('PAYJP_PUBLIC_KEY_B')!, mock: false },
    },
    minter: await BrowserMinter.start(),
    mode: 'payjp',
  };
}

export async function bootSeller(o: { keys: SellerKeys; runId: string; amount?: number; path?: string }) {
  const credential = randomBytes(24).toString('hex');
  const payTo = `acct_payjp_seller_${o.keys.name}`;
  const facilitator = new CardFacilitator({ psp: o.keys.psp, idMode: 'A', runId: o.runId, statePath: `state/${o.runId}-${o.keys.name}.json` });
  const fac = await startFacilitator(facilitator, credential);
  const srv = await startServer({
    mode: 'single', idMode: 'A', facilitatorUrl: fac.url, serverCredential: credential, payTo, amount: o.amount ?? 50,
    jinUrl: JIN_LATEST, fixturePath: 'fixtures/jin-latest.json', publicKey: o.keys.publicKey,
  });
  return { name: o.keys.name, payTo, facilitator, url: `${srv.url}/jin/latest`, close: () => { srv.server.close(); fac.server.close(); } };
}

export function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

export async function runnerRegion(): Promise<Record<string, string> | null> {
  if (!process.env.GITHUB_ACTIONS) return null;
  try {
    const j = (await (await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(5000) })).json()) as Record<string, string>;
    return { country: j.country, region: j.region, city: j.city, org: j.org };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export function stats(xs: number[]) {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

export function tally(charges: Charge[]) {
  return {
    authorized: charges.length,
    captured: charges.filter((c) => c.captured).length,
    voided: charges.filter((c) => !c.captured && c.refunded).length,
    open: charges.filter((c) => !c.captured && !c.refunded).length,
    capturedAmount: charges.filter((c) => c.captured).reduce((a, c) => a + c.amount - c.amount_refunded, 0),
    chargeIds: charges.map((c) => c.id),
  };
}

export function stamp(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-');
}

export function outDir(mode: string) {
  return mode === 'payjp' ? 'docs/runs' : 'state/mock-runs';
}

export function writeJson(path: string, data: unknown) {
  mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote ${path}`);
}
