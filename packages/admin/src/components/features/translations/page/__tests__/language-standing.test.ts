/**
 * Where a language stands, and what saving and publishing it would do. Each
 * rule is paired with a case on its other side, so one that always answers the
 * same fails.
 */
import { describe, expect, it } from "vitest";

import {
  hasSomethingToPublish,
  holdsStrandedDraft,
  languagesGoingLiveToo,
  languageStanding,
  offlineApplies,
  publishApplies,
  saveReach,
  saveReachSentence,
} from "../language-standing";

const HOLDS = { hasStatus: true, holdsDrafts: true, readsDraft: true };
const NO_DRAFTS = { hasStatus: true, holdsDrafts: false, readsDraft: false };
const NO_STATUS = { hasStatus: false, holdsDrafts: false, readsDraft: false };
/** Stopped holding drafts, and still reads one saved before. */
const STOPPED = { hasStatus: true, holdsDrafts: false, readsDraft: true };

const LIVE = { published: true, pending: false };
const CHANGED = { published: true, pending: true };
const DRAFT = { published: false, pending: false };
const UNKNOWN = { published: undefined, pending: undefined };

describe("languageStanding", () => {
  const of = (meta: object, status: unknown = "published") =>
    languageStanding({ es: { translated: true, ...meta } }, "es", status);

  it("is published where the language and the document both are", () => {
    expect(of({ status: "published" })).toEqual(LIVE);
    expect(of({ status: "draft" })).toEqual(DRAFT);
    expect(of({ status: "published" }, "draft")).toEqual(DRAFT);
  });

  it("counts a published language with no text of its own", () => {
    expect(of({ translated: false, status: "published" })).toEqual(LIVE);
    expect(of({ translated: false })).toEqual(DRAFT);
  });

  it("says whether a change waits", () => {
    expect(of({ status: "published", pendingChange: true })).toEqual(CHANGED);
  });

  it("is unknown without the overview, and unpublished where it names none", () => {
    expect(languageStanding(undefined, "es", "published")).toEqual(UNKNOWN);
    expect(languageStanding({}, "es", "published")).toEqual(DRAFT);
  });
});

describe("saveReach", () => {
  it.each([
    ["a draft is held", HOLDS, LIVE, "nobody"],
    ["a live language keeps no drafts", NO_DRAFTS, LIVE, "readers"],
    ["an unpublished language keeps no drafts", NO_DRAFTS, DRAFT, "nobody"],
    ["the standing can't be known", NO_DRAFTS, UNKNOWN, "maybe"],
    ["nothing has a draft state", NO_STATUS, DRAFT, "readers"],
  ] as const)("where %s", (_where, rules, standing, reach) => {
    expect(saveReach(rules, standing)).toBe(reach);
  });

  it("is said, naming the language, wherever it reaches readers", () => {
    expect(saveReachSentence("readers", NO_DRAFTS, "Spanish")).toBe(
      "Spanish is published and no drafts are kept here: saving changes what its readers see at once."
    );
    expect(saveReachSentence("maybe", NO_DRAFTS, "Spanish")).toMatch(
      /if Spanish is published/
    );
    expect(saveReachSentence("readers", NO_STATUS, "Spanish")).toMatch(
      /^There are no drafts here: saving changes what Spanish readers see/
    );
    expect(saveReachSentence("nobody", HOLDS, "Spanish")).toBeUndefined();
  });
});

describe("publishing", () => {
  it("applies until a live language's saves go live by themselves", () => {
    expect(publishApplies(HOLDS, LIVE)).toBe(true);
    expect(publishApplies(NO_DRAFTS, DRAFT)).toBe(true);
    expect(publishApplies(NO_DRAFTS, UNKNOWN)).toBe(true);
    expect(publishApplies(NO_DRAFTS, LIVE)).toBe(false);
    expect(publishApplies(NO_STATUS, DRAFT)).toBe(false);
  });

  it("never offers a draft from before drafts stopped being held", () => {
    const stranded = { published: false, pending: true };
    expect(holdsStrandedDraft(STOPPED, stranded)).toBe(true);
    expect(publishApplies(STOPPED, stranded)).toBe(false);
    expect(publishApplies(STOPPED, CHANGED)).toBe(false);
    // With no such draft, and where drafts are held, it is as ever.
    expect(publishApplies(STOPPED, DRAFT)).toBe(true);
    expect(publishApplies(HOLDS, stranded)).toBe(true);
  });

  it("shows readers the languages already marked published, on a first publish", () => {
    const going = (
      over: Partial<Parameters<typeof languagesGoingLiveToo>[0]>
    ) =>
      languagesGoingLiveToo({
        translations: {
          en: { translated: true, status: "published" },
          es: { translated: true, status: "published" },
          fr: { translated: true, status: "draft" },
        },
        codes: ["en", "es", "fr"],
        target: "es",
        documentStatus: "draft",
        ...over,
      });
    expect(going({})).toEqual(["en"]);
    expect(going({ documentStatus: "published" })).toEqual([]);
    expect(going({ translations: undefined })).toBeUndefined();
  });

  it("has something to publish where the language would change", () => {
    expect(hasSomethingToPublish(LIVE, false)).toBe(false);
    expect(hasSomethingToPublish(LIVE, true)).toBe(true);
    expect(hasSomethingToPublish(CHANGED, false)).toBe(true);
    expect(hasSomethingToPublish(DRAFT, false)).toBe(true);
    expect(hasSomethingToPublish(UNKNOWN, false)).toBe(true);
  });

  it("is undone only where a language is, or may be, published", () => {
    expect(offlineApplies(HOLDS, LIVE)).toBe(true);
    expect(offlineApplies(HOLDS, UNKNOWN)).toBe(true);
    expect(offlineApplies(HOLDS, DRAFT)).toBe(false);
    expect(offlineApplies(NO_STATUS, LIVE)).toBe(false);
  });
});
