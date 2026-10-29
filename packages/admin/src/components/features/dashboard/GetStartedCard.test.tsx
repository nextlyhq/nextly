/**
 * The Get started card's states, its progress line, its Singles and its controls, drawn from the
 * steps the layout read answered.
 */
import type { GetStartedAnswer, GetStartedStep } from "nextly/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { CardGrowContext } from "@admin/components/features/widgets/frame/grow";
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
      {inFrame(
        <GetStartedCard
          widgetId="core/get-started"
          placementId="started"
          settings={{}}
          slot={undefined}
          isFetching={false}
        />
      )}
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

  it("says in the frame that it could not check setup, offers Retry, and shows no step as waiting", () => {
    // 🔴 Not known drawn as steps would show "Create a collection" as waiting
    // to a reader whose registry simply could not be read.
    const retry = vi.fn();
    read = readOf({
      answer: answerOf([step("invite", "invite", "open")], true),
      retry,
    });
    draw();
    expect(screen.getByText(/could not be read just now/i)).toBeInTheDocument();
    expect(screen.queryByText("Invite a teammate")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Retry/ }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("says the same when the layout read failed", () => {
    read = readOf({ isUnavailable: true });
    draw();
    expect(screen.getByText(/could not be read just now/i)).toBeInTheDocument();
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

  it("loads sample content only once the record that the reader acted has landed", () => {
    // 🔴 Loading sample content can finish the last step. Started beside the
    // record rather than after it, the load can land first, the record is then
    // refused as stale, and the card goes instead of saying "You're all set".
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
      expect.objectContaining({ onLanded: expect.any(Function) })
    );
    expect(seed.startSeed).not.toHaveBeenCalled();
    const callbacks = write.mock.calls.at(-1)?.[3] as { onLanded: () => void };
    callbacks.onLanded();
    expect(seed.startSeed).toHaveBeenCalledTimes(1);
  });

  it("draws a step of a kind this admin does not know as a plain row, not a crash", () => {
    // 🔴 A server newer than the open admin can send a new kind: the card
    // must still draw, with that step as a row beside the others.
    read = readOf({
      answer: answerOf([
        step("collection", "collection", "done"),
        step("webhook", "webhook" as GetStartedStep["kind"], "open"),
      ]),
    });
    draw();
    expect(screen.getByText("Create a collection")).toBeTruthy();
    expect(screen.getByText("Finish setup: webhook")).toBeTruthy();
  });

  it("says a sample-content load failed, with its message, and offers Retry", () => {
    // 🔴 A failed load drew nothing: the controls vanished with no word why.
    seed.status = { kind: "error", message: "The database refused it." };
    read = readOf({ answer: STEPS });
    draw();
    expect(screen.getByRole("alert").textContent).toContain(
      "The database refused it."
    );
    fireEvent.click(screen.getByRole("button", { name: /^Retry/ }));
    (write.mock.calls.at(-1)?.[3] as { onLanded: () => void }).onLanded();
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
        {inFrame(
          <GetStartedCard
            widgetId="core/get-started"
            placementId="started"
            settings={{}}
            slot={undefined}
            isFetching={false}
          />
        )}
      </AtRestSettingsWriteProvider>
    );
    const skip = screen.getByRole("button", {
      name: /Skip: Invite a teammate/,
    });
    expect(skip).toBeDisabled();
    expect(skip).toHaveAttribute("title", expect.stringMatching(/customising/));
  });

  it("draws every step, with no control, when every step fits", () => {
    // jsdom lays nothing out, so every step measures as fitting: the steps are all drawn, in
    // the server's order, and there is nothing to show more of.
    const singles = Array.from({ length: 7 }, (_, i) =>
      step(`single:s${i}`, "single", "open", `s${i}`)
    );
    read = readOf({ answer: answerOf(singles) });
    draw();
    expect(screen.getAllByText(/^Fill in s\d$/)).toHaveLength(7);
    expect(screen.queryByRole("button", { name: /^Show / })).toBeNull();
  });

  it("draws only the whole steps its body holds, and grows in place to show the rest", () => {
    // A body that ends 300 px down, steps 50 px tall from 60 px, and the control 44 px below
    // the last step: three whole steps fit above the control, the fourth would be cut.
    const rect = (top: number, bottom: number) =>
      ({
        top,
        bottom,
        left: 0,
        right: 600,
        width: 600,
        height: bottom - top,
      }) as DOMRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.getAttribute("data-testid") === "widget-card-body") {
          return rect(0, 300);
        }
        if (this.hasAttribute("data-step-row")) {
          const index = [
            ...(this.parentElement?.querySelectorAll("[data-step-row]") ?? []),
          ].indexOf(this);
          return rect(60 + 50 * index, 60 + 50 * (index + 1));
        }
        if (this.hasAttribute("aria-controls")) {
          const rows = this.parentElement?.querySelectorAll("[data-step-row]");
          const last = 60 + 50 * (rows?.length ?? 0);
          return rect(last + 12, last + 44);
        }
        return rect(12, 12);
      }
    );
    const steps = [
      step("collection", "collection", "done"),
      step("entry", "entry", "open"),
      ...Array.from({ length: 4 }, (_, i) =>
        step(`single:s${i}`, "single", "open", `s${i}`)
      ),
      step("invite", "invite", "open"),
    ];
    read = readOf({ answer: answerOf(steps) });
    const reports: (number | undefined)[] = [];
    render(
      <AtRestSettingsWriteProvider value={atRest}>
        <CardGrowContext.Provider value={px => reports.push(px)}>
          {inFrame(
            <GetStartedCard
              widgetId="core/get-started"
              placementId="started"
              settings={{}}
              slot={undefined}
              isFetching={false}
            />
          )}
        </CardGrowContext.Provider>
      </AtRestSettingsWriteProvider>
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    // The room goes to what is still to do: the done Collection step, first in the server's
    // order, is folded behind the control while three steps to do are drawn.
    for (const row of screen.getAllByRole("listitem")) {
      expect(row).toHaveTextContent("still to do");
    }
    const control = screen.getByRole("button", { name: "Show 4 more" });
    expect(control).toHaveAttribute("aria-expanded", "false");
    expect(reports.at(-1)).toBeUndefined();

    // Unfolded: every step, the control now folds them, and the card asks for more rows.
    control.focus();
    fireEvent.click(control);
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(control).toHaveAccessibleName("Show less");
    expect(control).toHaveAttribute("aria-expanded", "true");
    expect(typeof reports.at(-1)).toBe("number");
    // The same control, so focus stays on it.
    expect(control).toHaveFocus();

    // Folded again: the same three steps, and the card back to its own rows.
    fireEvent.click(control);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(control).toHaveAccessibleName("Show 4 more");
    expect(reports.at(-1)).toBeUndefined();
    expect(control).toHaveFocus();
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
    // Drawn inside the frame, whose title is the one heading there should be.
    for (const state of [
      readOf({ isPending: true }),
      readOf({ isUnavailable: true }),
      readOf({ answer: STEPS }),
      readOf({ answer: answerOf([step("invite", "invite", "done")]) }),
    ]) {
      read = state;
      const { unmount } = draw();
      expect(screen.queryAllByRole("heading")).toHaveLength(1);
      unmount();
    }
  });
});
