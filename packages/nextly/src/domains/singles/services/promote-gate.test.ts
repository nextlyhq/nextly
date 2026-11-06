/**
 * A promotion's field rules judge the document as it goes live.
 *
 * A pending change keeps the status it was saved under, which for a held
 * translation can be a draft's, while the promotion publishes it. A field rule
 * reading the document's status must be shown the status that is written, or a
 * value a rule allows only on a draft is promoted and published.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import type { PluginFieldValidateArgs } from "../../../plugins/contributions";
import type { EntryWriteContext } from "../../../shared/lib/entry-validation";
import {
  clearFieldFunctions,
  registerFieldFunctions,
} from "../../../shared/lib/field-level-registry";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../schema/field-types/field-type-registry";

import { assertDraftsMayBePromoted } from "./promote-gate";

afterEach(() => {
  clearFieldFunctions();
  clearFieldTypes();
});

describe("promoting a pending change", () => {
  it("shows a field rule the status the promotion writes", async () => {
    const seen: unknown[] = [];
    const fields = [{ name: "notes", type: "text" }];
    registerFieldFunctions("single", "landing", [
      {
        ...fields[0],
        access: {
          update: ({ data }: { data?: Record<string, unknown> }) => {
            seen.push(data?.status);
            return true;
          },
        },
      },
    ]);

    await assertDraftsMayBePromoted(
      [{ locale: null, snapshot: { notes: "held", status: "draft" } }],
      {
        slug: "landing",
        entryId: "s1",
        fields: fields as FieldConfig[],
        grants: async () => ({ permissions: [], roles: [] }),
        toLogical: doc => doc,
        liveStoredFor: async () => ({ notes: "live", status: "draft" }),
        status: "published",
        localizedFieldNames: new Set(),
        enforceLocalizedRequired: true,
      }
    );

    // The promoted document is judged first, then the live one it replaces.
    expect(seen[0]).toBe("published");
  });

  /**
   * Every language's pending change writes its shared values to the one main
   * row, applied in the order given, so the last one's value is what lands.
   * Each language is judged with that value, not with its own snapshot's.
   */
  describe("with more than one language", () => {
    const fields = [
      { name: "headline", type: "text", localized: true },
      { name: "guarded", type: "text", localized: false },
    ];
    const promote = (snapshots: Array<[string, string]>) =>
      assertDraftsMayBePromoted(
        snapshots.map(([locale, guarded]) => ({
          locale,
          snapshot: { headline: locale, guarded },
        })),
        {
          slug: "landing",
          entryId: "s1",
          fields: fields as FieldConfig[],
          grants: async () => ({ permissions: [], roles: [] }),
          toLogical: doc => doc,
          liveStoredFor: async locale => ({
            headline: locale,
            guarded: "L0",
          }),
          status: "published",
          localizedFieldNames: new Set(["headline"]),
          enforceLocalizedRequired: true,
        }
      );

    afterEach(() => clearFieldFunctions());

    it("judges the shared value the last change writes, not an earlier one's", async () => {
      // Anyone may hold `guarded` at any value but "X".
      registerFieldFunctions("single", "landing", [
        {
          ...fields[1],
          access: {
            update: ({ data }: { data?: Record<string, unknown> }) =>
              data?.guarded !== "X",
          },
        },
      ]);

      // "X" is superseded by "L" before it is written: allowed.
      await expect(
        promote([
          ["en", "X"],
          ["de", "L"],
        ])
      ).resolves.toBeUndefined();
      // The same two changes the other way round write "X": refused.
      await expect(
        promote([
          ["de", "L"],
          ["en", "X"],
        ])
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });
  });
  it("hands a field type the write in the language each change is judged in", async () => {
    // A validator reading what the Single stores reads the language it is
    // judging: one promotion judges several, so each gets its own.
    const languages: (string | undefined)[] = [];
    registerFieldType({
      type: "document",
      storage: "json",
      component: "@acme/docs/admin#DocumentInput",
      validate: (_value: unknown, args: PluginFieldValidateArgs) => {
        languages.push(args.write?.locale);
        return true;
      },
    });
    const write: EntryWriteContext = {
      kind: "single",
      slug: "landing",
      inTransaction: true,
      readStored: async () => ({ kind: "absent" }),
    };
    const fields = [{ name: "body", type: "document", localized: true }];

    await assertDraftsMayBePromoted(
      [
        { locale: "en", snapshot: { body: { said: "en" } } },
        { locale: "de", snapshot: { body: { said: "de" } } },
      ],
      {
        slug: "landing",
        entryId: "s1",
        fields: fields as unknown as FieldConfig[],
        grants: async () => ({ permissions: [], roles: [] }),
        toLogical: doc => doc,
        liveStoredFor: async () => ({}),
        status: "published",
        localizedFieldNames: new Set(["body"]),
        enforceLocalizedRequired: true,
        write,
      }
    );

    // The promoted document is judged in each language before the live one.
    expect(languages.slice(0, 1)).toEqual(["en"]);
    expect(languages).toContain("de");
    expect(languages).not.toContain(undefined);
  });
});
