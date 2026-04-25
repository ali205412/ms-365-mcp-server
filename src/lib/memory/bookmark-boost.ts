export function safeBookmarkBoost(score: number, bookmarkCount: number): number {
  return score * (1 + 0.5 * Math.max(0, bookmarkCount));
}
