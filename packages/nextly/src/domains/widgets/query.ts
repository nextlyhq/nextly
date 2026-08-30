/** @module domains/widgets/query */
export interface WidgetQuery {
  source: string;
  op: "count" | "list";
  where?: Record<string, unknown>;
  status?: "published" | "draft" | "all";
  select?: string[];
  sort?: string;
  limit?: number;
}
