/**
 * What the empty dashboard says, and how it carries a demo-content seed.
 *
 * The body is chosen from the host's setup steps and the seed offer's state, so
 * each case states both and asserts what a reader meets: the heading, and the
 * one thing to press or the absence of anything to press. The seed cases
 * assert what reaches the live region and when the page is held, because
 * neither is visible and both are what a reader relies on while it runs.
 *
 * @module components/features/dashboard/EmptyDashboard.test
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seedResult } from "@admin/__tests__/helpers/seed";
import { useSeedStatus } from "@admin/hooks/queries/useSeedStatus";
import { seedApi, type SeedResult } from "@admin/services/seedApi";

import { EmptyDashboard } from "./EmptyDashboard";

const protectedGet = vi.fn();

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get: (...args: unknown[]) => protectedGet(...args) },
}));

vi.mock("@admin/services/seedApi", () => ({
  seedApi: {
    probe: vi.fn(),
    runSeed: vi.fn(),
    getStatus: vi.fn(),
    setSkipped: vi.fn(),
  },
}));

type Step = { id: "account" | "collection" | "entry"; complete: boolean };

const ACCOUNT: Step = { id: "account", complete: true };
const COLLECTION_TO_DO: Step = { id: "collection", complete: false };
const COLLECTION_DONE: Step = { id: "collection", complete: true };
const ENTRY_TO_DO: Step = { id: "entry", complete: false };

/** The host's answer to `/dashboard/onboarding`. */
function stepsAre(steps: Step[]): void {
  protectedGet.mockImplementation(async (path: string) => {
    if (path === "/dashboard/onboarding") return { steps };
    throw new Error(`unexpected GET ${path}`);
  });
}

function offerIsOpen(): void {
  vi.mocked(seedApi.probe).mockResolvedValue({
    available: true,
    template: { slug: "blog", label: "Blog" },
  });
  vi.mocked(seedApi.getStatus).mockResolvedValue({
    completedAt: null,
    skippedAt: null,
  });
}

function offerIsClosed(): void {
  vi.mocked(seedApi.probe).mockResolvedValue({ available: false });
}

/** A seed whose outcome the test decides, and when. */
function seedWillSettle() {
  let resolve!: (result: SeedResult) => void;
  let reject!: (error: Error) => void;
  vi.mocked(seedApi.runSeed).mockImplementation(
    () =>
      new Promise<SeedResult>((res, rej) => {
        resolve = res;
        reject = rej;
      })
  );
  return {
    succeed: (result: SeedResult) => act(async () => resolve(result)),
    fail: (error: Error) => act(async () => reject(error)),
  };
}

function draw(beside?: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const announceStatus = vi.fn();
  const onHold = vi.fn();
  const onLeave = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <EmptyDashboard
        announceStatus={announceStatus}
        onHold={onHold}
        onLeave={onLeave}
      />
      {beside}
    </QueryClientProvider>
  );
  return { announceStatus, onHold, onLeave };
}

/**
 * The offer's state, written into the page beside the component under test.
 *
 * It reads the same cached queries, so its text changing is the observable
 * moment the offer has settled -- which a test needs before it can say what the
 * page shows while something ELSE is still unanswered.
 */
function SeedKind() {
  const { status } = useSeedStatus();
  return <span data-testid="seed-kind">{status.kind}</span>;
}

/** The value the most recent report of the hold carried. */
function lastHold(onHold: ReturnType<typeof vi.fn>): unknown {
  return onHold.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("what the empty dashboard says", () => {
  it("asks a reader who may create a collection to create one, ahead of the demo offer", async () => {
    stepsAre([ACCOUNT, COLLECTION_TO_DO]);
    offerIsOpen();
    draw();

    expect(
      await screen.findByRole("heading", { name: "No collections yet" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Create a collection/ })
    ).toHaveAttribute("href", "/admin/builder/collections/new");
    expect(
      screen.queryByRole("button", { name: /Seed demo content/ })
    ).toBeNull();
  });

  it("offers demo content once there is a collection to hold it", async () => {
    stepsAre([ACCOUNT, COLLECTION_DONE, ENTRY_TO_DO]);
    offerIsOpen();
    draw();

    expect(
      await screen.findByRole("button", { name: /Seed demo content/ })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Add your first entry/ })
    ).toBeNull();
  });

  it("points at the first entry once the offer is answered", async () => {
    stepsAre([ACCOUNT, COLLECTION_DONE, ENTRY_TO_DO]);
    offerIsClosed();
    draw();

    expect(
      await screen.findByRole("heading", { name: "No content yet" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Add your first entry/ })
    ).toHaveAttribute("href", "/admin/collections");
  });

  it("offers nothing to press to a reader the host offers no step", async () => {
    // The reader who may read and create nothing: the host leaves out every step
    // they cannot take, so an absent step is not an outstanding one.
    stepsAre([ACCOUNT]);
    offerIsClosed();
    draw();

    expect(
      await screen.findByRole("heading", { name: "Nothing here yet" })
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("draws a placeholder, and says nothing, until the steps are answered", async () => {
    protectedGet.mockImplementation(() => new Promise(() => {}));
    offerIsOpen();
    draw(<SeedKind />);

    // The offer settles first, so the steps are the only thing still
    // unanswered: what is on screen now is the page's answer to waiting on them.
    await waitFor(() =>
      expect(screen.getByTestId("seed-kind")).toHaveTextContent("idle")
    );
    expect(screen.getByTestId("empty-dashboard-pending")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("says the steps could not be read, and offers nothing to press", async () => {
    protectedGet.mockRejectedValue(new Error("onboarding unavailable"));
    offerIsOpen();
    draw();

    expect(
      await screen.findByRole("heading", { name: "Nothing to show yet" })
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("a seed, while it runs", () => {
  beforeEach(() => {
    stepsAre([ACCOUNT, COLLECTION_DONE, ENTRY_TO_DO]);
    offerIsOpen();
  });

  it("says it started and that it landed, through the live region", async () => {
    const seed = seedWillSettle();
    const { announceStatus } = draw();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: /Seed demo content/ })
    );
    await waitFor(() =>
      expect(announceStatus).toHaveBeenLastCalledWith("Loading demo content.")
    );

    await seed.succeed(seedResult());
    await waitFor(() =>
      expect(announceStatus).toHaveBeenLastCalledWith("Demo content seeded.")
    );
  });

  it("says how many warnings a seed left", async () => {
    const seed = seedWillSettle();
    const { announceStatus } = draw();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: /Seed demo content/ })
    );
    await seed.succeed(seedResult(["one image skipped", "one tag renamed"]));

    await waitFor(() =>
      expect(announceStatus).toHaveBeenLastCalledWith(
        "Demo content seeded with 2 warnings."
      )
    );
  });

  it("says why a seed failed", async () => {
    const seed = seedWillSettle();
    const { announceStatus } = draw();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: /Seed demo content/ })
    );
    await seed.fail(new Error("disk full"));

    await waitFor(() =>
      expect(announceStatus).toHaveBeenLastCalledWith(
        "Couldn't seed demo content: disk full"
      )
    );
  });

  it("holds the page from the moment it starts until the reader continues", async () => {
    const seed = seedWillSettle();
    const { onHold, onLeave } = draw();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: /Seed demo content/ })
    );
    // Before the seed answers: the host's next read is what ends an empty
    // install, so the hold has to be in place before any answer can arrive.
    await waitFor(() => expect(lastHold(onHold)).toBe(true));

    await seed.succeed(seedResult(["one image skipped"]));
    await screen.findByRole("button", { name: /Continue to your dashboard/ });
    expect(lastHold(onHold)).toBe(true);

    await user.click(
      screen.getByRole("button", { name: /Continue to your dashboard/ })
    );
    await waitFor(() => expect(lastHold(onHold)).toBe(false));
    // The control the reader pressed is about to go with the page.
    expect(onLeave).toHaveBeenCalled();
  });

  it("lets a clean success go by itself after five seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const seed = seedWillSettle();
    const { onHold } = draw();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.click(
      await screen.findByRole("button", { name: /Seed demo content/ })
    );
    await seed.succeed(seedResult());
    await screen.findByRole("button", { name: /Continue to your dashboard/ });

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(lastHold(onHold)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(lastHold(onHold)).toBe(false);
  });

  it("waits for the reader when the success left warnings to read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const seed = seedWillSettle();
    const { onHold } = draw();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.click(
      await screen.findByRole("button", { name: /Seed demo content/ })
    );
    await seed.succeed(seedResult(["one image skipped"]));
    await screen.findByRole("button", { name: /Continue to your dashboard/ });

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(lastHold(onHold)).toBe(true);
  });

  it("does not move focus when a success goes by itself while the reader is elsewhere", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const seed = seedWillSettle();
    const { onHold, onLeave } = draw();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.click(
      await screen.findByRole("button", { name: /Seed demo content/ })
    );
    await seed.succeed(seedResult());
    await screen.findByRole("button", { name: /Continue to your dashboard/ });
    onLeave.mockClear();
    // Somewhere outside the empty state.
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    elsewhere.focus();

    act(() => {
      vi.advanceTimersByTime(5100);
    });
    expect(lastHold(onHold)).toBe(false);
    expect(onLeave).not.toHaveBeenCalled();
    elsewhere.remove();
  });

  it("lets go of a failed seed when the reader skips, and says where the page went", async () => {
    const seed = seedWillSettle();
    vi.mocked(seedApi.setSkipped).mockResolvedValue(undefined);
    const { onHold, onLeave } = draw();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: /Seed demo content/ })
    );
    await seed.fail(new Error("disk full"));
    await waitFor(() => expect(lastHold(onHold)).toBe(true));

    // Pressing Seed already moved focus once; only what Skip does is asked here.
    onLeave.mockClear();
    await user.click(
      screen.getByRole("button", { name: /Skip — I.ll add my own content/ })
    );

    await waitFor(() => expect(lastHold(onHold)).toBe(false));
    expect(onLeave).toHaveBeenCalled();
    expect(seedApi.setSkipped).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("heading", { name: "No content yet" })
    ).toBeInTheDocument();
  });
});

describe("the offer's own controls", () => {
  beforeEach(() => {
    stepsAre([ACCOUNT, COLLECTION_DONE, ENTRY_TO_DO]);
    offerIsOpen();
  });

  it("reveals the skip control to a keyboard reader, not only under a pointer", async () => {
    draw();

    const skip = await screen.findByRole("button", { name: "Skip seeding" });
    // jsdom draws no styles, so what is asserted is the cause: the reveal is
    // keyed on keyboard focus as well as on hover.
    expect(skip.className).toContain("focus-visible:opacity-100");
  });

  it("offers Continue after a success, and no skip that would record the offer declined", async () => {
    const seed = seedWillSettle();
    draw();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: /Seed demo content/ })
    );
    await seed.succeed(seedResult());

    expect(
      await screen.findByRole("button", { name: /Continue to your dashboard/ })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip seeding" })).toBeNull();
  });
});
