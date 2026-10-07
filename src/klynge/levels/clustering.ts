import type { SwingPoint } from "../domain/types.ts";

export interface SwingCluster {
  members: SwingPoint[];
  /** Mean of member prices. */
  price: number;
}

/**
 * Deterministic single-pass clustering of same-side confirmed swings.
 * Sort by price (ties by index); a swing joins the open cluster while `price - cluster.min <= 2 × tolerance`,
 * so every member lies within ±tolerance of the cluster midpoint. Clusters below `minimumTouches` are dropped.
 */
export function clusterSwings(swings: readonly SwingPoint[], tolerance: number, minimumTouches: number): SwingCluster[] {
  if (!(tolerance >= 0)) return [];
  const sorted = [...swings].sort((a, b) => a.price - b.price || a.index - b.index);
  const clusters: SwingPoint[][] = [];
  let current: SwingPoint[] = [];
  for (const s of sorted) {
    if (current.length > 0 && s.price - (current[0] as SwingPoint).price > 2 * tolerance) {
      clusters.push(current);
      current = [];
    }
    current.push(s);
  }
  if (current.length > 0) clusters.push(current);
  return clusters
    .filter((c) => c.length >= minimumTouches)
    .map((members) => ({ members, price: members.reduce((sum, m) => sum + m.price, 0) / members.length }));
}
