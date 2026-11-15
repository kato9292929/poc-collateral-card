// buyer のエージェント役。402 を受けたらトークン発行役にトークンを頼み、PAYMENT-SIGNATURE を付けて送り直す
// カード情報には触れない。通信はすべて this.log に残し、あとでカード番号が出ていないかを検索する
import { randomBytes } from 'node:crypto';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { encodePaymentSignatureHeader } from '@x402/core/http';

export class IssuerRejected extends Error {
  reason: string;
  constructor(reason: string) {
    super(`issuer rejected: ${reason}`);
    this.reason = reason;
  }
}

export interface AgentResult {
  status: number | 'issuer_rejected' | 'check_rejected' | 'error';
  seller?: string;
  paymentId?: string;
  token?: string;
  ms402toFinal?: number;
  msTotal: number;
  mintMs?: number;
  reason?: string;
  settle?: unknown;
  body?: string;
}

export class Agent {
  readonly log: unknown[] = [];
  private readonly issuerUrl: string;
  private readonly client: x402Client;
  private readonly http: x402HTTPClient;
  private lastIssue?: { token: string; mintMs?: number; paymentId: string };

  constructor(o: { issuerUrl: string; maxAmount?: number }) {
    this.issuerUrl = o.issuerUrl;
    const scheme = {
      scheme: 'auth-capture',
      createPaymentPayload: async (x402Version: number, req: any) => {
        const r = await this.post(`${this.issuerUrl}/issue`, { payTo: req.payTo, publicKey: req.extra?.payjpPublicKey, amount: Number(req.amount), asset: req.asset });
        if (!r.body?.ok) throw new IssuerRejected(r.body?.reason ?? `status ${r.status}`);
        const paymentId = `pay_${randomBytes(16).toString('hex')}`;
        this.lastIssue = { token: r.body.token, mintMs: r.body.mintMs, paymentId };
        return { x402Version, payload: { token: r.body.token, paymentId } };
      },
    };
    this.client = x402Client.fromConfig({
      schemes: [{ network: 'card:*' as any, client: scheme as any }],
      spendControls: { allowedAssets: [{ network: 'card:visa' as any, asset: 'JPY', maxAmountPerPayment: String(o.maxAmount ?? 1000) }] },
    });
    this.http = new x402HTTPClient(this.client);
  }

  private async fetchLogged(url: string, init: RequestInit = {}) {
    const res = await fetch(url, init);
    const text = await res.text();
    this.log.push({ at: new Date().toISOString(), url, method: init.method ?? 'GET', requestHeaders: init.headers ?? {}, requestBody: init.body ?? null, status: res.status, responseHeaders: Object.fromEntries(res.headers), responseBody: text });
    return { res, text };
  }

  private async post(url: string, body: unknown) {
    const { res, text } = await this.fetchLogged(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, body: json };
  }

  private async get402(url: string) {
    const { res, text } = await this.fetchLogged(url);
    if (res.status !== 402) throw new Error(`expected 402 from ${url}, got ${res.status}`);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return this.http.getPaymentRequiredResponse((n) => res.headers.get(n), body);
  }

  private async send(url: string, headers: Record<string, string>, t0: number, t402: number, seller: string, extra: Partial<AgentResult>): Promise<AgentResult> {
    try {
      const { res, text } = await this.fetchLogged(url, { headers });
      let settle: unknown;
      try {
        settle = res.headers.get('payment-response') ? this.http.getPaymentSettleResponse((n) => res.headers.get(n)) : undefined;
      } catch {
        settle = undefined;
      }
      return { ...extra, status: res.status, seller, ms402toFinal: Date.now() - t402, msTotal: Date.now() - t0, settle, body: res.status === 200 ? undefined : text.slice(0, 300) };
    } catch (e) {
      return { ...extra, status: 'error', seller, msTotal: Date.now() - t0, reason: (e as Error).message };
    }
  }

  /** 通常の支払い：402 → 発行 → 照合 → 送り直し */
  async pay(url: string, seller: string): Promise<AgentResult> {
    const t0 = Date.now();
    const pr = await this.get402(url);
    const t402 = Date.now();
    let payload;
    try {
      payload = await this.client.createPaymentPayload(pr);
    } catch (e) {
      if (e instanceof IssuerRejected) return { status: 'issuer_rejected', seller, reason: e.reason, msTotal: Date.now() - t0 };
      throw e;
    }
    const req = (payload as any).accepted;
    const issued = this.lastIssue!;
    const chk = await this.post(`${this.issuerUrl}/check`, { token: issued.token, payTo: req.payTo, amount: Number(req.amount) });
    if (!chk.body?.ok) return { status: 'check_rejected', seller, reason: chk.body?.reason, msTotal: Date.now() - t0, token: issued.token };
    return this.send(url, { 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(payload as any) }, t0, t402, seller, { paymentId: issued.paymentId, token: issued.token, mintMs: issued.mintMs });
  }

  /** 発行だけ受け取る（期限切れ・別 seller のケース用）。402 を見て、その seller・金額で発行してもらう */
  async issueFor(url: string) {
    const pr = await this.get402(url);
    const req = (pr as any).accepts[0];
    const r = await this.post(`${this.issuerUrl}/issue`, { payTo: req.payTo, publicKey: req.extra?.payjpPublicKey, amount: Number(req.amount), asset: req.asset });
    return { token: r.body?.token as string | undefined, payTo: req.payTo as string, amount: Number(req.amount), reason: r.body?.reason };
  }

  /**
   * 手元のトークンで払おうとする。まず発行役の照合を受け、その結果を記録したうえで、
   * PAY.JP 側の振る舞いも見るために照合の結果に関係なく送る（実験のための迂回。通常の pay() は照合で止まる）
   */
  async payWithToken(url: string, seller: string, token: string): Promise<AgentResult & { check: { ok: boolean; reason?: string } }> {
    const t0 = Date.now();
    const pr = await this.get402(url);
    const t402 = Date.now();
    const req = (pr as any).accepts[0];
    const chk = await this.post(`${this.issuerUrl}/check`, { token, payTo: req.payTo, amount: Number(req.amount) });
    const paymentId = `pay_${randomBytes(16).toString('hex')}`;
    const payload = { x402Version: 2, resource: (pr as any).resource, accepted: req, payload: { token, paymentId } };
    const r = await this.send(url, { 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(payload as any) }, t0, t402, seller, { paymentId, token });
    return { ...r, check: { ok: !!chk.body?.ok, reason: chk.body?.reason } };
  }
}

/** ログにカード番号らしい数字（Luhn が通る 14〜19 桁）が出ていないかを数える。13 桁はミリ秒の時刻と区別できないので外す */
export function findPans(log: unknown[]): string[] {
  const s = JSON.stringify(log);
  const out: string[] = [];
  for (const m of s.matchAll(/(?<!\d)\d{14,19}(?!\d)/g)) {
    const d = m[0];
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      let n = Number(d[d.length - 1 - i]);
      if (i % 2 === 1) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
    }
    if (sum % 10 === 0) out.push(`${d.slice(0, 4)}…(${d.length})`);
  }
  return out;
}
