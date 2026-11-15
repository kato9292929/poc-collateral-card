import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockPayjpWorld } from '../src/psp/mock.ts';
import { MockMinter } from '../src/issuer/minter.ts';
import { TokenIssuer } from '../src/issuer/issuer.ts';
import { findPans } from '../src/agent/agent.ts';

const mk = (now = () => 0) => new TokenIssuer({ minter: new MockMinter(new MockPayjpWorld()), limits: { perCallMax: 100, perSellerMax: 120, ttlMs: 60_000 }, now });

test('per-call and per-seller limits', async () => {
  const i = mk();
  assert.equal((await i.issue({ payTo: 'a', publicKey: 'pk_test_A', amount: 150, asset: 'JPY' })).ok, false);
  assert.equal((await i.issue({ payTo: 'a', publicKey: 'pk_test_A', amount: 100, asset: 'JPY' })).ok, true);
  const r = await i.issue({ payTo: 'a', publicKey: 'pk_test_A', amount: 50, asset: 'JPY' });
  assert.deepEqual(r, { ok: false, reason: 'per_seller_limit' });
  assert.equal((await i.issue({ payTo: 'b', publicKey: 'pk_test_B', amount: 50, asset: 'JPY' })).ok, true);
});

test('check binds a token to its seller, amount and expiry', async () => {
  let t = 0;
  const i = mk(() => t);
  const r = await i.issue({ payTo: 'a', publicKey: 'pk_test_A', amount: 50, asset: 'JPY' });
  assert.ok(r.ok);
  const token = (r as any).token;
  assert.equal(i.check({ token, payTo: 'a', amount: 50 }).ok, true);
  assert.equal((i.check({ token, payTo: 'b', amount: 50 }) as any).reason, 'wrong_seller');
  assert.equal((i.check({ token, payTo: 'a', amount: 60 }) as any).reason, 'wrong_amount');
  t = 60_001;
  assert.equal((i.check({ token, payTo: 'a', amount: 50 }) as any).reason, 'expired');
});

test('PAN finder catches card numbers but not 13-digit millisecond timestamps', () => {
  assert.equal(findPans([{ x: 'card 4242424242424242' }]).length, 1);
  assert.equal(findPans([{ t: 1794000000000 }]).length, 0);
});
