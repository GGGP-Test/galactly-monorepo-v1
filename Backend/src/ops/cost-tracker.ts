// src/ops/cost-tracker.ts
export type CostItem = {
  kind: string;            // e.g., "openai", "crawl", "cache-miss"
  amount: number;          // USD cost in dollars
  at?: number;             // epoch ms
  meta?: Record<string, unknown>;
};

/**
 * Single, de-duplicated CostTracker. Previous duplicate declarations caused TS2300.
 */
export class CostTracker {
  private total = 0;
  private items: CostItem[] = [];

  add(item: CostItem) {
    this.total += item.amount;
    this.items.push({ ...item, at: item.at ?? Date.now() });
  }

  sum(kind?: string): number {
    return this.items
      .filter(i => (kind ? i.kind === kind : true))
      .reduce((s, i) => s + i.amount, 0);
  }

  snapshot(): { total: number; items: CostItem[] } {
    return { total: this.total, items: [...this.items] };
  }

  reset() {
    this.total = 0;
    this.items = [];
  }
}

export default CostTracker;
