/**
 * Test support: the widget batch answered through the `protectedApi.post` mock a
 * test already sets up, as one whole JSON answer.
 *
 * The batch is read by `fetchWidgetBatch`, which streams through `authFetch`.
 * Suites about what a card shows, rather than how its slot travels, describe the
 * server's answer as `protectedApi.post` resolving to `{ results }`; this keeps
 * that one description, and keeps their assertions on what was posted. How a
 * streamed answer is read is tested against real responses in
 * `widget-query-stream.test.ts` and `useWidgetQueries.stream.test.tsx`.
 *
 * Mocked in a suite with:
 * `vi.mock("@admin/hooks/queries/widget-query-stream", async () =>
 *   (await import("@admin/hooks/queries/__tests__/batch-over-post")).streamOverPost())`
 */

import { vi } from "vitest";

import type * as StreamModule from "../widget-query-stream";

export async function streamOverPost(): Promise<typeof StreamModule> {
  const actual = await vi.importActual<typeof StreamModule>(
    "@admin/hooks/queries/widget-query-stream"
  );
  const { protectedApi } = await import("@admin/lib/api/protectedApi");
  return {
    ...actual,
    fetchWidgetBatch: async queries =>
      actual.readResults(
        await protectedApi.post<unknown>("/dashboard/query", { queries })
      ),
  };
}
