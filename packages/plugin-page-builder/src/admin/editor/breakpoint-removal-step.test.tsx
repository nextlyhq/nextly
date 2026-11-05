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
import type {
  SiteBreakpointRemovalStatus,
  SiteBreakpointsDryRun,
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
const refetch = vi.fn();
/** Every write the dialog sent, by path and body. */
const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
/** What each kind of write answers; a case replaces them. */
let dryRunAnswer: () => Promise<unknown>;
let confirmAnswer: () => Promise<unknown>;
let carryOnAnswers: Array<() => Promise<unknown>> = [];
/** What the read of a removal's status answers. */
let statusRead: () => Promise<SiteSettingsRead | undefined>;

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: () => ({
    data: siteRead,
    pending: false,
    error: null,
    fetching: false,
    refetch,
  }),
  readPluginRoute: async () => statusRead(),
  writePluginRoute: async (write: {
    path: string;
    body: Record<string, unknown>;
  }) => {
    writes.push({ path: write.path, body: write.body });
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

/** The status read, reporting `removals`. */
function reads(
  removals: SiteBreakpointRemovalStatus[]
): () => Promise<SiteSettingsRead> {
  return async () => ({ ...siteRead, removals });
}

const writer = vi.fn(async () => undefined);
const refresh = vi.fn();
const onOpenChange = vi.fn();

function show(): void {
  render(
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
  statusRead = reads([]);
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
    expect(screen.getByText("This can't be undone.")).toBeTruthy();
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
      await screen.findByText(
        "Mobile was removed, except from 3 pages' live versions"
      )
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
});
