/**
 * The Get started card's states, its progress line, its Singles and its controls, drawn from the
 * steps the layout read answered.
 */
import type { GetStartedAnswer, GetStartedStep } from "nextly/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen } from "@admin/__tests__/utils";
import {
  AtRestSettingsWriteProvider,
  type AtRestSettingsWrite,
} from "@admin/components/features/widgets/edit/at-rest-settings-write";
import type { UseGetStartedResult } from "@admin/hooks/queries/useGetStarted";

let read: UseGetStartedResult;
vi.mock("@admin/hooks/queries/useGetStarted", () => ({
  useGetStarted: () => read,
}));
// The sample-content offer's state, as a case sets it.
const seed = vi.hoisted(() => ({
  status: { kind: "hidden" } as
    | { kind: "hidden" }
    | { kind: "idle"; template: { slug: string; label: string } }
    | { kind: "error"; message: string },
  startSeed: vi.fn(),
  skip: vi.fn(),
}));
vi.mock("@admin/hooks/queries/useSeedStatus", () => ({
  useSeedStatus: () => seed,
}));
vi.mock("@admin/hooks/queries/useSingles", () => ({
  useSingles: () => ({
    data: { items: [{ slug: "home", label: "Home page" }] },
  }),
}));

import { GetStartedCard } from "./GetStartedCard";

const step = (
  key: string,
  kind: GetStartedStep["kind"],
  status: GetStartedStep["status"],
  single?: string
): GetStartedStep => ({ key, kind, status, ...(single ? { single } : {}) });

function answerOf(steps: GetStartedStep[], unknown = false): GetStartedAnswer {
  return {
    unknown,
    steps,
    done: steps.filter(s => s.status === "done" || s.status === "skipped")
      .length,
    total: steps.length,
  };
}

function readOf(patch: Partial<UseGetStartedResult>): UseGetStartedResult {
  return {
    answer: undefined,
    isPending: false,
    isUnavailable: false,
    retry: vi.fn(),
    acted: false,
    ...patch,
  };
}

const write = vi.fn();
const atRest: AtRestSettingsWrite = {
  write,
  isWriting: false,
  announce: vi.fn(),
};

function draw(settings: AtRestSettingsWrite = atRest) {
  return render(
    <AtRestSettingsWriteProvider value={settings}>
      <GetStartedCard
        widgetId="core/get-started"
        placementId="started"
        settings={{}}
        slot={undefined}
        isFetching={false}
      />
    </AtRestSettingsWriteProvider>
  );
}

const STEPS = answerOf([
  step("collection", "collection", "done"),
  step("entry", "entry", "open"),
  step("single:home", "single", "open", "home"),
  step("invite", "invite", "open"),
]);

beforeEach(() => {
  write.mockClear();
  seed.status = { kind: "hidden" };
  seed.startSeed.mockClear();
  seed.skip.mockClear();
});

describe("the Get started card", () => {
  it("draws the frame's skeleton while the steps load", () => {
    read = readOf({ isPending: true });
    draw();
    expect(screen.getByTestId("card-skeleton")).toBeInTheDocument();
  });

  it("says it could not check setup, offers Retry, and shows no step as waiting", () => {
    // 🔴 Not known drawn as steps would show "Create a collection" as waiting
    // to a reader whose registry simply could not be read.
    const retry = vi.fn();
    read = readOf({
      answer: answerOf([step("invite", "invite", "open")], true),
      retry,
    });
    draw();
    expect(screen.getByText(/couldn't check your setup/i)).toBeInTheDocument();
    expect(screen.queryByText("Invite a teammate")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("says the same when the layout read failed", () => {
    read = readOf({ isUnavailable: true });
    draw();
    expect(screen.getByText(/couldn't check your setup/i)).toBeInTheDocument();
  });

  it("counts done and skipped steps as done, and names a Single by its label", () => {
    read = readOf({
      answer: answerOf([
        ...STEPS.steps.slice(0, 3),
        step("invite", "invite", "skipped"),
      ]),
    });
    draw();
    expect(screen.getByTestId("get-started-progress")).toHaveTextContent(
      "2 of 4 done"
    );
    expect(screen.getByText("Fill in Home page")).toBeInTheDocument();
  });

  it("offers Skip only on the steps a site can do without, and stores the skip with acted", () => {
    read = readOf({ answer: STEPS });
    draw();
    expect(
      screen.queryByRole("button", { name: /Skip: Add your first entry/ })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /Skip: Invite a teammate/ })
    );
    expect(write).toHaveBeenCalledWith(
      "started",
      "Get started",
      { acted: true, skipped: ["invite"] },
      {}
    );
  });

  it("records that the reader acted before it loads sample content", () => {
    // 🔴 Loading sample content can finish the last step; unrecorded, the
    // card then goes instead of saying "You're all set".
    seed.status = { kind: "idle", template: { slug: "blog", label: "Blog" } };
    read = readOf({ answer: STEPS });
    draw();
    fireEvent.click(
      screen.getByRole("button", { name: "Load sample content" })
    );
    expect(write).toHaveBeenCalledWith(
      "started",
      "Get started",
      expect.objectContaining({ acted: true }),
      expect.anything()
    );
    expect(seed.startSeed).toHaveBeenCalledTimes(1);
  });

  it("says a sample-content load failed, with its message, and offers Retry", () => {
    // 🔴 A failed load drew nothing: the controls vanished with no word why.
    seed.status = { kind: "error", message: "The database refused it." };
    read = readOf({ answer: STEPS });
    draw();
    expect(screen.getByRole("alert").textContent).toContain(
      "The database refused it."
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(seed.startSeed).toHaveBeenCalledTimes(1);
  });

  it("restores a skipped step, keeping the other skips", () => {
    read = readOf({
      answer: answerOf([
        step("single:home", "single", "skipped", "home"),
        step("invite", "invite", "skipped"),
      ]),
      acted: true,
    });
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Show the steps" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Restore: Invite a teammate/ })
    );
    expect(write).toHaveBeenCalledWith(
      "started",
      "Get started",
      { acted: true, skipped: ["single:home"] },
      {}
    );
  });

  it("disables its controls while customising, saying why", () => {
    read = readOf({ answer: STEPS });
    render(
      <AtRestSettingsWriteProvider value={undefined}>
        <GetStartedCard
          widgetId="core/get-started"
          placementId="started"
          settings={{}}
          slot={undefined}
          isFetching={false}
        />
      </AtRestSettingsWriteProvider>
    );
    const skip = screen.getByRole("button", {
      name: /Skip: Invite a teammate/,
    });
    expect(skip).toBeDisabled();
    expect(skip).toHaveAttribute("title", expect.stringMatching(/customising/));
  });

  it("lists five Singles, then a control for the rest", () => {
    const singles = Array.from({ length: 7 }, (_, i) =>
      step(`single:s${i}`, "single", "open", `s${i}`)
    );
    read = readOf({ answer: answerOf(singles) });
    draw();
    expect(screen.getAllByText(/^Fill in s\d$/)).toHaveLength(5);
    const more = screen.getByRole("button", { name: "Show 2 more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(screen.getAllByText(/^Fill in s\d$/)).toHaveLength(7);
    expect(
      screen.getByRole("button", { name: "Show fewer Singles" })
    ).toHaveAttribute("aria-expanded", "true");
  });

  it('says "You\'re all set" once every step is done or skipped, with the steps a click away', () => {
    read = readOf({
      answer: answerOf([
        step("collection", "collection", "done"),
        step("invite", "invite", "skipped"),
      ]),
    });
    draw();
    expect(screen.getByTestId("get-started-all-set")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show the steps" }));
    expect(screen.getByTestId("get-started-progress")).toHaveTextContent(
      "2 of 2 done"
    );
  });

  it("draws no heading of its own in any state: the frame's title is its one heading", () => {
    for (const state of [
      readOf({ isPending: true }),
      readOf({ isUnavailable: true }),
      readOf({ answer: STEPS }),
      readOf({ answer: answerOf([step("invite", "invite", "done")]) }),
    ]) {
      read = state;
      const { unmount } = draw();
      expect(screen.queryAllByRole("heading")).toHaveLength(0);
      unmount();
    }
  });
});
