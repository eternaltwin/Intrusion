// Exact port of com/Rand.hx (Parker-Miller-Carta LCG on IEEE-754 float64 before 30-bit mask)
export class Rand {
  public seed: number;

  constructor(seed: number) {
    this.seed = (seed < 0 ? -seed : seed) + 131;
  }

  public clone(): Rand {
    const r = new Rand(0);
    r.seed = this.seed;
    return r;
  }

  public int(): number {
    return (this.seed = (this.seed * 16807) % 0x7fffffff) & 0x3fffffff;
  }

  public random(n: number): number {
    if (n <= 0) return 0;
    return this.int() % n;
  }

  public rand(): number {
    return (this.int() % 10007) / 10007.0;
  }

  public sign(): number {
    return this.random(2) * 2 - 1;
  }

  public range(min: number, max: number, randSign = false): number {
    return (min + this.rand() * (max - min)) * (randSign ? this.sign() : 1);
  }

  public irange(min: number, max: number, randSign = false): number {
    return (min + this.random(max - min + 1)) * (randSign ? this.sign() : 1);
  }

  public getSeed(): number {
    return (this.seed | 0) - 131;
  }

  public addSeed(d: number): void {
    this.seed = ((this.seed + d) % 0x7fffffff) & 0x3fffffff;
    if (this.seed === 0) {
      this.seed = d + 1;
    }
  }

  public initSeed(n: number, k = 5): void {
    for (let i = 0; i < k; i++) {
      n ^= (n << 7) & 0x2b5b2500;
      n ^= (n << 15) & 0x1b8b0000;
      n ^= n >>> 16;
      n &= 0x3fffffff;
      let h = 5381;
      h = (h << 5) + h + (n & 0xff);
      h = (h << 5) + h + ((n >> 8) & 0xff);
      h = (h << 5) + h + ((n >> 16) & 0xff);
      h = (h << 5) + h + (n >> 24);
      n = h & 0x3fffffff;
    }
    this.seed = (n & 0x1fffffff) + 131;
  }

  public static fromSeed(seed: number): Rand {
    const r = new Rand(0);
    r.initSeed(seed);
    return r;
  }
}

export function spreadValues(
  seed: number,
  total: number,
  n: number,
  min: number,
  moves = 10,
  movePct = 10
): number[] {
  if (n <= 0) return [];
  if (n === 1) return [total];
  const rseed = Rand.fromSeed(seed);
  const list: number[] = [];
  let remain = total;
  const base = Math.floor(total / n);
  for (let i = 0; i < n; i++) {
    list.push(base);
    remain -= base;
  }
  while (remain > 0) {
    const idx = rseed.random(n);
    list[idx] += 1;
    remain--;
  }
  const nMoves = rseed.random(moves) + 1;
  for (let i = 0; i < nMoves; i++) {
    const from = rseed.random(n);
    const to = rseed.random(n);
    if (from === to) continue;
    const val = Math.ceil((rseed.random(movePct) / 100) * list[from]);
    if (list[from] - val >= min) {
      list[from] -= val;
      list[to] += val;
    }
  }
  return list;
}

export function shuffleWithSeed<T>(seed: number, items: readonly T[]): T[] {
  const arr = [...items];
  if (arr.length <= 1) return arr;
  const r = new Rand(seed); // Matches Data.shuffle (uses new Rand(seed), not initSeed)
  const swaps = Math.min(arr.length, 500);
  for (let i = 0; i < swaps; i++) {
    const from = r.random(arr.length);
    const to = r.random(arr.length);
    if (from !== to) {
      const tmp = arr[from];
      arr[from] = arr[to];
      arr[to] = tmp;
    }
  }
  return arr;
}
