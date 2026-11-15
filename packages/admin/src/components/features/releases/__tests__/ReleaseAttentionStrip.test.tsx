/**
 * The strip at the top of the Releases page: while any release is stopped or
 * overdue it names each of the first few, linked to its page, says how many
 * there are in all, and leads to the Needs attention tab. With none it is not
 * drawn at all.
 *
 * The API is stubbed rather than the hook, so what is under test includes the
 * question the strip asks: the server's Needs attention tab, never a rule of
 * its own.
 *
 * @module components/features/releases/__tests__/ReleaseAttentionStrip.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  createTestQueryClient,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@admin/__tests__/utils";
import type { ReleaseListResponse } from "@admin/services/releaseApi";
import type { Release } from "@admin/types/releases";

const mocks = vi.hoisted(() => ({ fetchReleases: vi.fn() }));

vi.mock("@admin/services/releaseApi", async () => {
  const actual = await vi.importActual<
    typeof import("@admin/services/releaseApi")
  >("@admin/services/releaseApi");
  return { ...actual, fetchReleases: mocks.fetchReleases };
});

import {
  ReleaseAttentionStrip,
  useAttentionStripKnown,
} from "../ReleaseAttentionStrip";

function release(id: string, title: string, state: Release["state"]): Release {
  return {
    id,
    title,
    description: null,
    scheduledAt: "2026-11-04T09:00:00.000Z",
    timezone: "Europe/London",
    state,
  } as Release;
}

function answer(items: Release[], total = items.length): ReleaseListResponse {
  return {
    items,
    meta: { total, page: 1, limit: 3, totalPages: 1, hasNext: false },
  } as unknown as ReleaseListResponse;
}

beforeEach(() => {
  mocks.fetchReleases.mockReset();
});

describe("the Releases page's needs-attention strip", () => {
  it("asks for the Needs attention tab, the first few of it", async () => {
    mocks.fetchReleases.mockResolvedValue(answer([]));
    render(<ReleaseAttentionStrip />);

    await waitFor(() => expect(mocks.fetchReleases).toHaveBeenCalled());
    expect(mocks.fetchReleases).toHaveBeenCalledWith(
      expect.objectContaining({ tab: "attention", page: 1, limit: 3 })
    );
  });

  it("names each stopped and overdue release, linked to its page", async () => {
    mocks.fetchReleases.mockResolvedValue(
      answer([
        release("r-1", "Autumn launch", "blocked"),
        release("r-2", "Spring sale", "scheduled"),
      ])
    );
    render(<ReleaseAttentionStrip />);

    const strip = await screen.findByRole("region", {
      name: "2 releases need attention",
    });
    const autumn = within(strip).getByRole("link", { name: "Autumn launch" });
    expect(autumn).toHaveAttribute("href", "/admin/releases/r-1");
    expect(autumn.closest("li")).toHaveTextContent("Stopped");
    const spring = within(strip).getByRole("link", { name: "Spring sale" });
    expect(spring).toHaveAttribute("href", "/admin/releases/r-2");
    expect(spring.closest("li")).toHaveTextContent("Overdue");
    expect(
      within(strip).getByRole("link", { name: "View all in Needs attention" })
    ).toHaveAttribute("href", "/admin/releases?tab=attention");
  });

  it("counts every release that needs attention, beyond the ones it names", async () => {
    mocks.fetchReleases.mockResolvedValue(
      answer(
        [
          release("r-1", "One", "blocked"),
          release("r-2", "Two", "blocked"),
          release("r-3", "Three", "scheduled"),
        ],
        5
      )
    );
    render(<ReleaseAttentionStrip />);

    const strip = await screen.findByRole("region", {
      name: "5 releases need attention",
    });
    expect(within(strip).getAllByRole("listitem")).toHaveLength(3);
    expect(strip).toHaveTextContent("and 2 more");
  });

  it("says one release in the singular", async () => {
    mocks.fetchReleases.mockResolvedValue(
      answer([release("r-1", "Autumn launch", "blocked")])
    );
    render(<ReleaseAttentionStrip />);

    expect(
      await screen.findByRole("region", { name: "1 release needs attention" })
    ).toBeInTheDocument();
  });

  it("is not drawn while nothing needs attention", async () => {
    mocks.fetchReleases.mockResolvedValue(answer([]));
    render(<ReleaseAttentionStrip />);

    await waitFor(() => expect(mocks.fetchReleases).toHaveBeenCalled());
    expect(screen.queryByRole("region")).toBeNull();
  });
});

// The page holds what stands under the strip until whether the strip is drawn
// is known, so the strip never lands above the tabs and pushes them down. A
// failed read is known too: the strip then draws nothing, and the page must
// not wait on it for ever.
/** The hook inside a query client of its own, as the admin shell provides one. */
function knownHook() {
  const client = createTestQueryClient();
  return renderHook(() => useAttentionStripKnown(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

describe("whether the strip is drawn is known", () => {
  it("not while its read is on its way, and from its answer on", async () => {
    let settle: (value: ReleaseListResponse) => void = () => {};
    mocks.fetchReleases.mockReturnValue(
      new Promise<ReleaseListResponse>(resolve => {
        settle = resolve;
      })
    );
    const { result } = knownHook();
    expect(result.current).toBe(false);
    settle(answer([]));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("once its read has failed", async () => {
    mocks.fetchReleases.mockRejectedValue(new Error("offline"));
    const { result } = knownHook();
    await waitFor(() => expect(result.current).toBe(true), { timeout: 5000 });
  });
});
