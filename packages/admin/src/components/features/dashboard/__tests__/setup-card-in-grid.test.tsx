/**
 * The setup card's "You're all set" through the dashboard's own wiring: its answer asked for in
 * the batch (`useWidgetBatch`, with its per-card retries, `useCardRetries`), and the card drawn
 * as a declared component once there is data (`declaredComponentOutcome`), so a card the host
 * retries is unmounted for its skeleton and drawn again, as on the dashboard.
 */
import { QueryClient } from "@tanstack/react-query";
import type { SetupCardData, SetupStep } from "nextly/config";
import type { DeclaredComponentProps } from "nextly/widget-result";
import { useEffect, type JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen, waitFor } from "@admin/__tests__/utils";
import { protectedApi } from "@admin/lib/api/protectedApi";
import {
  clearRegistry,
  registerComponent,
} from "@admin/lib/plugins/component-registry";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { gridBounds } from "../../widgets/__tests__/grid-bounds";
import { useWidgetBatch, type BatchCard } from "../../widgets/useWidgetBatch";
import { WidgetRenderer } from "../../widgets/WidgetRenderer";
import { SetupCard } from "../SetupCard";

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { post: vi.fn(), put: vi.fn() },
}));
// The batch answered as the `protectedApi.post` mock above describes it; see `batch-over-post`.
vi.mock("@admin/hooks/queries/widget-query-stream", async () =>
  (
    await import("@admin/hooks/queries/__tests__/batch-over-post")
  ).streamOverPost()
);
// No sample-content route for this reader: the sample step is drawn done, as the host may not.
vi.mock("@admin/hooks/queries/useSeedStatus", () => ({
  useSeedStatus: () => ({
    status: { kind: "hidden" },
    startSeed: vi.fn(),
    skip: vi.fn(),
  }),
}));
vi.mock("@admin/hooks/queries/useSingles", () => ({
  useSingles: () => ({ data: { items: [] } }),
}));

const PATH = "@acme/admin#Setup";
const PLACEMENT = "core/setup";

/** The setup card as the dashboard is told of it: drawn by its own component, its data core's. */
const setupWidget: DashboardWidget = {
  id: "core/setup",
  title: "Set up your project",
  archetype: "custom",
  size: gridBounds(12),
  component: PATH,
  serverData: true,
};
const card: BatchCard = { placementId: PLACEMENT, widget: setupWidget };

/** The card's answer, every step it draws done, Invite as `invite` says. */
function answer(invite: SetupStep["status"]): SetupCardData {
  const steps: SetupStep[] = [
    { kind: "sample", status: "open" },
    { kind: "invite", status: invite },
  ];
  return {
    setup: { known: true, steps, done: 1, total: 2 },
    collapsed: false,
    allSet: false,
  };
}

/** The batch's answer for the card, as the endpoint sends it. */
const answered = (data: SetupCardData) => ({
  results: [{ ok: true, result: { op: "data", data } }],
});

/** The host refusing "You're all set": it finds a step open as it sees the site. */
const refusal = () =>
  Object.assign(new Error("Setup is not all set: a step is still open."), {
    status: 409,
    code: "CONFLICT",
  });

/** How many times the card's component was mounted. */
let mounts = 0;
function CountedSetupCard(props: DeclaredComponentProps): JSX.Element {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <SetupCard {...props} />;
}

/** The dashboard's wiring for one card, with the host's Retry for it. */
function Dashboard() {
  const batch = useWidgetBatch([card]);
  return (
    <>
      <WidgetRenderer
        definition={setupWidget}
        slot={batch.slots[PLACEMENT]}
        isFetching={batch.fetchingPlacementIds.has(PLACEMENT)}
        onRetry={() => batch.retry(PLACEMENT)}
      />
      <button type="button" onClick={() => batch.retry(PLACEMENT)}>
        Retry the card
      </button>
    </>
  );
}

const retirements = () =>
  vi
    .mocked(protectedApi.put)
    .mock.calls.filter(([, body]) => "retire" in (body as object)).length;
const batchReads = () => vi.mocked(protectedApi.post).mock.calls.length;

function drawDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } },
  });
  return render(<Dashboard />, { queryClient });
}

beforeEach(() => {
  vi.clearAllMocks();
  mounts = 0;
  registerComponent(PATH, CountedSetupCard);
});
afterEach(() => clearRegistry());

describe("the setup card's retirement on the dashboard", () => {
  it("asks once over a refusal the host keeps giving, across the read in place and a card drawn again", async () => {
    vi.mocked(protectedApi.post).mockResolvedValue(answered(answer("skipped")));
    vi.mocked(protectedApi.put).mockImplementation(() =>
      Promise.reject(refusal())
    );
    drawDashboard();
    await waitFor(() => expect(retirements()).toBe(1));
    // The refusal reads the dashboard's answers again in place: the card is not unmounted.
    await waitFor(() => expect(batchReads()).toBe(2));
    expect(mounts).toBe(1);

    // The host retries the card (Retry, or a write that refreshes it): its skeleton is drawn,
    // and the card drawn again over the same steps remembers the refusal.
    fireEvent.click(screen.getByRole("button", { name: "Retry the card" }));
    await waitFor(() => expect(mounts).toBe(2));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(retirements()).toBe(1);
    // The retry's own read, and no read in place after it: nothing was refused again.
    expect(batchReads()).toBe(3);
  });

  it("asks once more when the steps read after a refusal differ", async () => {
    vi.mocked(protectedApi.post)
      .mockResolvedValueOnce(answered(answer("skipped")))
      // Invite finished on another device before the read in place.
      .mockResolvedValue(answered(answer("done")));
    vi.mocked(protectedApi.put)
      .mockImplementationOnce(() => Promise.reject(refusal()))
      .mockResolvedValue({});
    drawDashboard();
    // The read in place answers other steps: a new answer, so the card is drawn afresh over it,
    // and those steps are asked about once.
    await waitFor(() => expect(retirements()).toBe(2));
    expect(batchReads()).toBe(2);
    expect(await screen.findByTestId("setup-all-set")).toBeInTheDocument();
  });
});
