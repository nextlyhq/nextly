/**
 * The read-side overlay rule.
 *
 * The cases that matter most are the ones where this rule and the WRITE rule
 * must agree, because a disagreement is invisible from either side: the write
 * reports success and the read shows the old content.
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import { text } from "../../../config";
import {
  _resetPerLanguageStorage,
  setPerLanguageStorage,
} from "../../i18n/per-language-storage";
import { resolveDraftHold } from "../draft-hold";
import { resolveDraftOverlay } from "../draft-overlay";
import type { ComponentSchemas } from "../restore-snapshot";

const FIELDS = [text({ name: "title" })] as unknown as FieldConfig[];

/** A resolved, LOCALIZED component — representable in a snapshot since #1066. */
const LOCALIZED_COMPONENT = new Map([
  ["hero", { resolved: true, localized: true, fields: [] }],
]) as unknown as ComponentSchemas;

/** A component that could not be resolved — never representable. */
const UNRESOLVED_COMPONENT = new Map([
  ["hero", { resolved: false, localized: false, fields: [] }],
]) as unknown as ComponentSchemas;

const base = {
  collectionHasStatus: true,
  draftsVersioningEnabled: true,
  documentLocalized: false,
  fields: FIELDS,
  componentSchemas: null as ComponentSchemas | null,
  includeWorkingDraft: true,
  callerMayEdit: true,
};

describe("resolveDraftOverlay", () => {
  it("overlays an eligible document for an editor who asked", () => {
    expect(resolveDraftOverlay(base)).toEqual({
      overlay: true,
      draftLocale: null,
    });
  });

  it.each([
    ["the caller did not ask", { includeWorkingDraft: false }],
    ["the caller may not edit", { callerMayEdit: false }],
    ["an explicit published view", { requestedStatus: "published" }],
    ["the lifecycle is off", { collectionHasStatus: false }],
    ["drafts versioning is off", { draftsVersioningEnabled: false }],
    [
      "a component cannot be resolved",
      { componentSchemas: UNRESOLVED_COMPONENT },
    ],
  ])("declines when %s", (_why, patch) => {
    expect(resolveDraftOverlay({ ...base, ...patch }).overlay).toBe(false);
  });

  it("keys a localized document under the language being read", () => {
    expect(
      resolveDraftOverlay({
        ...base,
        documentLocalized: true,
        requestLocale: "es",
        defaultLocale: "en",
      })
    ).toEqual({ overlay: true, draftLocale: "es" });
  });

  it("keys a localized document under the default when the read names none", () => {
    // The admin omits `?locale=` for the default language, so this is the
    // ordinary path rather than an edge case.
    expect(
      resolveDraftOverlay({
        ...base,
        documentLocalized: true,
        defaultLocale: "en",
      })
    ).toEqual({ overlay: true, draftLocale: "en" });
  });

  it("declines a localized document whose language it cannot name", () => {
    // No request locale and no default: there is no slot to look in, and
    // reading the unlocalized one would report no pending change for a document
    // that has one.
    expect(
      resolveDraftOverlay({ ...base, documentLocalized: true }).overlay
    ).toBe(false);
  });

  /**
   * The regression this rule exists for. A LOCALIZED component is representable
   * in a snapshot — the write has held such edits since #1066 — while the read
   * overlay still tested `schema.localized` and refused them. The author's edit
   * was stored and then shown as the old content.
   */
  // An unlocalized document reaching a localized component holds no new draft
  // without per-language storage (its draft would have no language), yet a read
  // still looks for one held before, which its publish would put live. Under
  // per-language storage it holds one, keyed by the request's language.
  it.each([
    { perLanguageStorage: false, holds: false, shows: true },
    { perLanguageStorage: true, holds: true, shows: true },
  ])(
    "agrees with the WRITE rule about a localized component (per-language storage: $perLanguageStorage)",
    ({ perLanguageStorage, holds, shows }) => {
      setPerLanguageStorage(perLanguageStorage);
      try {
        const shared = {
          collectionHasStatus: true,
          draftsVersioningEnabled: true,
          documentLocalized: false,
          fields: FIELDS,
          componentSchemas: LOCALIZED_COMPONENT,
          requestLocale: "es",
        };

        const held = resolveDraftHold({
          ...shared,
          namedStatus: undefined,
          liveStatus: "published",
        });
        const shown = resolveDraftOverlay({
          ...shared,
          includeWorkingDraft: true,
          callerMayEdit: true,
        });

        // Asserted as the PAIR, not as two independent truths: what matters is
        // that they cannot differ, and a test asserting only `shown.overlay`
        // would still pass if the write later stopped holding.
        expect({ held: held.hold, shown: shown.overlay }).toEqual({
          held: holds,
          shown: shows,
        });
        expect(shown.draftLocale).toBe(held.draftLocale);
      } finally {
        _resetPerLanguageStorage();
      }
    }
  );

  // A collection's draft held before the rule is shown, read-only, because
  // its writes refuse while it is there. A Single's writes hold no such
  // refusal, so its earlier draft is not shown for a write to act on.
  it.each([
    { entityKind: "collection" as const, shows: true },
    { entityKind: "single" as const, shows: false },
  ])(
    "shows a $entityKind's draft held before the rule: $shows",
    ({ entityKind, shows }) => {
      expect(
        resolveDraftOverlay({
          ...base,
          componentSchemas: LOCALIZED_COMPONENT,
          entityKind,
          requestLocale: "es",
        }).overlay
      ).toBe(shows);
    }
  );

  it("agrees with the WRITE rule about an unresolved component", () => {
    const shared = {
      collectionHasStatus: true,
      draftsVersioningEnabled: true,
      documentLocalized: false,
      fields: FIELDS,
      componentSchemas: UNRESOLVED_COMPONENT,
    };

    const held = resolveDraftHold({
      ...shared,
      namedStatus: undefined,
      liveStatus: "published",
    });
    const shown = resolveDraftOverlay({
      ...shared,
      includeWorkingDraft: true,
      callerMayEdit: true,
    });

    // Neither side may act, and the point is that they match — an overlay with
    // no write behind it shadows the live document with a sidecar nothing can
    // ever promote.
    expect({ held: held.hold, shown: shown.overlay }).toEqual({
      held: false,
      shown: false,
    });
  });
});
