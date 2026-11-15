import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockPayjp, MockPayjpWorld } from '../src/psp/mock.ts';
import { CardFacilitator, type PaymentRequirements } from '../src/facilitator/card.ts';

const req: PaymentRequirements = { scheme: 'auth-capture', network: 'card:visa', amount: '50', asset: 'JPY', payTo: 'acct_b', maxTimeoutSeconds: 900, extra: { psp: 'payjp', paymentFlow: 'escrow' } };

test('a token minted with seller A public key is declined at seller B and the PSP code is kept', async () => {
  const world = new MockPayjpWorld();
  const f = new CardFacilitator({ psp: new MockPayjp(world, 'B'), idMode: 'A', runId: 't' });
  const token = world.mintToken('pk_test_A');
  const r = await f.settle({ x402Version: 2, accepted: req, payload: { token, paymentId: 'pay_0123456789abcdef' } }, req);
  assert.equal(r.errorReason, 'card_declined');
  assert.equal(r.pspError, '404 invalid_id');
});
