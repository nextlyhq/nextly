// @vitest-environment jsdom
/**
 * Removing a breakpoint in Settings' Site tab, through the real breakpoint
 * editor: the dry run first, the confirmation and its Back, the confirmed
 * save, a removal followed to done or to what it left, a refusal and its
 * Reload, and a removal Settings finds still going when it opens.
 *
 * @module admin/editor/breakpoint-removal-step.test
 */
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PlaceCount,
  RemovedBreakpoint,
} from "../../breakpoint-removal/dry-run";
import type { BreakpointRemoval } from "./use-breakpoint-removal";
import type {
  SiteBreakpointRemovalStatus,
  SiteBreakpointsDryRun,
  SiteBreakpointRemovalsRead,
  SiteCodeRead,
  SiteSettingsRead,
} from "../../library-contract";

const SET = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 1024 },
    { id: "mobile", label: "Mobile", maxWidth: 640 },
  ],
  container: [],
};
const WITHOUT_MOBILE = { viewport: [SET.viewport[0]], container: [] };

let siteRead: SiteSettingsRead;
/** The site's code, with nothing saved: the Site tab shows it beside these. */
const CODE_READ: SiteCodeRead = {
  head: "",
  body: "",
  version: "rev-1",
  policyDeclared: true,
  described: { head: [], body: [] },
  changedAt: null,
  changedBy: null,
};
const refetch = vi.fn();
/** Every write the dialog sent, by path and body. */
const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
/** What each kind of write answers; a case replaces them. */
let dryRunAnswer: () => Promise<unknown>;
let confirmAnswer: () => Promise<unknown>;
let carryOnAnswers: Array<() => Promise<unknown>> = [];
let undoAnswer: () => Promise<unknown>;
/** What the read of a removal's status answers. */
let statusRead: () => Promise<{
  removal: SiteBreakpointRemovalStatus | null;
}>;
/** The paths the status was read at. */
const statusAsked: string[] = [];
/** What the removals read answers when the watch asks it. */
let removalsThere: () => Promise<SiteBreakpointRemovalsRead> = async () =>
  removalsOf(siteRead);

/** The removals read as the tab's read reports them. */
function removalsOf(read: SiteSettingsRead): SiteBreakpointRemovalsRead {
  return { removals: read.removals ?? [], undoable: read.undoable ?? null };
}

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  // Each section of the Site tab reads its own route, so each is answered
  // with its own shape: the code section reads the site's code, not settings.
  usePluginRoute: ({ path }: { path: string }) => ({
    data: path === "/site/code" ? CODE_READ : siteRead,
    pending: false,
    error: null,
    fetching: false,
    refetch,
  }),
  readPluginRoute: async ({ path }: { path: string }) => {
    // The removals alone, asked by the watch for another tab's removal.
    if (path === "/site/breakpoints/removal") return removalsThere();
    statusAsked.push(path);
    return statusRead();
  },
  writePluginRoute: async (write: {
    path: string;
    body: Record<string, unknown>;
  }) => {
    writes.push({ path: write.path, body: write.body });
    if (write.path === "/site/breakpoints/removal/undo") return undoAnswer();
    if (write.path === "/site/breakpoints/removal") {
      const next = carryOnAnswers.shift();
      if (next === undefined) throw new Error("no more carry-on answers");
      return next();
    }
    if (write.body.dryRun === true) return dryRunAnswer();
    if (write.body.confirmRemoval === true) return confirmAnswer();
    return { message: "Saved.", item: { breakpoints: write.body.breakpoints } };
  },
}));

const { SettingsDialog } = await import("./settings-dialog");
const { RemovalStepPanel } = await import("./breakpoint-removal-step");
const { WATCH_MS } = await import("./use-breakpoint-removal");

const none = (): PlaceCount => ({
  documents: 0,
  drafts: 0,
  styles: 0,
  hides: 0,
});

function mobile(
  places: Partial<Record<string, Partial<PlaceCount>>> = {}
): RemovedBreakpoint {
  return {
    id: "mobile",
    label: "Mobile",
    places: Object.fromEntries(
      ["pages", "singles", "components", "patterns", "layouts", "entries"].map(
        place => [place, { ...none(), ...places[place] }]
      )
    ) as RemovedBreakpoint["places"],
    sharedStyles: { classes: 0, styles: 0, locked: [] },
    documents: { named: ["Home"], unnamed: 0 },
    locked: { named: [], unnamed: 0 },
    unaddressable: 0,
  };
}

/** A dry run's envelope, finding `removed` under Mobile. */
function dryRun(removed: RemovedBreakpoint): () => Promise<unknown> {
  const item: SiteBreakpointsDryRun = {
    dryRun: true,
    breakpoints: WITHOUT_MOBILE,
    version: "v7",
    removed: [removed],
    unreadable: 0,
    complete: true,
  };
  return async () => ({ message: "Nothing was saved.", item });
}

const STORED = mobile({ pages: { documents: 14, styles: 30 } });

/** Renders the dialog again with the current read, as a refetch would. */
let reshow: () => void = () => {};

/** A saved answer, with where its removal stands. */
function saved(finished: boolean, left = 0): () => Promise<unknown> {
  return async () => ({
    message: "Saved.",
    item: {
      breakpoints: WITHOUT_MOBILE,
      removal: { runId: "run-1", finished, left },
    },
  });
}

/** The status read of one run: what it still holds, or nothing. */
function reads(
  removals: SiteBreakpointRemovalStatus[]
): () => Promise<{ removal: SiteBreakpointRemovalStatus | null }> {
  return async () => ({ removal: removals[0] ?? null });
}

const writer = vi.fn(async () => undefined);
const refresh = vi.fn();
const onOpenChange = vi.fn();

function show(): void {
  // Built afresh each time, so a re-render asks the dialog again.
  const element = () => (
    <SettingsDialog
      open
      onOpenChange={onOpenChange}
      returnFocus={() => null}
      pageFields={null}
      share={{ title: "Home" }}
      seoFields
      breakpoints={{ value: SET, onSave: writer, status: "ready", refresh }}
    />
  );
  const { rerender } = render(element());
  reshow = () => rerender(element());
}

/** Open the Site tab and remove Mobile in the editor, then Save. */
async function removeMobile(): Promise<void> {
  await userEvent.click(screen.getByRole("tab", { name: "Site" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Edit breakpoints" })
  );
  await userEvent.click(screen.getByRole("button", { name: "Remove Mobile" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Save breakpoints" })
  );
}

/** The removal step on screen, by its state; throws while there is none. */
function stepOf(state: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `[data-breakpoint-removal="${state}"]`
  );
  if (found === null) throw new Error(`no ${state} step`);
  return found;
}

/**
 * Let the reads a timer started answer. A real timeout: `waitFor` polls with
 * the `setInterval` a test of the watch has faked.
 */
const settled = () => new Promise(resolve => setTimeout(resolve, 20));

/** The writes of one kind. */
const sent = (kind: "dryRun" | "confirmRemoval") =>
  writes.filter(write => write.body[kind] === true);

beforeEach(() => {
  siteRead = {
    mayManageSite: true,
    mayChooseDefaultLayout: true,
    defaultLayout: null,
    breakpoints: SET,
    layouts: [],
    removals: [],
  };
  writes.length = 0;
  dryRunAnswer = dryRun(STORED);
  confirmAnswer = saved(true);
  carryOnAnswers = [];
  undoAnswer = async () => {
    throw new Error("no undo answer");
  };
  statusRead = reads([]);
  statusAsked.length = 0;
  removalsThere = async () => removalsOf(siteRead);
  refetch.mockClear();
  writer.mockClear();
  refresh.mockClear();
  onOpenChange.mockClear();
});
afterEach(cleanup);

describe("removing a breakpoint in Settings", () => {
  it("checks first, then asks, and Back returns to the draft as it was", async () => {
    let answer: (value: unknown) => void = () => {};
    dryRunAnswer = () => new Promise(resolve => (answer = resolve));
    show();
    await removeMobile();
    // Checking: the dropped row struck through, Save held, Cancel live.
    expect(
      await screen.findByText("Checking what uses Mobile before saving…")
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Save breakpoints", hidden: false })
    ).toHaveProperty("disabled", true);
    expect(sent("dryRun")[0]?.body).toEqual({
      breakpoints: WITHOUT_MOBILE,
      dryRun: true,
    });

    answer(await dryRun(STORED)());
    expect(
      await screen.findByRole("heading", {
        name: "Remove Mobile and the styles set for it?",
      })
    ).toBeTruthy();
    expect(
      screen.getByText("You can undo this from Settings for 30 days.")
    ).toBeTruthy();
    // Focus followed the step, rather than falling back to the page.
    expect(stepOf("confirm").parentElement).toBe(document.activeElement);
    // The step has the tab to itself.
    expect(screen.queryByText("Default Layout")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    // The editor again, Mobile still removed in the draft, nothing saved.
    expect(
      screen.getByRole("button", { name: "Save breakpoints" })
    ).toHaveProperty("disabled", false);
    expect(screen.queryByRole("button", { name: "Remove Mobile" })).toBeNull();
    expect(sent("confirmRemoval")).toEqual([]);
    expect(writer).not.toHaveBeenCalled();
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("removes with the dry run's version, then says what went", async () => {
    show();
    await removeMobile();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Remove Mobile and its styles",
      })
    );
    const status = await screen.findByText("Mobile was removed");
    expect(status).toBeTruthy();
    expect(screen.getByText("Its styles are gone from 14 pages.")).toBeTruthy();
    expect(sent("confirmRemoval")[0]?.body).toEqual({
      breakpoints: WITHOUT_MOBILE,
      confirmRemoval: true,
      version: "v7",
    });
    // Not through the ordinary writer, which records an undo step.
    expect(writer).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(refetch).toHaveBeenCalled();
    // The list and the rest of the tab are back.
    expect(
      screen.getByRole("button", { name: "Edit breakpoints" })
    ).toBeTruthy();
    expect(screen.getByText("Default Layout")).toBeTruthy();
  });

  it("follows a removal its save did not finish, and says what it left", async () => {
    confirmAnswer = saved(false);
    let carried: (value: unknown) => void = () => {};
    carryOnAnswers = [() => new Promise(resolve => (carried = resolve))];
    statusRead = reads([
      {
        runId: "run-1",
        labels: ["Mobile"],
        open: false,
        left: 3,
        waitingOnDrafts: true,
      },
    ]);
    show();
    await removeMobile();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Remove Mobile and its styles",
      })
    );
    expect(
      await screen.findByRole("heading", { name: "Removing Mobile's styles" })
    ).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
    await waitFor(() =>
      expect(
        writes.filter(write => write.path === "/site/breakpoints/removal")
      ).toEqual([
        { path: "/site/breakpoints/removal", body: { runId: "run-1" } },
      ])
    );
    carried({
      message: "Done.",
      item: { runId: "run-1", finished: true, left: 1 },
    });
    // The run's own record says three, not the last call's one.
    expect(
      await screen.findByText("Mobile was removed, except from 3 live versions")
    ).toBeTruthy();
  });

  it("closes Settings from the removing step, which carries on without it", async () => {
    confirmAnswer = saved(false);
    carryOnAnswers = [() => new Promise(() => {})];
    show();
    await removeMobile();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Remove Mobile and its styles",
      })
    );
    const step = await waitFor(() => stepOf("removing"));
    await userEvent.click(within(step).getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("saves straight on when nothing is stored under the breakpoint", async () => {
    dryRunAnswer = dryRun({
      ...mobile(),
      documents: { named: [], unnamed: 0 },
    });
    show();
    await removeMobile();
    expect(await screen.findByText("Mobile was removed")).toBeTruthy();
    expect(screen.getByText("Nothing was styled for it.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Remove Mobile/ })).toBeNull();
    expect(sent("confirmRemoval")).toHaveLength(1);
  });

  it("saves through the ordinary writer when the site drops nothing after all", async () => {
    dryRunAnswer = async () => ({
      message: "Nothing was saved.",
      item: {
        dryRun: true,
        breakpoints: WITHOUT_MOBILE,
        removed: [],
        unreadable: 0,
        complete: true,
      },
    });
    show();
    await removeMobile();
    await waitFor(() => expect(writer).toHaveBeenCalledWith(WITHOUT_MOBILE));
    expect(sent("confirmRemoval")).toEqual([]);
    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  it("shows a refusal in the server's words; Reload starts again from the stored set", async () => {
    confirmAnswer = async () => {
      throw new Error(
        "The site's breakpoints changed after you checked what removing them drops. Check again before removing them."
      );
    };
    show();
    await removeMobile();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Remove Mobile and its styles",
      })
    );
    const refusal = await waitFor(() => stepOf("refused"));
    expect(within(refusal).getByRole("alert").textContent).toContain(
      "Nothing was removed"
    );
    expect(refusal.textContent).toContain("Check again before removing them.");
    refetch.mockClear();
    await userEvent.click(
      screen.getByRole("button", { name: "Reload breakpoints" })
    );
    // The list, read again; no draft left to save.
    expect(
      screen.getByRole("button", { name: "Edit breakpoints" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Save breakpoints" })
    ).toBeNull();
    expect(refetch).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("goes back to the draft from a refusal, with its reason beside it", async () => {
    dryRunAnswer = async () => {
      throw new Error("Another breakpoint removal is still running.");
    };
    show();
    await removeMobile();
    const refusal = await waitFor(() => stepOf("refused"));
    await userEvent.click(
      within(refusal).getByRole("button", { name: "Cancel" })
    );
    expect(
      screen.getByText("Another breakpoint removal is still running.")
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Save breakpoints" })
    ).toBeTruthy();
  });

  it("says a removal Settings finds going, holds Edit, and follows it to done", async () => {
    siteRead = {
      ...siteRead,
      breakpoints: WITHOUT_MOBILE,
      removals: [
        {
          runId: "run-9",
          labels: ["Mobile"],
          open: true,
          left: 0,
          waitingOnDrafts: false,
        },
      ],
    };
    let carried: (value: unknown) => void = () => {};
    carryOnAnswers = [() => new Promise(resolve => (carried = resolve))];
    statusRead = reads([]);
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    expect(
      screen.getByText("Mobile's styles are still being removed")
    ).toBeTruthy();
    const edit = screen.getByRole("button", { name: "Edit breakpoints" });
    expect(edit).toHaveProperty("disabled", true);
    expect(edit.getAttribute("title")).toBe(
      "Breakpoints can be changed again once it has finished."
    );
    await waitFor(() =>
      expect(writes).toEqual([
        { path: "/site/breakpoints/removal", body: { runId: "run-9" } },
      ])
    );
    carried({
      message: "Done.",
      item: { runId: "run-9", finished: true, left: 0 },
    });
    expect(await screen.findByText("Mobile was removed")).toBeTruthy();
    expect(screen.getByText("Its styles are gone from the site.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Edit breakpoints" })
    ).toHaveProperty("disabled", false);
  });

  it("says what a finished removal left, when Settings opens, without holding Edit", async () => {
    siteRead = {
      ...siteRead,
      removals: [
        {
          runId: "run-2",
          labels: ["Phone"],
          open: false,
          left: 2,
          waitingOnDrafts: false,
        },
      ],
    };
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    expect(
      screen.getByText(
        "Phone was removed, except from 2 entries it couldn't change"
      )
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Edit breakpoints" })
    ).toHaveProperty("disabled", false);
    expect(writes).toEqual([]);
  });

  it("lets a confirmation be left, asking first, as a draft is", async () => {
    show();
    await removeMobile();
    await screen.findByRole("button", { name: "Remove Mobile and its styles" });
    await userEvent.keyboard("{Escape}");
    const ask = await screen.findByRole("alertdialog");
    expect(ask.textContent).toContain("Discard your breakpoint changes?");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(sent("confirmRemoval")).toEqual([]);
  });

  it("saves a set that drops nothing as it always has, with no dry run", async () => {
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Edit breakpoints" })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save breakpoints" })
    );
    await waitFor(() => expect(writer).toHaveBeenCalledWith(SET));
    expect(writes).toEqual([]);
  });

  it("reads the finished run's own status, past any cap on the tab's list", async () => {
    confirmAnswer = saved(true, 2);
    statusRead = reads([
      {
        runId: "run-1",
        labels: ["Mobile"],
        open: false,
        left: 2,
        waitingOnDrafts: false,
      },
    ]);
    show();
    await removeMobile();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Remove Mobile and its styles",
      })
    );
    expect(
      await screen.findByText(
        "Mobile was removed, except from 2 entries it couldn't change"
      )
    ).toBeTruthy();
    expect(statusAsked).toEqual(["/site/breakpoints/removal?runId=run-1"]);
  });

  it("reads the status again, never saying done or carrying on, while the run's status can't be read", async () => {
    confirmAnswer = saved(true, 0);
    let failing = true;
    statusRead = async () => {
      if (failing) throw new Error("offline");
      return {
        removal: {
          runId: "run-1",
          labels: ["Mobile"],
          open: false,
          left: 1,
          waitingOnDrafts: false,
        },
      };
    };
    show();
    await removeMobile();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Remove Mobile and its styles",
      })
    );
    // The save said finished; the status could not be read, so it is not
    // called done.
    expect(
      await screen.findByRole(
        "heading",
        { name: "Removing Mobile's styles" },
        { timeout: 8000 }
      )
    ).toBeTruthy();
    expect(screen.queryByText("Mobile was removed")).toBeNull();
    failing = false;
    // The run's own status decides once it can be read: it left one.
    expect(
      await screen.findByText(
        "Mobile was removed, except from 1 entry it couldn't change",
        undefined,
        { timeout: 12_000 }
      )
    ).toBeTruthy();
    // Only the status was read again: the route was not called on.
    expect(
      writes.filter(write => write.path === "/site/breakpoints/removal")
    ).toEqual([]);
  }, 25_000);

  it("follows a run its status finds opened again until it is done", async () => {
    // The save did not finish: the tab's own loop carries it on.
    confirmAnswer = saved(false);
    const statuses = [
      {
        runId: "run-1",
        labels: ["Mobile"],
        open: true,
        left: 0,
        waitingOnDrafts: false,
      },
      null,
    ];
    statusRead = async () => ({ removal: statuses.shift() ?? null });
    const finished = async () => ({
      message: "Done.",
      item: { runId: "run-1", finished: true, left: 0 },
    });
    carryOnAnswers = [finished, finished];
    show();
    await removeMobile();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Remove Mobile and its styles",
      })
    );
    expect(
      await screen.findByText("Mobile was removed", {}, { timeout: 5000 })
    ).toBeTruthy();
    // Called again after the first call's status found the run open again.
    expect(
      writes.filter(write => write.path === "/site/breakpoints/removal")
    ).toHaveLength(2);
  }, 10_000);

  it("cannot cancel a removal it found nothing stored for once its save is out", async () => {
    dryRunAnswer = dryRun({
      ...mobile(),
      documents: { named: [], unnamed: 0 },
    });
    confirmAnswer = () => new Promise(() => {});
    show();
    await removeMobile();
    await waitFor(() => expect(sent("confirmRemoval")).toHaveLength(1));
    const cancel = within(stepOf("checking")).getByRole("button", {
      name: "Cancel",
    });
    expect(cancel).toHaveProperty("disabled", true);
  });

  it("looks for a removal another tab started while Settings stays open", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      show();
      await userEvent.click(screen.getByRole("tab", { name: "Site" }));
      refetch.mockClear();
      // Nothing new: the read is not asked again.
      vi.advanceTimersByTime(WATCH_MS);
      await settled();
      expect(refetch).not.toHaveBeenCalled();
      // Another tab opens a removal.
      removalsThere = async () => ({
        undoable: null,
        removals: [
          {
            runId: "run-5",
            labels: ["Mobile"],
            open: true,
            left: 0,
            waitingOnDrafts: false,
          },
        ],
      });
      vi.advanceTimersByTime(WATCH_MS);
      await settled();
      expect(refetch).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a removal opened elsewhere outrank this tab's finished one", async () => {
    show();
    await removeMobile();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Remove Mobile and its styles",
      })
    );
    await screen.findByText("Mobile was removed");
    carryOnAnswers = [() => new Promise(() => {})];
    // Another tab opens a removal of its own.
    siteRead = {
      ...siteRead,
      removals: [
        {
          runId: "run-7",
          labels: ["Phone"],
          open: true,
          left: 0,
          waitingOnDrafts: false,
        },
      ],
    };
    reshow();
    expect(
      screen.getByText("Phone's styles are still being removed")
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Edit breakpoints" })
    ).toHaveProperty("disabled", true);
  });

  it("follows its own run again only once a newer read reports it opened again", async () => {
    const ownOpen = (): SiteBreakpointRemovalStatus[] => [
      {
        runId: "run-1",
        labels: ["Mobile"],
        open: true,
        left: 0,
        waitingOnDrafts: false,
      },
    ];
    confirmAnswer = saved(false);
    let carried: (value: unknown) => void = () => {};
    carryOnAnswers = [
      () => new Promise(resolve => (carried = resolve)),
      () => new Promise(() => {}),
    ];
    show();
    await removeMobile();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Remove Mobile and its styles",
      })
    );
    await screen.findByRole("heading", { name: "Removing Mobile's styles" });
    // The tab's read while it removes reports the run open.
    siteRead = { ...siteRead, removals: ownOpen() };
    reshow();
    carried({
      message: "Done.",
      item: { runId: "run-1", finished: true, left: 0 },
    });
    await screen.findByText("Mobile was removed");
    // That read, from before the run ended, is not followed again.
    reshow();
    expect(screen.getByText("Mobile was removed")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Edit breakpoints" })
    ).toHaveProperty("disabled", false);
    // A newer read reports it open again: a write brought values back.
    siteRead = { ...siteRead, removals: ownOpen() };
    reshow();
    expect(
      screen.getByText("Mobile's styles are still being removed")
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Edit breakpoints" })
    ).toHaveProperty("disabled", true);
  });

  it("checks an unbounded container width as a row of its own", () => {
    const current = {
      viewport: SET.viewport,
      container: [{ id: "card", label: "Card" }],
    };
    render(
      <RemovalStepPanel
        removal={
          {
            step: { kind: "checking", next: SET, labels: ["Card"] },
            back: vi.fn(),
          } as unknown as BreakpointRemoval
        }
        current={current}
        baseLabel="Desktop"
        onClose={vi.fn()}
      />
    );
    const card = screen.getByText("Card").closest("li");
    expect(card?.textContent).toContain("every width");
    expect(card?.className).toContain("line-through");
  });
});

describe("undoing a breakpoint removal in Settings", () => {
  /** The removal the read offers to undo. */
  const OFFERED = {
    runId: "run-1",
    ids: ["mobile"],
    labels: ["Mobile"],
    removedAt: "2026-11-06T09:00:00.000Z",
    until: "2026-12-06T09:00:00.000Z",
  };

  /** The undo's answer: finished or not, with what it could not put back. */
  function undone(
    finished: boolean,
    skipped: readonly Record<string, unknown>[] = []
  ): () => Promise<unknown> {
    return async () => ({
      message: "Undone.",
      item: {
        breakpoints: SET,
        removal: {
          runId: "undo-1",
          finished,
          left: 0,
          undo: { undoes: "run-1", ...(finished ? { skipped } : {}) },
        },
      },
    });
  }

  /** Open the Site tab, press Undo on the offered removal, and confirm. */
  async function undoMobile(): Promise<void> {
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(
      await screen.findByRole("heading", { name: "Put Mobile back?" })
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Put Mobile back" })
    );
  }

  it("offers the removal on reopening, asks first, and puts it back", async () => {
    siteRead = { ...siteRead, undoable: OFFERED };
    undoAnswer = undone(true);
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    // Offered with when it was made and until when it can be undone.
    expect(
      screen.getByText(/You can undo this until 6 December\./)
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    // Back leaves it as it was, undoing nothing.
    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    expect(writes).toEqual([]);
    await undoMobile();
    expect(
      await screen.findByText("Mobile is back, with its styles")
    ).toBeTruthy();
    expect(writes).toEqual([
      { path: "/site/breakpoints/removal/undo", body: { runId: "run-1" } },
    ]);
    // The list says which breakpoint came back, for this visit.
    expect(screen.getByText("put back")).toBeTruthy();
  });

  it("lists each page it could not put everything back into, and why", async () => {
    siteRead = { ...siteRead, undoable: OFFERED };
    undoAnswer = undone(true, [
      {
        kind: "collection",
        slug: "pages",
        id: "p-pricing",
        name: "Pricing",
        values: 2,
        reason: "changed",
      },
      {
        kind: "collection",
        slug: "pages",
        id: "p-careers",
        name: "Careers",
        values: 1,
        reason: "block-deleted",
      },
      {
        kind: "collection",
        slug: "pages",
        id: "p-old",
        values: 2,
        reason: "gone",
      },
    ]);
    show();
    await undoMobile();
    expect(
      await screen.findByText(
        "Mobile is back, except 5 values that changed after the removal"
      )
    ).toBeTruthy();
    expect(
      screen.getByText("2 values set again for Mobile after the removal")
    ).toBeTruthy();
    expect(
      screen.getByText("1 value was on a block deleted after the removal")
    ).toBeTruthy();
    expect(
      screen.getByText("2 values were on this page, deleted after the removal")
    ).toBeTruthy();
    // A page that still exists links to it; a deleted one is plain words.
    expect(
      screen.getByRole("link", { name: "Pricing" }).getAttribute("href")
    ).toBe("/admin/collections/pages/p-pricing");
    expect(screen.queryByRole("link", { name: "A deleted page" })).toBeNull();
    expect(screen.getByText("A deleted page")).toBeTruthy();
  });

  it("follows an undo its request did not finish to the end", async () => {
    siteRead = { ...siteRead, undoable: OFFERED };
    undoAnswer = undone(false);
    carryOnAnswers = [
      async () => ({
        message: "Done.",
        item: {
          runId: "undo-1",
          finished: true,
          left: 0,
          undo: { undoes: "run-1", skipped: [] },
        },
      }),
    ];
    show();
    await undoMobile();
    expect(
      await screen.findByText("Mobile is back, with its styles", undefined, {
        timeout: 8000,
      })
    ).toBeTruthy();
    expect(carryOnAnswers).toHaveLength(0);
  });

  it("says a refused undo in the server's words, and that nothing changed", async () => {
    siteRead = { ...siteRead, undoable: OFFERED };
    undoAnswer = async () => {
      throw new Error("This removal can't be undone: it was undone already.");
    };
    show();
    await undoMobile();
    expect(
      await screen.findByRole("heading", { name: "Mobile can't be put back" })
    ).toBeTruthy();
    expect(
      screen.getByText(
        "This removal can't be undone: it was undone already. Nothing was changed."
      )
    ).toBeTruthy(); // Not the breakpoints: reading Settings again is the way on.
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Edit breakpoints" })
    ).toBeNull();
  });

  it("offers editing the breakpoints when they no longer fit, opening the editor", async () => {
    siteRead = { ...siteRead, undoable: OFFERED };
    undoAnswer = async () => {
      throw Object.assign(
        new Error(
          "“Mobile” would end at the same width as “Phone”, so this removal can't be undone. Change or remove “Phone” first."
        ),
        { code: "BREAKPOINT_UNDO_DOES_NOT_FIT" }
      );
    };
    show();
    await undoMobile();
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit breakpoints" })
    );
    // The editor is open on the set, in one click.
    expect(
      await screen.findByRole("button", { name: "Save breakpoints" })
    ).toBeTruthy();
  });

  it("says an undo that left pages under drafts is not all back yet", async () => {
    siteRead = { ...siteRead, undoable: OFFERED };
    undoAnswer = async () => ({
      message: "Undone.",
      item: {
        breakpoints: SET,
        removal: {
          runId: "undo-1",
          finished: true,
          left: 1,
          undo: { undoes: "run-1", skipped: [] },
        },
      },
    });
    // The run's own status, read when it ends: one live page left.
    statusRead = reads([
      {
        runId: "undo-1",
        undoes: "run-1",
        labels: ["Mobile"],
        open: false,
        left: 1,
        waitingOnDrafts: true,
      },
    ]);
    show();
    await undoMobile();
    expect(
      await screen.findByText("Mobile is back, except on 1 live version")
    ).toBeTruthy();
    expect(
      screen.getByText(
        "It has a draft waiting to be published, and gets Mobile's styles back once that draft is published or discarded."
      )
    ).toBeTruthy();
    expect(screen.queryByText("Mobile is back, with its styles")).toBeNull();
    expect(statusAsked).toHaveLength(1);
  });

  it("reads the final report once the pages it left are written", async () => {
    siteRead = { ...siteRead, undoable: OFFERED };
    undoAnswer = async () => ({
      message: "Undone.",
      item: {
        breakpoints: SET,
        removal: {
          runId: "undo-1",
          finished: true,
          left: 1,
          undo: { undoes: "run-1", skipped: [] },
        },
      },
    });
    statusRead = reads([
      {
        runId: "undo-1",
        undoes: "run-1",
        labels: ["Mobile"],
        open: false,
        left: 1,
        waitingOnDrafts: true,
      },
    ]);
    show();
    await undoMobile();
    expect(
      await screen.findByText("Mobile is back, except on 1 live version")
    ).toBeTruthy();
    // The draft is published; a later retry wrote the page, skipping a
    // value set meanwhile. The read no longer reports the run.
    carryOnAnswers = [
      async () => ({
        message: "Done.",
        item: {
          runId: "undo-1",
          finished: true,
          left: 0,
          undo: {
            undoes: "run-1",
            skipped: [
              {
                kind: "collection",
                slug: "pages",
                id: "p-pricing",
                name: "Pricing",
                values: 1,
                reason: "changed",
              },
            ],
          },
        },
      }),
    ];
    siteRead = { ...siteRead, removals: [] };
    reshow();
    expect(
      await screen.findByText(
        "Mobile is back, except 1 value that changed after the removal"
      )
    ).toBeTruthy();
    expect(screen.queryByText("Mobile is back, with its styles")).toBeNull();
    expect(carryOnAnswers).toHaveLength(0);
  });

  it("says an undo that left pages on reopening Settings", async () => {
    siteRead = {
      ...siteRead,
      undoable: null,
      removals: [
        {
          runId: "undo-1",
          undoes: "run-1",
          labels: ["Mobile"],
          open: false,
          left: 2,
          waitingOnDrafts: true,
        },
      ],
    };
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    expect(
      await screen.findByText("Mobile is back, except on 2 live versions")
    ).toBeTruthy();
  });

  it("gives a finished undo's row up to a newer removal on offer", async () => {
    siteRead = { ...siteRead, undoable: OFFERED };
    undoAnswer = undone(true);
    show();
    await undoMobile();
    expect(
      await screen.findByText("Mobile is back, with its styles")
    ).toBeTruthy();
    // Another tab removes Tablet; the read offers that removal now.
    siteRead = {
      ...siteRead,
      undoable: {
        runId: "run-2",
        ids: ["tablet"],
        labels: ["Tablet"],
        removedAt: "2026-11-06T10:00:00.000Z",
        until: "2026-12-06T10:00:00.000Z",
      },
    };
    reshow();
    expect(
      await screen.findByText("Tablet was removed on 6 November")
    ).toBeTruthy();
    expect(screen.queryByText("Mobile is back, with its styles")).toBeNull();
  });

  it("shows no removal row beside the undo of that removal", async () => {
    dryRunAnswer = dryRun({
      ...mobile(),
      documents: { named: [], unnamed: 0 },
    });
    show();
    await removeMobile();
    expect(await screen.findByText("Mobile was removed")).toBeTruthy();
    // The read now offers that removal, on its own row.
    siteRead = { ...siteRead, undoable: OFFERED };
    undoAnswer = undone(true);
    reshow();
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Put Mobile back" })
    );
    expect(
      await screen.findByText("Mobile is back, with its styles")
    ).toBeTruthy();
    expect(screen.queryByText("Mobile was removed")).toBeNull();
  });

  it("says an undo Settings finds going, and holds Edit while it lasts", async () => {
    siteRead = {
      ...siteRead,
      undoable: null,
      removals: [
        {
          runId: "undo-1",
          undoes: "run-1",
          labels: ["Mobile"],
          open: true,
          left: 0,
          waitingOnDrafts: false,
        },
      ],
    };
    carryOnAnswers = [() => new Promise(() => undefined)];
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    expect(
      await screen.findByText("Mobile's styles are still being put back")
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Edit breakpoints",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    // Not taken for a removal going.
    expect(
      screen.queryByText("Mobile's styles are still being removed")
    ).toBeNull();
  });
});
