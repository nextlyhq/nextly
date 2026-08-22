/**
 * Whether a write to ONE section of the Site Style single leaves the others
 * alone.
 *
 * The whole shape of the editor's client path turns on this. Four studios —
 * tokens, fonts, classes and breakpoints — each own one field of one document.
 * If an update MERGES, a studio can send only its own section and the four can
 * never clobber one another, whatever order they save in. If it REPLACES, every
 * studio has to read the whole document, splice its section in, and write it
 * back — which makes a lost update the normal case rather than a rare one, and
 * forces the client to hold a full copy it must keep fresh.
 *
 * `single-mutation-service` says in its own docblock that it "applies the
 * provided partial data". That is a claim, and a claim about persistence is
 * worth exactly one round trip against a real database. This suite is that
 * round trip.
 *
 * Run per dialect the machine can reach: SQLite stores these as `text`,
 * Postgres as `jsonb`, MySQL as `json`, and a merge that works on one is not
 * evidence about the others — a dialect whose driver replaces the whole column
 * would pass every unit test in the package.
 *
 * @module __tests__/site-style-section-write.integration.test
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";
import { SITE_STYLE_SLUG } from "../site-style-storage";

/** Only what this suite calls, so it does not reach into core's private types. */
interface SingleEntryService {
  update(
    slug: string,
    data: Record<string, unknown>,
    ctx?: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
  get(
    slug: string,
    ctx?: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
}

/** The document a single's read answers with, whatever envelope it arrives in. */
function dataOf(result: unknown): Record<string, unknown> {
  const envelope = result as { data?: Record<string, unknown> };
  return envelope.data ?? (result as Record<string, unknown>);
}

/** A token set the stored-tokens validator accepts. */
const TOKENS = {
  tokens: [
    { name: "color.brand", kind: "color", values: { light: "#2563eb" } },
  ],
};

/** A breakpoint set the stored-breakpoints validator accepts. */
const BREAKPOINTS = {
  viewport: [
    { id: "base", label: "Base" },
    // CSS PIXELS, a number. The engine's `BreakpointDef.maxWidth` is
    // `number | undefined`, and a string is refused by the stored-breakpoints
    // validator rather than coerced.
    { id: "md", label: "Medium", maxWidth: 768 },
  ],
};

describe.each(getConfiguredTestDialects())(
  "writing one Site Style section (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    it("leaves the sections it did not name untouched", async () => {
      current = await createTestNextly({ dialect, plugins: [pageBuilder()] });
      const singles =
        current.getService<SingleEntryService>("singleEntryService");

      // The tokens studio saves. Only its own field is sent, which is the
      // whole question: a studio that has never read `breakpoints` cannot
      // preserve them by writing them back.
      await singles.update(
        SITE_STYLE_SLUG,
        { tokens: TOKENS },
        { overrideAccess: true }
      );
      // The breakpoint manager saves, knowing nothing about the write above.
      await singles.update(
        SITE_STYLE_SLUG,
        { breakpoints: BREAKPOINTS },
        { overrideAccess: true }
      );

      const stored = dataOf(
        await singles.get(SITE_STYLE_SLUG, { overrideAccess: true })
      );

      // Both survive, or the two studios are clobbering each other.
      expect(stored.breakpoints).toEqual(BREAKPOINTS);
      expect(stored.tokens).toEqual(TOKENS);
    });

    it("round-trips a section's JSON without restringifying or flattening it", async () => {
      // The dialect risk, separate from the merge one: these are `json` fields,
      // and a value that comes back as a STRING would satisfy "the section
      // survived" while breaking every reader downstream.
      current = await createTestNextly({ dialect, plugins: [pageBuilder()] });
      const singles =
        current.getService<SingleEntryService>("singleEntryService");

      await singles.update(
        SITE_STYLE_SLUG,
        { tokens: TOKENS },
        { overrideAccess: true }
      );
      const stored = dataOf(
        await singles.get(SITE_STYLE_SLUG, { overrideAccess: true })
      );

      expect(typeof stored.tokens).toBe("object");
      expect((stored.tokens as { tokens: unknown[] }).tokens[0]).toMatchObject({
        name: "color.brand",
        kind: "color",
      });
    });

    it("reports a refused section in the RESULT, not by rejecting", async () => {
      // The contract a client has to read. This RESOLVES with
      // `success: false` / `committed: false` rather than throwing, so a
      // studio that awaits the save and treats a settled promise as a
      // successful one would show "saved" over a write the database refused.
      current = await createTestNextly({ dialect, plugins: [pageBuilder()] });
      const singles =
        current.getService<SingleEntryService>("singleEntryService");

      await singles.update(
        SITE_STYLE_SLUG,
        { tokens: TOKENS },
        { overrideAccess: true }
      );
      const refused = (await singles.update(
        SITE_STYLE_SLUG,
        { breakpoints: { viewport: [{ id: "", label: "" }] } },
        { overrideAccess: true }
      )) as {
        success?: boolean;
        committed?: boolean;
        code?: string;
        errors?: readonly { field?: string; message?: string }[];
      };

      expect(refused.success).toBe(false);
      expect(refused.committed).toBe(false);
      expect(refused.code).toBe("VALIDATION_ERROR");
      // Named per FIELD, which is what lets a studio put the message on its own
      // section rather than showing a document-wide error for one bad row.
      expect(refused.errors?.[0]?.field).toBe("breakpoints");
    });

    it("leaves a previously-good section intact when another is refused", async () => {
      // The half that matters most: a studio showing an error while silently
      // blanking another studio's work is the worst outcome available here.
      current = await createTestNextly({ dialect, plugins: [pageBuilder()] });
      const singles =
        current.getService<SingleEntryService>("singleEntryService");

      await singles.update(
        SITE_STYLE_SLUG,
        { tokens: TOKENS },
        { overrideAccess: true }
      );
      await singles.update(
        SITE_STYLE_SLUG,
        { breakpoints: { viewport: [{ id: "", label: "" }] } },
        { overrideAccess: true }
      );

      const stored = dataOf(
        await singles.get(SITE_STYLE_SLUG, { overrideAccess: true })
      );
      expect(stored.tokens).toEqual(TOKENS);
      // And the refused section did not land in any partial form.
      expect(stored.breakpoints ?? null).toBeNull();
    });
  }
);
