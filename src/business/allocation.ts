export interface AllocationWeight {
  key: string;
  weight: number;
}

/**
 * Allocates integer cents proportionally while preserving the original total.
 */
export function allocateCents(amountCents: number, weights: AllocationWeight[]): Map<string, number> {
  const grouped = new Map<string, number>();
  for (const { key, weight } of weights) {
    if (weight > 0) grouped.set(key, (grouped.get(key) || 0) + weight);
  }

  const totalWeight = [...grouped.values()].reduce((sum, weight) => sum + weight, 0);
  if (!totalWeight || amountCents === 0) return new Map();

  const sign = Math.sign(amountCents);
  const absoluteAmount = Math.abs(amountCents);
  const portions = [...grouped.entries()].map(([key, weight], index) => {
    const exact = absoluteAmount * weight / totalWeight;
    return { key, index, cents: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = absoluteAmount - portions.reduce((sum, portion) => sum + portion.cents, 0);

  portions.sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let index = 0; index < remaining; index++) portions[index % portions.length]!.cents++;

  return new Map(portions.map((portion) => [portion.key, portion.cents * sign]));
}
