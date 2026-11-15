// PAY.JP のモック（複数アカウント）。API リファレンスで確かめた振る舞いだけを真似る：
// トークンは作ったアカウント（公開鍵）でしか使えず 1 回だけ、金額は 50〜9,999,999 円、確定は 1 回だけ、
// 少なく確定すると差額は amount_refunded、未確定の与信の返金は全額のみ
import { PspError, type Charge, type Psp } from './types.ts';

/** アカウントをまたいでトークンの持ち主を覚える */
export class MockPayjpWorld {
  readonly tokens = new Map<string, { account: string; used: boolean }>();
  private seq = 0;
  next(prefix: string) {
    return `${prefix}_mock_${++this.seq}`;
  }
  /** 公開鍵でトークンを作る（payjp.js の代わり）。公開鍵は pk_test_<account> の形 */
  mintToken(publicKey: string): string {
    const account = publicKey.replace(/^pk_test_/, '');
    const id = this.next('tok');
    this.tokens.set(id, { account, used: false });
    return id;
  }
}

export class MockPayjp implements Psp {
  readonly name = 'payjp-mock';
  readonly calls: Record<string, number> = {};
  readonly charges = new Map<string, Charge>();
  private readonly world: MockPayjpWorld;
  readonly account: string;

  constructor(world: MockPayjpWorld, account: string) {
    this.world = world;
    this.account = account;
  }

  private tick(kind: string) {
    this.calls[kind] = (this.calls[kind] ?? 0) + 1;
  }

  async authorize(o: { amount: number; token: string; metadata: Record<string, string> }): Promise<Charge> {
    this.tick('authorize');
    const t = this.world.tokens.get(o.token);
    // 別アカウントのトークンは存在しない扱い（PAY.JP は invalid_id で返す想定。実際の値は本番の実行で確かめる）
    if (!t || t.account !== this.account) throw new PspError(404, 'invalid_id', 'No such token');
    if (t.used) throw new PspError(400, 'token_already_used', 'token already used');
    if (!Number.isInteger(o.amount) || o.amount < 50 || o.amount > 9_999_999) throw new PspError(400, 'invalid_amount', 'amount out of range');
    t.used = true;
    const c: Charge = {
      id: this.world.next('ch'), amount: o.amount, amount_refunded: 0, captured: false, refunded: false, currency: 'jpy',
      metadata: { ...o.metadata }, created: Math.floor(Date.now() / 1000), captured_at: null, three_d_secure_status: null,
    };
    this.charges.set(c.id, c);
    return { ...c };
  }

  async capture(id: string, amount?: number): Promise<Charge> {
    this.tick('capture');
    const c = this.charges.get(id);
    if (!c) throw new PspError(404, 'invalid_id', 'no such charge');
    if (c.captured || c.refunded) throw new PspError(400, 'already_captured', 'already closed');
    const a = amount ?? c.amount;
    if (a > c.amount || a < 50) throw new PspError(400, 'invalid_amount', 'invalid capture amount');
    c.captured = true;
    c.captured_at = Math.floor(Date.now() / 1000);
    c.amount_refunded = c.amount - a;
    return { ...c };
  }

  async release(id: string): Promise<Charge> {
    this.tick('refund');
    const c = this.charges.get(id);
    if (!c) throw new PspError(404, 'invalid_id', 'no such charge');
    if (c.refunded || c.captured) throw new PspError(400, 'already_closed', 'already closed');
    c.refunded = true;
    c.amount_refunded = c.amount;
    return { ...c };
  }

  async listCharges(since: number): Promise<Charge[]> {
    this.tick('list');
    return [...this.charges.values()].filter((c) => c.created >= since).map((c) => ({ ...c }));
  }
}
