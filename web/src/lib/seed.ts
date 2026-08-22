// 确定性伪随机数：保证同一场比赛的分析结果每次一致（刷新/重建不漂移）

/** 字符串哈希（Fowler–Noll–Vo），输出 32 位无符号整数种子 */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 伪随机数发生器，返回 [0,1) 的确定性随机函数 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Rng {
  next: () => number
  int: (min: number, max: number) => number
  pick: <T>(arr: readonly T[]) => T
  chance: (p: number) => boolean
}

export function createRng(seedStr: string): Rng {
  const next = mulberry32(hashSeed(seedStr))
  return {
    next,
    int(min, max) {
      return Math.floor(next() * (max - min + 1)) + min
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)]
    },
    chance(p) {
      return next() < p
    },
  }
}
