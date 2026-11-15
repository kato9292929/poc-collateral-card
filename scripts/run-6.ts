// 実証6：トークン発行役から 2 つの seller（別々の PAY.JP アカウント）に x402 のカードで払う
// 使い方：node --experimental-strip-types scripts/run-6.ts [--mock]
import { writeFileSync, mkdirSync } from 'node:fs';
import { Agent, findPans, type AgentResult } from '../src/agent/agent.ts';
import { TokenIssuer, startIssuer } from '../src/issuer/issuer.ts';
import { bootSeller, commit, outDir, pickSetup, runnerRegion, stamp, stats, tally, writeJson } from './common.ts';

const LIMITS = { perCallMax: 100, perSellerMax: 2000, ttlMs: Number(process.env.ISSUER_TTL_MS ?? 60_000) };
const setup = await pickSetup();
const runId = `${stamp()}-6`;
const startedAt = new Date();
const since = Math.floor(startedAt.getTime() / 1000) - 60;

const A = await bootSeller({ keys: setup.sellers.A, runId });
const B = await bootSeller({ keys: setup.sellers.B, runId });
const Apremium = await bootSeller({ keys: setup.sellers.A, runId: `${runId}-premium`, amount: 150 });
const issuer = new TokenIssuer({ minter: setup.minter, limits: LIMITS });
const iss = await startIssuer(issuer);
const agent = new Agent({ issuerUrl: iss.url });

const results: (AgentResult & { case: string; check?: unknown })[] = [];
const push = (c: string, r: AgentResult & { check?: unknown }) => {
  results.push({ ...r, case: c });
  console.log(c, r.seller, r.status, r.reason ?? '');
};

for (let i = 0; i < 10; i++) push('A_normal', await agent.pay(A.url, 'A'));
for (let i = 0; i < 10; i++) push('B_normal', await agent.pay(B.url, 'B'));
for (let i = 0; i < 10; i++) {
  const s = i % 2 === 0 ? A : B;
  push('alternate', await agent.pay(s.url, s.name));
}
for (let i = 0; i < 3; i++) push('over_limit', await agent.pay(Apremium.url, 'A'));
// 期限切れ：A 向けに 3 つ発行し、有効期限（60 秒）を過ぎてから使う
const stale = [];
for (let i = 0; i < 3; i++) stale.push(await agent.issueFor(A.url));
await new Promise((r) => setTimeout(r, LIMITS.ttlMs + 2_000));
for (const t of stale) push('expired', await agent.payWithToken(A.url, 'A', t.token!));
// A 向けのトークンを B に送る
for (let i = 0; i < 3; i++) {
  const t = await agent.issueFor(A.url);
  push('cross_seller', await agent.payWithToken(B.url, 'B', t.token!));
}
for (const s of [A, B, Apremium]) s.close();
iss.server.close();
await setup.minter.close();

// PAY.JP の支払い一覧（seller ごと）と照合
const chargesA = (await setup.sellers.A.psp.listCharges(since)).filter((c) => c.metadata?.run_id === runId);
const chargesB = (await setup.sellers.B.psp.listCharges(since)).filter((c) => c.metadata?.run_id === runId);
const caseOf = new Map(results.filter((r) => r.paymentId).map((r) => [r.paymentId!, r.case]));
const cases = ['A_normal', 'B_normal', 'alternate', 'over_limit', 'expired', 'cross_seller'];
const byCase = Object.fromEntries(cases.map((c) => [c, {
  A: tally(chargesA.filter((x) => caseOf.get(x.metadata.x402_payment_id) === c)),
  B: tally(chargesB.filter((x) => caseOf.get(x.metadata.x402_payment_id) === c)),
}]));

// エージェントの通信ログにカード番号が出ていないか
const dir = outDir(setup.mode);
mkdirSync(dir, { recursive: true });
const logPath = `${dir}/${runId}-agent-log.json`;
writeFileSync(logPath, JSON.stringify(agent.log));
const logText = JSON.stringify(agent.log);
const panSearch = {
  logFile: logPath,
  exchanges: agent.log.length,
  testCardNumberOccurrences: (logText.match(/4242\s?4242\s?4242\s?4242/g) ?? []).length,
  luhnValid14to19DigitStrings: findPans(agent.log),
};

const settleOf = (r: AgentResult) => r.settle as { transaction?: string } | undefined;
writeJson(`${dir}/${runId}.json`, {
  run: runId,
  experiment: 6,
  mode: setup.mode,
  commit: commit(),
  runner: await runnerRegion(),
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  issuerLimits: LIMITS,
  price: { normal: 50, overLimitRoute: 150, asset: 'JPY' },
  results: results.map((r) => ({ case: r.case, seller: r.seller, status: r.status, reason: r.reason, check: (r as any).check, paymentId: r.paymentId, ms402toFinal: r.ms402toFinal, msTotal: r.msTotal, mintMs: r.mintMs, transaction: settleOf(r)?.transaction, body: r.body })),
  summary: {
    statusByCase: Object.fromEntries(cases.map((c) => [c, results.filter((r) => r.case === c).map((r) => `${r.seller}:${r.status}${r.reason ? `(${r.reason})` : ''}`)])),
    ms402to200: stats(results.filter((r) => r.status === 200 && ['A_normal', 'B_normal', 'alternate'].includes(r.case)).map((r) => r.ms402toFinal!)),
    msMint: stats(results.filter((r) => r.mintMs !== undefined).map((r) => r.mintMs!)),
    issuerRejected: issuer.rejected,
    issuerChecks: issuer.checks.length,
    facilitatorRejected: { A: A.facilitator.stats.rejected, B: B.facilitator.stats.rejected },
    pspCalls: { A: setup.sellers.A.psp.calls, B: setup.sellers.B.psp.calls },
    panSearch,
  },
  psp_reconciliation: byCase,
});
