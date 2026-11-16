/**
 * Two editors saving one Site Style section from one read, as the editor's
 * saves are made: each merged onto the newest stored copy and sent with its
 * version, read and merged again when refused as stale.
 *
 * The Single checks the version under a row lock on Postgres and MySQL, and
 * SQLite serializes writers, so of two writes sent with one version exactly
 * one is stored and the other refused; this is what that refusal is FOR. A
 * blind write would store the second editor's whole section over the first's
 * change, so each case checks that both changes are stored.
 *
 * @module __tests__/site-style-concurrent-writes.integration.test
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { documentVersionOf } from "../document-version";
import { inCauses } from "../judged-writes";
import { pageBuilder } from "../plugin";
import { SITE_STYLE_SLUG } from "../site-style-storage";
import {
  saveSectionMerged,
  type VersionedSectionSave,
  type VersionedSiteStyle,
} from "../site-style-versioned-save";
import { readStoredJson } from "../stored-json";

const card = {
  id: "c-card",
  slug: "card",
  label: "Card",
  orderIndex: 0,
  styles: { base: { base: { color: "#111111" } } },
};
const hero = {
  id: "c-hero",
  slug: "hero",
  orderIndex: 1,
  styles: { base: { base: { color: "#222222" } } },
};

const brand = {
  id: "brand",
  name: "color.brand",
  kind: "color",
  values: { light: "#2563eb" },
};
const accent = {
  id: "accent",
  name: "color.accent",
  kind: "color",
  values: { light: "#f97316" },
};

/** The slice of the Direct API an editor-shaped save reads and writes through. */
interface SingleApi {
  findSingle(args: { slug: string; overrideAccess: boolean }): Promise<unknown>;
  updateSingle(args: {
    slug: string;
    data: Record<string, unknown>;
    overrideAccess: boolean;
  }): Promise<unknown>;
}

describe.each(getConfiguredTestDialects())(
  "two section saves made from one read (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(sections: Record<string, unknown>) {
      current = await createTestNextly({ dialect, plugins: [pageBuilder()] });
      const api = current.nextly as unknown as SingleApi;
      await api.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: { ...sections, _overwrite: true },
        overrideAccess: true,
      });
      return api;
    }

    /** The stored document and its version, as one read gives them. */
    async function read(api: SingleApi): Promise<VersionedSiteStyle> {
      const doc = await api.findSingle({
        slug: SITE_STYLE_SLUG,
        overrideAccess: true,
      });
      return { doc, rev: documentVersionOf(doc) };
    }

    /** A save as the editor makes one, over the Direct API. */
    function editorSave(
      api: SingleApi,
      from: VersionedSiteStyle,
      save: Pick<VersionedSectionSave, "section" | "base" | "mine">
    ) {
      return saveSectionMerged({
        ...save,
        prefer: "mine",
        latest: from,
        read: () => read(api),
        write: async data => {
          const doc = await api.updateSingle({
            slug: SITE_STYLE_SLUG,
            data,
            overrideAccess: true,
          });
          return { doc, rev: documentVersionOf(doc) };
        },
        staleOf: error => {
          const refusal = inCauses(error, NextlyError);
          return refusal?.code === "STALE_VERSION"
            ? (refusal.publicData ?? {})
            : undefined;
        },
      });
    }

    async function storedSection(api: SingleApi, section: string) {
      const { doc } = await read(api);
      return readStoredJson((doc as Record<string, unknown>)[section]);
    }

    it("keeps a rename of one style and a change to another", async () => {
      const api = await boot({ classes: [card, hero] });
      const from = await read(api);
      expect(typeof from.rev).toBe("string");
      const renamed = { ...card, label: "Promo card", slug: "promo-card" };
      const recoloured = {
        ...hero,
        styles: { base: { base: { color: "#00aa00" } } },
      };
      const [a, b] = await Promise.all([
        editorSave(api, from, {
          section: "classes",
          base: [card, hero],
          mine: [renamed, hero],
        }),
        editorSave(api, from, {
          section: "classes",
          base: [card, hero],
          mine: [card, recoloured],
        }),
      ]);
      expect(await storedSection(api, "classes")).toEqual([
        renamed,
        recoloured,
      ]);
      // One was stored first; the other was refused once and merged again.
      expect([a.attempts, b.attempts].sort()).toEqual([1, 2]);
      expect(a.conflicts).toBeUndefined();
      expect(b.conflicts).toBeUndefined();
    });

    it("keeps two edits to different fields of one style", async () => {
      const api = await boot({ classes: [card, hero] });
      const from = await read(api);
      const recoloured = {
        ...card,
        styles: { base: { base: { color: "#00aa00" } } },
      };
      await Promise.all([
        editorSave(api, from, {
          section: "classes",
          base: [card, hero],
          mine: [recoloured, hero],
        }),
        editorSave(api, from, {
          section: "classes",
          base: [card, hero],
          mine: [{ ...card, label: "Promo card" }, hero],
        }),
      ]);
      expect(await storedSection(api, "classes")).toEqual([
        { ...recoloured, label: "Promo card" },
        hero,
      ]);
    });

    it("keeps the later save's value where both changed one style, and says so", async () => {
      const api = await boot({ classes: [card, hero] });
      const from = await read(api);
      const colour = (color: string) => ({
        ...card,
        styles: { base: { base: { color } } },
      });
      const mines = [colour("#00aa00"), colour("#aa0000")];
      const saves = await Promise.all(
        mines.map(mine =>
          editorSave(api, from, {
            section: "classes",
            base: [card, hero],
            mine: [mine, hero],
          })
        )
      );
      const later = saves.findIndex(save => save.attempts === 2);
      const earlier = saves.findIndex(save => save.attempts === 1);
      expect([later, earlier].sort()).toEqual([0, 1]);
      expect(saves[later]?.conflicts?.entries).toMatchObject([
        { key: "c-card", kind: "changed", kept: "mine" },
      ]);
      expect(saves[earlier]?.conflicts).toBeUndefined();
      // The later save's value stored, and hero untouched.
      expect(await storedSection(api, "classes")).toEqual([mines[later], hero]);
    });

    it("keeps a variable added and another edited", async () => {
      const api = await boot({ tokens: { tokens: [brand] } });
      const from = await read(api);
      const edited = { ...brand, values: { light: "#1d4ed8" } };
      await Promise.all([
        editorSave(api, from, {
          section: "tokens",
          base: { tokens: [brand] },
          mine: { tokens: [brand, accent] },
        }),
        editorSave(api, from, {
          section: "tokens",
          base: { tokens: [brand] },
          mine: { tokens: [edited] },
        }),
      ]);
      expect(await storedSection(api, "tokens")).toEqual({
        tokens: [edited, accent],
      });
    });
  }
);
