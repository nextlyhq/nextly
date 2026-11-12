/**
 * The setup card's states, its checklist, its Singles and its buttons, drawn from what the card's
 * `load` answered, and what each button writes.
 */
import { QueryClient } from "@tanstack/react-query";
import type { SetupCardData, SetupStep } from "nextly/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { WIDGET_QUERIES_KEY } from "@admin/hooks/queries/widget-queries-key";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@admin/__tests__/utils";

// What the card writes, as the route receives it.
const { put } = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { put },
}));
// The project's sample-content route: it lets this reader load. Its runs are drawn and tested in
// `setup/SampleContentStep.test.tsx`.
const probe = vi.hoisted(() => ({
  answer: { available: true } as { available: boolean },
}));
vi.mock("@admin/services/seedApi", () => ({
  seedApi: {
    probe: async () =>
      probe.answer.available
        ? { available: true, template: { slug: "blog", label: "Blog" } }
        : { available: false },
    start: vi.fn(),
  },
}));
vi.mock("@admin/hooks/queries/useSingles", () => ({
  useSingles: () => ({
    data: {
      items: [
        { slug: "home", label: "Home page" },
        { slug: "about", label: "About" },
      ],
    },
  }),
}));

import { SetupCard } from "./SetupCard";

const SINGLES = ["home", "about", "footer", "contact", "legal"];

const STEPS: SetupStep[] = [
  { kind: "sample", status: "open" },
  { kind: "collection", status: "done" },
  { kind: "entry", status: "open", collection: "posts" },
  {
    kind: "singles",
    status: "open",
    singles: SINGLES.map((slug, index) => ({ slug, filledIn: index < 2 })),
  },
  { kind: "invite", status: "open" },
];

function dataOf(patch: Partial<SetupCardData> = {}): SetupCardData {
  return {
    setup: {
      known: true,
      steps: STEPS,
      done: STEPS.filter(s => s.status !== "open").length,
      total: STEPS.length,
    },
    collapsed: false,
    allSet: false,
    ...patch,
  };
}

/** A known answer over `steps`, counted. */
function stepsOf(steps: SetupStep[]): Partial<SetupCardData> {
  return {
    setup: {
      known: true,
      steps,
      done: steps.filter(s => s.status !== "open").length,
      total: steps.length,
    },
  };
}

const retry = vi.fn();

// The dashboard's answers asked for again in place, by the batch's own query.
const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
/** How many times the card asked the dashboard's answers again in place. */
const readInPlace = () =>
  invalidate.mock.calls.filter(
    ([filters]) =>
      JSON.stringify(filters?.queryKey) === JSON.stringify(WIDGET_QUERIES_KEY)
  ).length;

/** The card as the dashboard draws it, for `render` or a `rerender` with new data, at `w` columns. */
function tree(data: SetupCardData, w = 6) {
  return inFrame(
    <SetupCard
      widgetId="core/setup"
      placementId="core/setup"
      settings={{}}
      size={{ w, h: 4, tier: w >= 8 ? "large" : "medium" }}
      data={data}
      refreshing={false}
      retry={retry}
    />,
    "Set up your project"
  );
}

function draw(data: SetupCardData, w?: number) {
  return render(tree(data, w));
}

/** "N of M done", as the frame's header draws it beside the title. */
const headerCount = () => screen.getByTestId("widget-card-title-count");

/** The lines, in order, by the step each draws. */
const lines = () =>
  screen
    .getAllByRole("listitem")
    .filter(item => item.hasAttribute("data-setup-step"));

/** The line of `kind`. */
const lineOf = (kind: SetupStep["kind"]) =>
  lines().find(line => line.dataset.setupStep === kind)!;

/** A line's hint, under its name. */
const hintOf = (kind: SetupStep["kind"]) =>
  lineOf(kind).querySelector("[data-checklist-hint]")!.textContent;

/** A line's mark. */
const markOf = (kind: SetupStep["kind"]) =>
  lineOf(kind).querySelector<HTMLElement>("[data-checklist-mark]")!;

beforeEach(() => {
  put.mockReset();
  put.mockResolvedValue({});
  retry.mockClear();
  probe.answer = { available: true };
  invalidate.mockClear();
});

describe("the setup card's checklist", () => {
  it("draws N of M done in the header, a bar, then one line per step in order", () => {
    draw(dataOf());
    expect(headerCount()).toHaveTextContent("1 of 5 done");
    // Read with the title, as the card's name.
    expect(
      screen.getByRole("region", { name: /Set up your project/ })
    ).toHaveAccessibleName("Set up your project, 1 of 5 done");
    const bar = document.querySelector<HTMLElement>(
      "[data-checklist-progress]"
    )!;
    expect(bar.firstElementChild).toHaveStyle({ width: "20%" });
    // Drawn in the success status's solid colour, its own thin shape.
    expect(bar.firstElementChild).toHaveClass("bg-success-solid");
    expect(bar).toHaveClass("h-1");
    expect(screen.getByRole("list", { name: "Setup steps" })).toBeVisible();
    expect(lines().map(line => line.dataset.setupStep)).toEqual([
      "sample",
      "collection",
      "entry",
      "singles",
      "invite",
    ]);
  });

  it("draws a tick once a step is done, a dashed circle once skipped and an empty circle while open", () => {
    draw(
      dataOf(
        stepsOf([
          { kind: "collection", status: "done" },
          { kind: "entry", status: "open", collection: "posts" },
          { kind: "invite", status: "skipped" },
        ])
      )
    );
    expect(markOf("collection").querySelector("svg")).not.toBeNull();
    expect(markOf("collection")).toHaveClass(
      "bg-success-solid",
      "border-success-solid"
    );
    expect(markOf("invite")).toHaveClass("border-dashed");
    expect(markOf("invite").querySelector("svg")).toBeNull();
    expect(markOf("entry")).not.toHaveClass("border-dashed");
    expect(markOf("entry").querySelector("svg")).toBeNull();
    // Done and skipped say so under the name; an open step says what it asks.
    expect(hintOf("collection")).toBe("Done");
    expect(hintOf("invite")).toBe("Skipped");
    expect(hintOf("entry")).toBe("Write something to publish");
    // Each status in words too, which the mark only shows.
    expect(lineOf("collection")).toHaveTextContent(
      "Create a collection — done"
    );
    expect(lineOf("invite")).toHaveTextContent("Invite a teammate — skipped");
    expect(lineOf("entry")).toHaveTextContent(
      "Add your first entry — still to do"
    );
    // No step numbers.
    for (const line of lines()) {
      expect(line.querySelector("[data-checklist-mark]")).toHaveTextContent("");
    }
  });

  it("draws each open step's hint and buttons, Skip beside the two skippable ones", async () => {
    draw(dataOf());
    const sample = lineOf("sample");
    expect(
      await within(sample).findByRole("button", { name: "Add samples" })
    ).toBeVisible();
    expect(hintOf("sample")).toBe("A ready-made site to look around");
    expect(
      within(sample).getByRole("button", { name: "No thanks" })
    ).toBeVisible();
    expect(
      within(lineOf("entry")).getByRole("link", {
        name: "Add entry: Add your first entry",
      })
    ).toBeVisible();
    expect(hintOf("singles")).toBe("2 of 5 filled in");
    expect(
      within(lineOf("singles"))
        .getAllByRole("button")
        .map(button => button.getAttribute("aria-label"))
    ).toEqual(["Show: Fill in your Singles", "Skip: Fill in your Singles"]);
    expect(hintOf("invite")).toBe("Optional");
    expect(
      within(lineOf("invite")).getByRole("link", {
        name: "Invite: Invite a teammate",
      })
    ).toHaveAttribute("href", "/admin/users/create");
    expect(
      within(lineOf("invite")).getByRole("button", {
        name: "Skip: Invite a teammate",
      })
    ).toBeVisible();
    // A step done has nothing to press.
    expect(within(lineOf("collection")).queryAllByRole("button")).toEqual([]);
    expect(within(lineOf("collection")).queryAllByRole("link")).toEqual([]);
  });

  it("draws buttons, never underlined links, and no tinted backgrounds", async () => {
    draw(dataOf());
    await within(lineOf("sample")).findByRole("button", {
      name: "Add samples",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Show: Fill in your Singles" })
    );
    const card = screen.getByTestId("setup-card");
    for (const element of card.querySelectorAll("*")) {
      const classes = element.getAttribute("class") ?? "";
      expect(classes).not.toMatch(/(^|\s)underline(\s|$)|decoration-/);
      // A tinted shade: a status colour at an alpha, or a pale step of one.
      expect(classes).not.toMatch(
        /bg-(success|warning|danger|info|destructive)(-\d{2,3}|\/\d+)/
      );
    }
    // Every action is a 28 px button, a link drawn as one where it leads somewhere.
    for (const control of [
      ...within(card).getAllByRole("button"),
      ...within(card).getAllByRole("link"),
    ]) {
      expect(control).toHaveClass("h-7");
    }
  });

  it("draws no heading of its own: the frame's title is the card's one", () => {
    draw(dataOf());
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("lists the Singles inside their line on Show, each with its state and a Fill in button, and Hide closes it", () => {
    draw(dataOf());
    const show = screen.getByRole("button", {
      name: "Show: Fill in your Singles",
    });
    expect(show).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(show);
    expect(show).toHaveAttribute("aria-expanded", "true");
    expect(show).toHaveTextContent("Hide");
    expect(show).toHaveAccessibleName("Hide: Fill in your Singles");
    const list = screen.getByRole("list", {
      name: "Your Singles, 2 of 5 filled in",
    });
    expect(lineOf("singles")).toContainElement(list);
    expect(list).toHaveClass("grid-cols-[minmax(0,1fr)]");
    const home = list.querySelector<HTMLElement>('[data-setup-single="home"]')!;
    expect(home).toHaveTextContent("Home pageFilled in");
    expect(within(home).queryByRole("link")).toBeNull();
    const footer = list.querySelector<HTMLElement>(
      '[data-setup-single="footer"]'
    )!;
    expect(footer).toHaveTextContent("Not filled in yet");
    const fill = within(footer).getByRole("link", { name: "Fill in: footer" });
    expect(fill).toHaveAttribute("href", "/admin/singles/footer");
    expect(fill).toHaveClass("h-7", "border-control-border");
    fireEvent.click(show);
    expect(screen.queryByRole("list", { name: /Your Singles/ })).toBeNull();
  });

  it("links Add your first entry to a new entry of the first creatable collection, not the collections index", () => {
    draw(dataOf());
    expect(
      screen.getByRole("link", { name: "Add entry: Add your first entry" })
    ).toHaveAttribute("href", "/admin/collections/posts/create");
  });

  it("offers Skip on Fill in your Singles and Invite a teammate only, and writes the skip", async () => {
    draw(dataOf());
    const skips = screen.getAllByRole("button", { name: /^Skip/ });
    expect(skips.map(button => button.getAttribute("aria-label"))).toEqual([
      "Skip: Fill in your Singles",
      "Skip: Invite a teammate",
    ]);
    fireEvent.click(skips[1]!);
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/dashboard/setup", {
        skip: { kind: "invite", skipped: true },
      })
    );
    // The card asks for its data again, which the skip changed.
    await waitFor(() => expect(retry).toHaveBeenCalled());
  });

  it("offers Restore on a skipped step, counted as done", async () => {
    const steps: SetupStep[] = [
      { kind: "collection", status: "done" },
      { kind: "invite", status: "skipped" },
      { kind: "entry", status: "open", collection: "posts" },
    ];
    draw(dataOf({ setup: { known: true, steps, done: 2, total: 3 } }));
    expect(headerCount()).toHaveTextContent("2 of 3 done");
    fireEvent.click(
      screen.getByRole("button", { name: "Restore: Invite a teammate" })
    );
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/dashboard/setup", {
        skip: { kind: "invite", skipped: false },
      })
    );
  });

  it("drops sample content's line once it is answered, counting the lines shown", () => {
    draw(
      dataOf(
        stepsOf([
          { kind: "sample", status: "done" },
          { kind: "collection", status: "done" },
          { kind: "entry", status: "open", collection: "posts" },
        ])
      )
    );
    expect(lines().map(line => line.dataset.setupStep)).toEqual([
      "collection",
      "entry",
    ]);
    expect(headerCount()).toHaveTextContent("1 of 2 done");
    expect(screen.queryByText("Answered")).toBeNull();
  });

  it("offers no collapse or dismiss of its own, and draws its steps whatever an earlier collapse stored", () => {
    draw(dataOf({ collapsed: true }));
    expect(screen.getByRole("list", { name: "Setup steps" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Collapse setup/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Expand setup/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Dismiss setup/ })).toBeNull();
    expect(
      within(screen.getByTestId("widget-card-header")).queryAllByRole("button")
        .length
    ).toBe(0);
  });

  it("draws the same checklist at 50%, 66%, 75% and 100%, its buttons wrapping under the name, never scrolling sideways", () => {
    for (const w of [6, 8, 9, 12]) {
      const { unmount } = draw(dataOf(), w);
      expect(lines()).toHaveLength(5);
      for (const line of lines()) {
        // The name takes what is left and the buttons wrap under it where both do not fit.
        expect(line).toHaveClass("flex", "flex-wrap");
        expect(line.querySelector("[data-checklist-actions]")).toHaveClass(
          "ml-auto",
          "flex-wrap"
        );
      }
      // The card, its list and the Singles' list are one column no wider than the card, so a long
      // name is cut short rather than widening the column past the card's edge.
      expect(screen.getByTestId("setup-card")).toHaveClass(
        "grid-cols-[minmax(0,1fr)]"
      );
      expect(screen.getByRole("list", { name: "Setup steps" })).toHaveClass(
        "grid-cols-[minmax(0,1fr)]"
      );
      // Nothing in the card scrolls.
      for (const element of screen
        .getByTestId("setup-card")
        .querySelectorAll("*")) {
        expect(element.getAttribute("class") ?? "").not.toMatch(
          /overflow-(x-)?(auto|scroll)/
        );
      }
      unmount();
    }
  });

  it("says when a change could not be saved", async () => {
    put.mockRejectedValue(new Error("network"));
    draw(dataOf());
    fireEvent.click(
      screen.getByRole("button", { name: "Skip: Invite a teammate" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be saved"
    );
  });

  it("says You're all set once every step is done, with Hide setup, which hides it", async () => {
    draw(
      dataOf({
        allSet: true,
        setup: {
          known: true,
          steps: [{ kind: "collection", status: "done" }],
          done: 1,
          total: 1,
        },
      })
    );
    const allSet = screen.getByTestId("setup-all-set");
    expect(allSet).toHaveTextContent("You're all set");
    expect(allSet).toHaveTextContent("Every step is done or skipped.");
    expect(screen.queryByRole("list", { name: "Setup steps" })).toBeNull();
    fireEvent.click(within(allSet).getByRole("button", { name: "Hide setup" }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/dashboard/setup", { dismissed: true })
    );
  });

  it("says it could not check setup, with Retry, and shows no step open", () => {
    draw(dataOf({ setup: { known: false } }));
    expect(
      screen.getByText("We couldn't check your setup just now.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Setup steps" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalled();
  });

  it("says You're all set over the steps it draws, and asks the host to record it with what the route said", async () => {
    // No sample route for this reader, and Invite skipped: one line drawn, done.
    probe.answer = { available: false };
    const steps: SetupStep[] = [
      { kind: "sample", status: "open" },
      { kind: "invite", status: "skipped" },
    ];
    let land: (answer: unknown) => void = () => undefined;
    put.mockReturnValueOnce(
      new Promise(resolve => {
        land = resolve;
      })
    );
    draw(dataOf({ setup: { known: true, steps, done: 1, total: 2 } }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/dashboard/setup", {
        retire: { sampleRefused: true },
      })
    );
    // Not before the host has recorded it: until then the one line is drawn, done.
    expect(screen.queryByTestId("setup-all-set")).toBeNull();
    expect(headerCount()).toHaveTextContent("1 of 1 done");
    act(() => land({}));
    expect(await screen.findByTestId("setup-all-set")).toHaveTextContent(
      "You're all set"
    );
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("draws the steps again, and never says it will not show again, when the host refuses the retirement", async () => {
    // The host finds a step open as it sees the site now (409): nothing recorded.
    put.mockRejectedValueOnce(
      Object.assign(new Error("Setup is not all set: a step is still open."), {
        status: 409,
        code: "CONFLICT",
      })
    );
    probe.answer = { available: false };
    const steps: SetupStep[] = [
      { kind: "sample", status: "open" },
      { kind: "invite", status: "skipped" },
    ];
    const data = dataOf({ setup: { known: true, steps, done: 1, total: 2 } });
    const { rerender } = draw(data);
    // The dashboard's answers are read again, once, in place (never the host's Retry, which
    // would unmount the card), to draw the steps as the host has them.
    await waitFor(() => expect(readInPlace()).toBe(1));
    expect(retry).not.toHaveBeenCalled();
    expect(screen.queryByTestId("setup-all-set")).toBeNull();
    expect(screen.queryByText(/won't show again/)).toBeNull();
    expect(
      screen.getByRole("list", { name: "Setup steps" })
    ).toBeInTheDocument();
    // A refusal is never asked again over the same answer, however often it is drawn.
    rerender(tree(data));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("says nothing failed when the host refuses the card's own retirement: the header keeps its progress", async () => {
    put.mockRejectedValueOnce(
      Object.assign(new Error("Setup is not all set: a step is still open."), {
        status: 409,
        code: "CONFLICT",
      })
    );
    probe.answer = { available: false };
    const steps: SetupStep[] = [
      { kind: "sample", status: "open" },
      { kind: "invite", status: "skipped" },
    ];
    draw(dataOf({ setup: { known: true, steps, done: 1, total: 2 } }));
    await waitFor(() => expect(readInPlace()).toBe(1));
    // Nothing the reader changed failed: the count stays, and nothing is announced.
    expect(headerCount()).toHaveTextContent("1 of 1 done");
    expect(headerCount()).not.toHaveTextContent("could not be saved");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks once over a refusal the host keeps giving, however often the same steps are read again", async () => {
    // The host refuses every time: no preferences table, or a write it cannot record.
    const refusal = () =>
      Object.assign(new Error("Setup is not all set: a step is still open."), {
        status: 409,
        code: "CONFLICT",
      });
    put.mockImplementation(() => Promise.reject(refusal()));
    probe.answer = { available: false };
    const steps = (): SetupStep[] => [
      { kind: "sample", status: "open" },
      { kind: "invite", status: "skipped" },
    ];
    const answer = () =>
      dataOf({ setup: { known: true, steps: steps(), done: 1, total: 2 } });
    const { rerender } = draw(answer());
    await waitFor(() => expect(readInPlace()).toBe(1));
    expect(retry).not.toHaveBeenCalled();
    // Each read hands a new object with the same steps: never a second request.
    for (let read = 0; read < 4; read += 1) {
      rerender(tree(answer()));
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(put).toHaveBeenCalledTimes(1);
    expect(readInPlace()).toBe(1);
  });

  it("asks once more after a refusal when a new answer is all done, finished elsewhere before the read", async () => {
    put.mockRejectedValueOnce(
      Object.assign(new Error("Setup is not all set: a step is still open."), {
        status: 409,
        code: "CONFLICT",
      })
    );
    probe.answer = { available: false };
    const asked: SetupStep[] = [
      { kind: "sample", status: "open" },
      { kind: "invite", status: "skipped" },
    ];
    const data = dataOf({
      setup: { known: true, steps: asked, done: 1, total: 2 },
    });
    const { rerender } = draw(data);
    await waitFor(() => expect(readInPlace()).toBe(1));
    expect(retry).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledTimes(1);
    // The read the refusal asked for answers all done again: Invite was finished on another
    // device meanwhile, so the card never draws a step open in between.
    rerender(
      tree(
        dataOf({
          setup: {
            known: true,
            steps: [
              { kind: "sample", status: "open" },
              { kind: "invite", status: "done" },
            ],
            done: 1,
            total: 2,
          },
        })
      )
    );
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put).toHaveBeenLastCalledWith("/dashboard/setup", {
      retire: { sampleRefused: true },
    });
  });

  it("asks again after a refusal once the steps read again had one open and it is then done", async () => {
    // The host finds a step open (409), and the card's next read agrees: Invite is open.
    put.mockRejectedValueOnce(
      Object.assign(new Error("Setup is not all set: a step is still open."), {
        status: 409,
        code: "CONFLICT",
      })
    );
    probe.answer = { available: false };
    const done: SetupStep[] = [
      { kind: "sample", status: "open" },
      { kind: "invite", status: "skipped" },
    ];
    const { rerender } = draw(
      dataOf({ setup: { known: true, steps: done, done: 1, total: 2 } })
    );
    await waitFor(() => expect(readInPlace()).toBe(1));
    expect(retry).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledTimes(1);
    rerender(
      tree(
        dataOf({
          setup: {
            known: true,
            steps: [
              { kind: "sample", status: "open" },
              { kind: "invite", status: "open" },
            ],
            done: 0,
            total: 2,
          },
        })
      )
    );
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(put).toHaveBeenCalledTimes(1);
    // The reader skips Invite on this card: every step drawn is done again, so it asks again.
    rerender(
      tree(dataOf({ setup: { known: true, steps: done, done: 1, total: 2 } }))
    );
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put).toHaveBeenLastCalledWith("/dashboard/setup", {
      retire: { sampleRefused: true },
    });
  });

  it("asks no retirement while a step it draws is open", () => {
    // The must-differ half: the same steps where the route offers the load.
    const steps: SetupStep[] = [
      { kind: "sample", status: "open" },
      { kind: "invite", status: "skipped" },
    ];
    draw(dataOf({ setup: { known: true, steps, done: 1, total: 2 } }));
    expect(screen.queryByTestId("setup-all-set")).toBeNull();
    expect(headerCount()).toHaveTextContent("1 of 2 done");
    expect(put).not.toHaveBeenCalled();
  });

  it("asks the host again to record all set after a failed write, on the card's next read, never in a loop", async () => {
    put.mockRejectedValueOnce(new Error("network"));
    probe.answer = { available: false };
    const steps: SetupStep[] = [
      { kind: "sample", status: "open" },
      { kind: "invite", status: "skipped" },
    ];
    const data = dataOf({ setup: { known: true, steps, done: 1, total: 2 } });
    const { rerender } = draw(data);
    const retire = { retire: { sampleRefused: true } };
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/dashboard/setup", retire)
    );
    // The failure lands, and the header says so.
    await waitFor(() =>
      expect(headerCount()).toHaveTextContent("could not be saved")
    );
    // Drawn again from the same answer: not asked again.
    rerender(tree(data));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(put).toHaveBeenCalledTimes(1);
    // The card's data read again, on a load or a refocus: asked again, and it lands.
    rerender(tree({ ...data }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put).toHaveBeenLastCalledWith("/dashboard/setup", retire);
    // Landed: a later read asks nothing more.
    rerender(tree({ ...data }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(put).toHaveBeenCalledTimes(2);
  });
});
