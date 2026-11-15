// トークン発行役（buyer 側）。エージェントから「seller・金額」を受け取り、seller の公開鍵でトークンを作って返す
// 制限：1 回あたりの上限額、seller ごとの合計の上限額、発行からの有効期限、トークンは発行した seller・金額にしか使わせない（台帳で照合）
// エージェントにカード情報は渡らない（カード情報は minter の中だけ）
import { createServer, type Server } from 'node:http';
import type { TokenMinter } from './minter.ts';

export interface IssuerLimits {
  perCallMax: number;
  perSellerMax: number;
  ttlMs: number;
}

export interface IssuedToken {
  token: string;
  payTo: string;
  amount: number;
  asset: string;
  issuedAt: number;
  expiresAt: number;
  mintMs: number;
}

export class TokenIssuer {
  readonly ledger: IssuedToken[] = [];
  readonly rejected: Record<string, number> = {};
  readonly checks: { token: string; payTo: string; amount: number; ok: boolean; reason?: string }[] = [];
  private readonly minter: TokenMinter;
  private readonly limits: IssuerLimits;
  private readonly now: () => number;

  constructor(o: { minter: TokenMinter; limits: IssuerLimits; now?: () => number }) {
    this.minter = o.minter;
    this.limits = o.limits;
    this.now = o.now ?? Date.now;
  }

  private reject(reason: string) {
    this.rejected[reason] = (this.rejected[reason] ?? 0) + 1;
    return { ok: false as const, reason };
  }

  totalFor(payTo: string) {
    return this.ledger.filter((t) => t.payTo === payTo).reduce((a, t) => a + t.amount, 0);
  }

  async issue(r: { payTo: string; publicKey: string; amount: number; asset: string }) {
    if (r.asset !== 'JPY') return this.reject('unsupported_asset');
    if (!Number.isInteger(r.amount) || r.amount <= 0) return this.reject('invalid_amount');
    if (r.amount > this.limits.perCallMax) return this.reject('per_call_limit');
    if (this.totalFor(r.payTo) + r.amount > this.limits.perSellerMax) return this.reject('per_seller_limit');
    if (!/^pk_test_/.test(r.publicKey)) return this.reject('invalid_public_key');
    const m = await this.minter.mint(r.publicKey);
    const issuedAt = this.now();
    const t: IssuedToken = { token: m.token, payTo: r.payTo, amount: r.amount, asset: r.asset, issuedAt, expiresAt: issuedAt + this.limits.ttlMs, mintMs: m.ms };
    this.ledger.push(t);
    return { ok: true as const, token: t.token, expiresAt: t.expiresAt, mintMs: m.ms };
  }

  /** 使う前の照合：発行した seller・金額か、期限内か */
  check(r: { token: string; payTo: string; amount: number }) {
    const t = this.ledger.find((x) => x.token === r.token);
    let out: { ok: true } | { ok: false; reason: string };
    if (!t) out = this.reject('unknown_token');
    else if (t.payTo !== r.payTo) out = this.reject('wrong_seller');
    else if (t.amount !== r.amount) out = this.reject('wrong_amount');
    else if (this.now() > t.expiresAt) out = this.reject('expired');
    else out = { ok: true };
    this.checks.push({ ...r, ok: out.ok, reason: out.ok ? undefined : out.reason });
    return out;
  }
}

/** エージェントとは HTTP でだけやりとりする（同じプロセスの変数を共有しない） */
export function startIssuer(issuer: TokenIssuer, port = 0): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      const body = raw ? JSON.parse(raw) : {};
      if (req.method === 'POST' && req.url === '/issue') {
        const r = await issuer.issue(body);
        return send(r.ok ? 200 : 403, r);
      }
      if (req.method === 'POST' && req.url === '/check') {
        const r = issuer.check(body);
        return send(r.ok ? 200 : 403, r);
      }
      send(404, { error: 'not_found' });
    } catch (e) {
      send(500, { ok: false, reason: 'issuer_error', detail: (e as Error).message });
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` })));
}
