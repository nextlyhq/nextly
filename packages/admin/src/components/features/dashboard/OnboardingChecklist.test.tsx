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
import { render, screen, waitFor } from "@testing-library/react";
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

function client() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
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
 * The consumer is a mounted `useQuery` rather than a prefetch: only an active
 * query refetches on invalidation, and an entry nothing observes is collected
 * immediately under `gcTime: 0` — so a prefetched one reports no state at all
 * and the assertion would pass or fail for the wrong reason.
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

afterEach(() => {
  vi.clearAllMocks();
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
    // prefetched: an invalidation refetches ACTIVE queries, and an entry with
    // no observer is collected outright under this client's `gcTime: 0`.
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
