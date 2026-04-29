// F10 PR 5 — admin-side wire types + API client for the journal endpoint.
// Mirrors the server-side `JournalRowApi` shape from
// `packages/nextly/src/domains/schema/journal/read-journal.ts`.

import { protectedApi } from "@admin/lib/api/protectedApi";

export type JournalScope =
  | { kind: "collection"; slug: string }
  | { kind: "single"; slug: string }
  | { kind: "global"; slug?: string }
  | { kind: "fresh-push" };

export interface JournalSummary {
  added: number;
  removed: number;
  renamed: number;
  changed: number;
}

export interface JournalRow {
  id: string;
  source: "ui" | "code";
  status: "in_progress" | "success" | "failed" | "aborted";
  scope: JournalScope | null;
  summary: JournalSummary | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface JournalListResponse {
  rows: JournalRow[];
  hasMore: boolean;
}

export interface ListJournalParams {
  limit?: number;
  before?: string;
}

export const journalApi = {
  list: (params: ListJournalParams = {}) => {
    const search = new URLSearchParams();
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.before) search.set("before", params.before);
    const qs = search.toString();
    return protectedApi.get<JournalListResponse>(
      `/schema/journal${qs ? `?${qs}` : ""}`
    );
  },
};
