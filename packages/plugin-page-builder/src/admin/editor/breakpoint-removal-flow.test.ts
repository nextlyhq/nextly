/**
 * What Settings says while a breakpoint is removed: which breakpoints a save
 * drops, when it asks before saving, and every sentence of each step.
 *
 * @module admin/editor/breakpoint-removal-flow.test
 */
import { describe, expect, it } from "vitest";

import type {
  PlaceCount,
  RemovalPlace,
  RemovedBreakpoint,
} from "../../breakpoint-removal/dry-run";
import type { SiteBreakpointsDryRun } from "../../library-contract";

import {
  confirmWords,
  doneWords,
  droppedIds,
  joinNames,
  leftWords,
  nothingStored,
  removingWords,
  resumedWords,
} from "./breakpoint-removal-flow";

const NOW = {
  viewport: [
    { id: "desktop", label: "Desktop" },
    { id: "tablet", label: "Tablet", maxWidth: 1024 },
    { id: "mobile", label: "Mobile", maxWidth: 640 },
  ],
  container: [{ id: "card", label: "Card", maxWidth: 480 }],
};
const WITHOUT_MOBILE = {
  viewport: NOW.viewport.filter(def => def.id !== "mobile"),
  container: NOW.container,
};

const none = (): PlaceCount => ({
  documents: 0,
  drafts: 0,
  styles: 0,
  hides: 0,
});

/** A removed breakpoint holding nothing, with `over` laid on it. */
function removed(
  over: Partial<Omit<RemovedBreakpoint, "places">> & {
    places?: Partial<Record<RemovalPlace, Partial<PlaceCount>>>;
  } = {}
): RemovedBreakpoint {
  const places = Object.fromEntries(
    (
      [
        "pages",
        "singles",
        "components",
        "patterns",
        "layouts",
        "entries",
      ] as const
    ).map(place => [place, { ...none(), ...over.places?.[place] }])
  ) as Record<RemovalPlace, PlaceCount>;
  return {
    id: "mobile",
    label: "Mobile",
    sharedStyles: { classes: 0, styles: 0, locked: [] },
    documents: { named: [], unnamed: 0 },
    locked: { named: [], unnamed: 0 },
    unaddressable: 0,
    ...over,
    places,
  };
}

function dryRun(
  breakpoints: RemovedBreakpoint[],
  over: Partial<SiteBreakpointsDryRun> = {}
): SiteBreakpointsDryRun {
  return {
    dryRun: true,
    breakpoints: WITHOUT_MOBILE,
    version: "v1",
    removed: breakpoints,
    unreadable: 0,
    complete: true,
    ...over,
  };
}

/** The prototype's site: what removing Mobile drops. */
const PROTOTYPE = removed({
  places: {
    pages: { documents: 14, drafts: 3, styles: 30, hides: 6 },
    components: { documents: 2, styles: 3 },
    patterns: { documents: 1, styles: 1 },
  },
  sharedStyles: { classes: 4, styles: 4, locked: [] },
  documents: {
    named: ["Home", "Pricing", "About us", "Contact", "Blog", "Careers"],
    unnamed: 11,
  },
  locked: { named: ["Home", "Pricing"], unnamed: 0 },
});

describe("what a save drops", () => {
  it("names the breakpoints the new set no longer defines, on either axis", () => {
    expect(droppedIds(NOW, WITHOUT_MOBILE)).toEqual(["mobile"]);
    expect(droppedIds(NOW, { viewport: NOW.viewport, container: [] })).toEqual([
      "card",
    ]);
    expect(droppedIds(NOW, NOW)).toEqual([]);
    // A width changed is not a breakpoint dropped.
    expect(
      droppedIds(NOW, {
        ...NOW,
        viewport: NOW.viewport.map(def =>
          def.id === "mobile" ? { ...def, maxWidth: 600 } : def
        ),
      })
    ).toEqual([]);
  });
});

describe("when the save goes ahead without asking", () => {
  it("only when nothing at all is stored under what it drops", () => {
    expect(nothingStored(dryRun([removed()]))).toBe(true);
  });

  it("asks wherever there is doubt or something stored", () => {
    for (const case_ of [
      dryRun([removed({ places: { pages: { documents: 1 } } })]),
      dryRun([removed({ places: { entries: { documents: 1 } } })]),
      dryRun([
        removed({ sharedStyles: { classes: 1, styles: 1, locked: [] } }),
      ]),
      dryRun([removed({ unaddressable: 1 })]),
      dryRun([removed()], { unreadable: 1 }),
      dryRun([removed()], { complete: false }),
      dryRun([
        removed(),
        removed({ id: "phone", places: { layouts: { documents: 1 } } }),
      ]),
    ]) {
      expect(nothingStored(case_)).toBe(false);
    }
  });
});

describe("the confirm step's words", () => {
  it("says what the prototype says for Mobile", () => {
    const words = confirmWords(
      dryRun([PROTOTYPE]),
      NOW,
      WITHOUT_MOBILE,
      "Desktop"
    );
    expect(words.title).toBe("Remove Mobile and the styles set for it?");
    expect(words.intro).toBe(
      "Everything set for Mobile is deleted from the whole site, so the pages show their Tablet styles at that width. If you add a Mobile breakpoint again later, it starts empty."
    );
    const [summary] = words.removed;
    expect(summary?.rows).toEqual([
      { label: "Pages", count: 14, drafts: 3 },
      { label: "Components", count: 2 },
      { label: "Patterns", count: 1 },
      { label: "Shared styles", count: 4 },
    ]);
    expect(summary?.totals).toBe(
      "38 style values and 6 hidden blocks in all, on Home, Pricing, About us, Contact and 13 more."
    );
    expect(summary?.notes).toEqual([
      {
        lead: "Locked blocks change too.",
        rest: "Their Mobile styles are removed in Home and Pricing. Nothing else about them changes.",
      },
      {
        lead: "3 pages have drafts waiting to be published.",
        rest: "Their drafts are updated now; each live version keeps Mobile's styles until its draft is published or discarded.",
      },
    ]);
    expect(words.notes).toEqual([]);
    expect(words.undo).toBe("This can't be undone.");
    expect(words.confirm).toBe("Remove Mobile and its styles");
  });

  it("lists singles, Layouts and other entries only where they hold some", () => {
    const words = confirmWords(
      dryRun([
        removed({
          places: { singles: { documents: 1 }, entries: { documents: 2 } },
        }),
      ]),
      NOW,
      WITHOUT_MOBILE,
      "Desktop"
    );
    expect(words.removed[0]?.rows.map(row => row.label)).toEqual([
      "Pages",
      "Singles",
      "Components",
      "Patterns",
      "Other entries",
      "Shared styles",
    ]);
  });

  it("falls back to the base on the widest breakpoint, and says nothing of a width on a container", () => {
    const tabletGone = {
      viewport: NOW.viewport.filter(def => def.id !== "tablet"),
      container: NOW.container,
    };
    expect(
      confirmWords(
        dryRun([removed({ id: "tablet", label: "Tablet" })]),
        NOW,
        tabletGone,
        "Desktop"
      ).intro
    ).toContain("show their Desktop styles at that width");
    expect(
      confirmWords(
        dryRun([removed({ id: "card", label: "Card" })]),
        NOW,
        { viewport: NOW.viewport, container: [] },
        "Desktop"
      ).intro
    ).toContain("show their base styles at that width");
  });

  it("counts a container width with no bound as the widest", () => {
    const withWide = {
      viewport: NOW.viewport,
      container: [
        { id: "card", label: "Card", maxWidth: 480 },
        { id: "wide", label: "Wide" },
      ],
    };
    // Card's next wider is the unbounded one, which covers every width.
    expect(
      confirmWords(
        dryRun([removed({ id: "card", label: "Card" })]),
        withWide,
        { viewport: NOW.viewport, container: [{ id: "wide", label: "Wide" }] },
        "Desktop"
      ).intro
    ).toContain("show their Wide styles at that width");
    // Nothing is wider than the unbounded one: the base, not Card.
    expect(
      confirmWords(
        dryRun([removed({ id: "wide", label: "Wide" })]),
        withWide,
        {
          viewport: NOW.viewport,
          container: [{ id: "card", label: "Card", maxWidth: 480 }],
        },
        "Desktop"
      ).intro
    ).toContain("show their base styles at that width");
  });

  it("speaks of them, plural, for several breakpoints", () => {
    const words = confirmWords(
      dryRun([removed(), removed({ id: "card", label: "Card" })]),
      NOW,
      { viewport: WITHOUT_MOBILE.viewport, container: [] },
      "Desktop"
    );
    expect(words.title).toBe(
      "Remove Mobile and Card and the styles set for them?"
    );
    expect(words.confirm).toBe("Remove Mobile and Card and their styles");
    expect(words.intro).toContain(
      "If you add them again later, they start empty."
    );
    expect(words.removed.map(summary => summary.label)).toEqual([
      "Mobile",
      "Card",
    ]);
  });

  it("notes every doubt, each only where it applies", () => {
    const words = confirmWords(
      dryRun(
        [
          removed({
            places: {
              pages: { documents: 1, drafts: 1, styles: 1 },
              components: { documents: 1, drafts: 1, styles: 1 },
            },
            unaddressable: 2,
            locked: { named: [], unnamed: 1 },
            sharedStyles: { classes: 1, styles: 1, locked: ["Brand button"] },
          }),
        ],
        { unreadable: 1, complete: false }
      ),
      NOW,
      WITHOUT_MOBILE,
      "Desktop"
    );
    expect(words.removed[0]?.notes.map(note => note.lead)).toEqual([
      "Locked blocks change too.",
      "Locked shared styles change too.",
      // A component's draft among them: entries, not pages.
      "2 entries have drafts waiting to be published.",
      "2 entries keep some of Mobile's styles.",
    ]);
    expect(words.removed[0]?.notes[0]?.rest).toBe(
      "Their Mobile styles are removed in 1 entry you can't open. Nothing else about them changes."
    );
    expect(words.removed[0]?.notes[1]?.rest).toBe(
      "Brand button loses its Mobile styles. Nothing else about it changes."
    );
    expect(words.notes).toEqual([
      {
        lead: "Counted as much as time allowed.",
        rest: "The removal still covers every page.",
      },
      { lead: "1 entry couldn't be read", rest: "and isn't counted." },
    ]);
  });

  it("names no documents where it may name none, and counts nothing when nothing is held", () => {
    const words = confirmWords(
      dryRun([
        removed({
          places: { pages: { documents: 2, styles: 1 } },
          documents: { named: [], unnamed: 2 },
        }),
      ]),
      NOW,
      WITHOUT_MOBILE,
      "Desktop"
    );
    expect(words.removed[0]?.totals).toBe("1 style value in all.");
    expect(
      confirmWords(
        dryRun([removed({ unaddressable: 1 })]),
        NOW,
        WITHOUT_MOBILE,
        "Desktop"
      ).removed[0]?.totals
    ).toBeNull();
  });
});

describe("the other steps' words", () => {
  it("says what the removal took, from the dry run", () => {
    expect(doneWords(["Mobile"], [PROTOTYPE])).toEqual({
      title: "Mobile was removed",
      hint: "Its styles are gone from 14 pages, 2 components, 1 pattern and 4 shared styles.",
    });
    expect(doneWords(["Mobile"], [removed()]).hint).toBe(
      "Nothing was styled for it."
    );
    // Followed after Settings opened again: no count to quote.
    expect(doneWords(["Mobile"], undefined).hint).toBe(
      "Its styles are gone from the site."
    );
    expect(doneWords(["Mobile", "Card"], [PROTOTYPE, PROTOTYPE])).toEqual({
      title: "Mobile and Card were removed",
      hint: "Their styles are gone from the site.",
    });
  });

  it("says what a removal left, and why it waits", () => {
    expect(
      leftWords({ labels: ["Mobile"], left: 3, waitingOnDrafts: true })
    ).toEqual({
      title: "Mobile was removed, except from 3 live versions",
      hint: "Each has a draft waiting to be published, and keeps Mobile's styles until that draft is published or discarded; Mobile can't be added back until then.",
    });
    expect(
      leftWords({ labels: ["Mobile"], left: 1, waitingOnDrafts: false })
    ).toEqual({
      title: "Mobile was removed, except from 1 entry it couldn't change",
      hint: "It keeps Mobile's styles for now, and Mobile can't be added back until it is changed.",
    });
  });

  it("says a removal is going, and what holds the breakpoints meanwhile", () => {
    expect(removingWords(["Mobile"])).toEqual({
      title: "Removing Mobile's styles",
      body: "Mobile is gone from the site's breakpoints. Its styles are being removed from each page, component and pattern.",
      hint: "On a large site this takes a few minutes. You can close Settings; it carries on in the background.",
    });
    expect(resumedWords(["Mobile"])).toEqual({
      title: "Mobile's styles are still being removed",
      hint: "Breakpoints can be changed again once it has finished.",
    });
  });

  it("joins names as an author reads them", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B"])).toBe("A and B");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
  });
});
