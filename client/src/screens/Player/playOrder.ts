export type RandomInt = (maxExclusive: number) => number;

export const cryptoRandomInt: RandomInt = (maxExclusive) => {
  if (maxExclusive <= 1) return 0;
  const values = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  let draw = 0;
  do {
    crypto.getRandomValues(values);
    draw = values[0] ?? 0;
  } while (draw >= limit);
  return draw % maxExclusive;
};

export function shuffleInPlace<T>(items: T[], rand: RandomInt = cryptoRandomInt): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = rand(i + 1);
    const value = items[i];
    const replacement = items[j];
    if (value !== undefined && replacement !== undefined) {
      items[i] = replacement;
      items[j] = value;
    }
  }
  return items;
}

export function identityOrder(length: number): number[] {
  return Array.from({ length: Math.max(0, length) }, (_, index) => index);
}

export function buildPlayOrder(
  length: number,
  shuffle: boolean,
  rand: RandomInt = cryptoRandomInt,
  avoidFirst: number | null = null,
): number[] {
  if (length <= 0) return [];
  const order = identityOrder(length);
  if (!shuffle) return order;
  shuffleInPlace(order, rand);
  if (avoidFirst !== null && length > 1 && order[0] === avoidFirst) {
    const j = rand(length - 1) + 1;
    const first = order[0];
    const other = order[j];
    if (first !== undefined && other !== undefined) {
      order[0] = other;
      order[j] = first;
    }
  }
  return order;
}
