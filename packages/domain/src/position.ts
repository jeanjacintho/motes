// Base 62 in byte order, so a plain string comparison (COLLATE "C") sorts positions.
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * A key strictly between `a` and `b`, where `a` is empty for "before everything" and `b` is null
 * for "after everything". Keys never end in the lowest digit, which leaves room below every key.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`${a} must sort before ${b}`);
  if (a.endsWith('0') || b?.endsWith('0')) throw new Error('Positions never end in 0');
  if (b !== null) {
    let shared = 0;
    while ((a[shared] ?? '0') === b[shared]) shared++;
    if (shared > 0) return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared));
  }
  const low = a ? DIGITS.indexOf(a[0] as string) : 0;
  const high = b !== null ? DIGITS.indexOf(b[0] as string) : DIGITS.length;
  if (high - low > 1) return DIGITS[Math.round((low + high) / 2)] as string;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return (DIGITS[low] as string) + midpoint(a.slice(1), null);
}

/** The position that puts a card between two neighbours; either side may be missing. */
export function positionBetween(before: string | undefined, after: string | undefined): string {
  return midpoint(before ?? '', after ?? null);
}
