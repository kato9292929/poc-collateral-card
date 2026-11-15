// Secrets の 4 つのキーが期待どおりの種類か、値を出さずに確かめる
import { normalizeKey } from '../src/psp/payjp.ts';
const want: Record<string, string> = { PAYJP_SECRET_KEY_A: 'sk_test_', PAYJP_PUBLIC_KEY_A: 'pk_test_', PAYJP_SECRET_KEY_B: 'sk_test_', PAYJP_PUBLIC_KEY_B: 'pk_test_' };
let bad = 0;
for (const [name, prefix] of Object.entries(want)) {
  const v = normalizeKey(process.env[name] ?? '');
  const kind = ['sk_test_', 'pk_test_', 'sk_live_', 'pk_live_'].find((p) => v.startsWith(p)) ?? (v ? 'unknown' : 'missing');
  console.log(JSON.stringify({ name, kind, length: v.length, ok: kind === prefix }));
  if (kind !== prefix && !(name.endsWith('_B') && kind === 'missing')) bad++;
}
if (bad) process.exit(1);
