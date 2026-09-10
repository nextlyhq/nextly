/**
 * The checklist draws what the HOST answered, and stops deciding for itself.
 *
 * Two properties are worth guarding and neither is visual. The card must not
 * present a failed read as a finished checklist — both leave zero incomplete
 * steps, and only one of them means the reader is done. And finishing the last
 * step has to drop the card, which the host does: the card asks for a fresh
 * layout rather than hiding itself, because hiding itself is what reserved an
 * empty grid slot before.
 *
 * @module components/features/dashboard/OnboardingChecklist.test
 */

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const protectedGet = vi.fn();

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get: (...args: unknown[]) => protectedGet(...args) },
}));

const { OnboardingChecklist } = await import("./OnboardingChecklist");
const { DASHBOARD_LAYOUT_KEY } = await import(
  "@admin/hooks/queries/useDashboardLayout"
);

const ALL_BUT_ONE = [
  { id: "account", complete: true },
  { id: "collection", complete: true },
  { id: "entry", complete: false },
];

const EVERY_STEP = ALL_BUT_ONE.map(step => ({ ...step, complete: true }));

/**
 * A client carrying the defaults PRODUCTION uses.
 *
 * 🔴 `gcTime: 0` and an absent `staleTime` are what a test client reaches for,
 * and both hide real defects here. The admin's `QueryProvider` holds data fresh
 * for five minutes, keeps it for ten, and does not refetch on focus — so a
 * cached answer genuinely survives an unmount and genuinely is not refreshed by
 * returning to the tab. A client that collects the entry immediately, or treats
 * it as stale on arrival, can never meet either case.
 */
function client() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

function draw(qc: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<OnboardingChecklist />, { wrapper });
}

/**
 * The card rendered beside a LIVE consumer of the dashboard layout key.
 *
 * The consumer is a mounted `useQuery` rather than a prefetch, because an
 * invalidation refetches ACTIVE queries only: a prefetched entry is marked
 * stale and nothing reads it again, so `readLayout` would sit at one call
 * whether the card asked for a fresh layout or not.
 */
async function drawBesideLayout(qc: QueryClient) {
  const readLayout = vi.fn().mockResolvedValue({ placements: [] });
  const LayoutConsumer = () => {
    useQuery({ queryKey: DASHBOARD_LAYOUT_KEY, queryFn: readLayout });
    return null;
  };
  render(
    <QueryClientProvider client={qc}>
      <LayoutConsumer />
      <OnboardingChecklist />
    </QueryClientProvider>
  );
  // The consumer's own first read, so a later count means a REFETCH rather
  // than the initial fetch arriving late.
  await waitFor(() => expect(readLayout).toHaveBeenCalledTimes(1));
  return { readLayout };
}

/**
 * Finish onboarding, let the host drop the card, then have it offered again.
 *
 * The sequence every staleness case shares. The first mount completes and
 * correctly asks for a fresh layout; the host drops the card, so it unmounts
 * while its all-complete answer stays cached; then the reader deletes their
 * last collection and the host offers it again. `secondAnswer` arranges what
 * that second mount's OWN read returns.
 *
 * The cache has to SURVIVE the unmount, which is what the ten-minute `gcTime`
 * in `client()` is for -- the reflexive `gcTime: 0` collects the entry the
 * moment the card goes, so the second mount starts from nothing and the case
 * under test cannot arise. The layout consumer has to stay mounted across BOTH
 * mounts too, or the invalidation has no observer and its refetch count cannot
 * move either way. Both were found by the break killing nothing.
 *
 * `afterDrop` is the layout read count at the moment the card came back. Any
 * later call means the remount acted on an answer it did not fetch itself.
 */
async function finishThenReoffer(secondAnswer: () => void) {
  const qc = client();
  const readLayout = vi.fn().mockResolvedValue({ placements: [] });
  const LayoutConsumer = () => {
    useQuery({ queryKey: DASHBOARD_LAYOUT_KEY, queryFn: readLayout });
    return null;
  };
  const withCard = (card: boolean) => (
    <QueryClientProvider client={qc}>
      <LayoutConsumer />
      {card ? <OnboardingChecklist /> : null}
    </QueryClientProvider>
  );

  protectedGet.mockResolvedValue({ steps: EVERY_STEP });
  const view = render(withCard(true));
  // The first mount completes and correctly asks the host to drop the card.
  await waitFor(() => expect(readLayout).toHaveBeenCalledTimes(2));

  // The host drops it, so the card unmounts while its answer stays cached.
  view.rerender(withCard(false));
  const afterDrop = readLayout.mock.calls.length;

  secondAnswer();
  view.rerender(withCard(true));
  return { readLayout, afterDrop };
}

afterEach(() => {
  vi.clearAllMocks();
  // Restores `Date.now`, which one case replaces. `clearAllMocks` empties a
  // spy's calls and leaves the replacement installed.
  vi.restoreAllMocks();
});

describe("the onboarding checklist", () => {
  it("draws a row per step the host reported", async () => {
    protectedGet.mockResolvedValue({ steps: ALL_BUT_ONE });
    draw(client());

    // Queried as LIST ITEMS rather than by text. An unfinished step's label
    // also appears inside its link, as the accessible name, so a text query
    // matches twice and cannot count rows.
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(ALL_BUT_ONE.length)
    );
    const rows = screen.getAllByRole("listitem").map(li => li.textContent);
    expect(rows[0]).toContain("Create your account");
    expect(rows[1]).toContain("Create a collection");
    expect(rows[2]).toContain("Add your first entry");
  });

  it("announces done and still-to-do, which the styling alone does not", async () => {
    // 🔴 The tick is decorative and `line-through` is styling, so without the
    // visually-hidden text a finished row and an unfinished one are announced
    // identically -- the one thing a checklist exists to distinguish.
    protectedGet.mockResolvedValue({ steps: ALL_BUT_ONE });
    draw(client());

    await waitFor(() => expect(screen.getAllByText(/— done/)).toHaveLength(2));
    expect(screen.getAllByText(/— still to do/)).toHaveLength(1);
  });

  it("offers no action on the step that was already granted", async () => {
    // `account` is complete for everyone who can read the card, so a call to
    // action on it would send the reader somewhere with nothing to do. Asserted
    // through the accessible names, which is what a reader moving by links
    // hears: one link, naming its own step.
    protectedGet.mockResolvedValue({ steps: ALL_BUT_ONE });
    draw(client());

    await waitFor(() => expect(screen.getByRole("link")).toBeInTheDocument());
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: /Add your first entry/ })
    ).toBeInTheDocument();
  });

  it("reports UNAVAILABLE for a step id this build cannot draw", async () => {
    // 🔴 Dropping the row keeps the card from crashing, and on its own it
    // introduces something worse. A newer server sending an INCOMPLETE step
    // this build cannot name leaves every remaining row complete, so a card
    // that merely filtered would report 100%, announce itself finished, and ask
    // the host to drop it -- while the host went on offering it for the step
    // that was dropped. A checklist claiming completion it cannot see is worse
    // than one that says it cannot describe your progress.
    protectedGet.mockResolvedValue({
      steps: [
        { id: "account", complete: true },
        { id: "collection", complete: true },
        { id: "entry", complete: true },
        { id: "billing:configured", complete: false },
      ],
    });
    draw(client());

    await waitFor(() =>
      expect(
        screen.getByText(/Setup progress is unavailable/)
      ).toBeInTheDocument()
    );
    expect(screen.queryByText(/of 3 done/)).not.toBeInTheDocument();
  });

  it("does NOT ask for a fresh layout when a row was unreadable", async () => {
    // The consequence that made the filtered reading dangerous: the card would
    // have told the host to stop offering it, on the strength of rows it could
    // not see.
    protectedGet.mockResolvedValue({
      steps: [
        { id: "account", complete: true },
        { id: "collection", complete: true },
        { id: "entry", complete: true },
        { id: "billing:configured", complete: false },
      ],
    });
    const { readLayout } = await drawBesideLayout(client());

    await waitFor(() =>
      expect(
        screen.getByText(/Setup progress is unavailable/)
      ).toBeInTheDocument()
    );
    expect(readLayout).toHaveBeenCalledTimes(1);
  });

  it("does NOT act on a completed answer cached by an EARLIER mount", async () => {
    // 🔴 The card is unmounted whenever it is not offered, and a cached response
    // outlives that. A reader who finishes onboarding and then deletes their
    // last collection gets the card offered again -- and it would remount
    // holding the previous mount's all-complete answer, announce itself
    // finished before its own refetch landed, and ask the host for a layout the
    // server has just decided should include it.
    //
    // The reader deletes their last collection, so the answer this mount
    // fetches for itself has work outstanding.
    const { readLayout, afterDrop } = await finishThenReoffer(() => {
      protectedGet.mockResolvedValue({ steps: ALL_BUT_ONE });
    });

    // 🔴 Asserted on the PROGRESS, not the row count. Both answers hold three
    // rows -- the cached one has them all ticked -- so counting rows cannot
    // separate the obsolete answer from the fresh one, and a test that counts
    // them passes with the refetch removed entirely. "2 of 3" is true only of
    // the answer this mount fetched.
    await waitFor(() =>
      expect(screen.getByText(/2 of 3 done/)).toBeInTheDocument()
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(ALL_BUT_ONE.length);
    expect(readLayout).toHaveBeenCalledTimes(afterDrop);
  });

  it("separates the two mounts when the CLOCK cannot", async () => {
    // 🔴 Which mount fetched an answer is not a question a wall clock can
    // settle. `Date.now()` is coarsened for anti-fingerprinting -- to 100ms
    // under Firefox's resistFingerprinting -- and steps backwards under an NTP
    // correction, so a cached response can carry a stamp at or after the mount
    // that is reading it. Frozen here, which is the extreme of the same thing:
    // every reading collides, so ordering the response against the mount
    // accepts the earlier mount's all-complete answer and drops the card on it.
    vi.spyOn(Date, "now").mockReturnValue(1_760_000_000_000);

    const { readLayout, afterDrop } = await finishThenReoffer(() => {
      protectedGet.mockResolvedValue({ steps: ALL_BUT_ONE });
    });

    // Waited on the fresh answer rather than asserting the count immediately,
    // which is true before this mount has read anything at all.
    await waitFor(() =>
      expect(screen.getByText(/2 of 3 done/)).toBeInTheDocument()
    );
    expect(readLayout).toHaveBeenCalledTimes(afterDrop);
  });

  it("does NOT act on a cached answer whose refresh FAILED", async () => {
    // 🔴 An update landing is not an answer arriving. The observer counts a
    // failed update alongside a successful one, and a rejected refetch leaves
    // the earlier mount's all-complete data in place -- so a guard reading the
    // count alone drops the card on an answer nobody managed to refresh, at the
    // exact moment the refresh reported it could not.
    const { readLayout, afterDrop } = await finishThenReoffer(() => {
      protectedGet.mockRejectedValue(new Error("network"));
    });

    // Waited on the FAILURE, for the same reason: the count is unmoved before
    // the refetch has been attempted, so asserting it first passes vacuously.
    await waitFor(() =>
      expect(
        screen.getByText(/Setup progress is unavailable/)
      ).toBeInTheDocument()
    );
    expect(readLayout).toHaveBeenCalledTimes(afterDrop);
  });

  it("says progress is unavailable rather than showing it finished", async () => {
    // 🔴 A failed read and a finished checklist both leave zero incomplete
    // steps. Reporting the first as the second tells a reader they are set up
    // when nobody managed to ask.
    protectedGet.mockRejectedValue(new Error("network"));
    draw(client());

    await waitFor(() =>
      expect(
        screen.getByText(/Setup progress is unavailable/)
      ).toBeInTheDocument()
    );
    expect(screen.queryByText("Create a collection")).not.toBeInTheDocument();
  });

  it("asks for a fresh layout once every step is done", async () => {
    // Finishing the last step is the moment the host stops offering this card,
    // and the layout query neither polls nor refetches except on focus -- so
    // without this the reader ticks the final row and the card sits there.
    //
    // Asserted as a REFETCH by a LIVE consumer of the key rather than as a call
    // on `invalidateQueries`, which any key at all satisfies -- including one
    // nothing is mounted under. The consumer also has to be mounted rather than
    // prefetched: an invalidation refetches ACTIVE queries only, so a
    // prefetched entry is marked stale and never read again.
    protectedGet.mockResolvedValue({ steps: EVERY_STEP });
    const { readLayout } = await drawBesideLayout(client());

    await waitFor(() => expect(readLayout).toHaveBeenCalledTimes(2));
  });

  it("does NOT ask for a fresh layout while a step is outstanding", async () => {
    // The control, and it has to be capable of the outcome being ruled out: an
    // invalidation fired unconditionally would satisfy the case above and would
    // refetch the layout on a loop for every reader who has not finished, which
    // is most of them. Same fixture, same consumer, one step short.
    protectedGet.mockResolvedValue({ steps: ALL_BUT_ONE });
    const { readLayout } = await drawBesideLayout(client());

    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(ALL_BUT_ONE.length)
    );
    expect(readLayout).toHaveBeenCalledTimes(1);
  });
});
