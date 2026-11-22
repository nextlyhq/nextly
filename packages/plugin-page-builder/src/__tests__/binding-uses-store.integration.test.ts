/**
 * The report's store keeps where documents bind a Single under the report's
 * own mark, against each dialect's real tables: uses are replaced only while
 * the document's mark is the one its judgement read, a check of every
 * document leaves a marked document's uses to its judgement, and a complete
 * check drops the uses of documents it no longer found while a marked one
 * keeps its own.
 *
 * What only a database shows: the transaction each write runs in, the row
 * the mark's update holds, and how each dialect counts the rows an update
 * matched. The sweep that calls these is `bindings-report/scan.test.ts`.
 *
 * @module __tests__/binding-uses-store.integration.test
 */
import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bindingReportStore,
  type BindingReportStore,
  type ReportedDocument,
} from "../bindings-report/store";
import {
  bindingUsesReader,
  type DocumentUse,
} from "../bindings-report/uses-store";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";

/** A plugin depending on the page builder, so its `ctx.db` reaches its tables. */
function probePlugin(holder: { db?: PluginDatabase }): PluginDefinition {
  return definePlugin({
    name: "@test/binding-uses-probe",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { [PAGE_BUILDER_PLUGIN_NAME]: "*" },
    init(ctx) {
      holder.db = ctx.db;
    },
  });
}

const SINGLE = "buses_homepage";

const documentOf = (id: string): ReportedDocument => ({
  documentKey: `collection\u001fpages\u001f${id}`,
  kind: "collection",
  slug: "pages",
  documentId: id,
  place: "pages",
});

/** A use of the Single's `path` by block `nodeId`. */
const use = (nodeId: string, path = "headline"): DocumentUse => ({
  nodeId,
  blockType: "core/heading",
  // Longer than any short text column: a name nothing bounds is stored.
  blockName: `Hero ${"x".repeat(600)}`,
  prop: "text",
  sourceKey: SINGLE,
  path,
  version: "published",
  blocksField: "content",
});

describe.each(getConfiguredTestDialects())(
  "the report's store keeping where documents bind a Single (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let store: BindingReportStore;
    const probe: { db?: PluginDatabase } = {};

    /** The ids of the blocks using the Single, by document. */
    async function usesOf(id: string): Promise<string[]> {
      if (probe.db === undefined) throw new Error("no ctx.db");
      const found = await bindingUsesReader(probe.db).ofSingle(SINGLE, 100);
      return found
        .filter(row => row.documentId === id)
        .map(row => `${row.nodeId}:${row.path}`);
    }

    /** The document's mark, as a judgement reads it. */
    async function markOf(id: string) {
      const marked = (await store.dirty(100)).find(
        entry => entry.document.documentId === id
      );
      if (marked === undefined) throw new Error(`${id} is not marked`);
      return marked;
    }

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        plugins: [pageBuilder(), probePlugin(probe)],
      });
      if (probe.db === undefined) throw new Error("the probe got no ctx.db");
      store = bindingReportStore(probe.db, dialect);
    });

    afterAll(async () => {
      await t?.destroy();
    });

    it("settles a document's uses with its mark, and not with a mark a later write replaced", async () => {
      const doc = documentOf("settled");
      await store.markDirty(doc);
      const stale = await markOf("settled");
      // A write marks it again before the stale judgement settles.
      await store.markDirty(doc);
      expect(await store.settle(stale, [], [use("old")])).toBe(false);
      expect(await store.keepUses(stale, [use("old")])).toBe(false);
      expect(await usesOf("settled")).toEqual([]);

      const current = await markOf("settled");
      expect(await store.keepUses(current, [use("waiting")])).toBe(true);
      // Kept while the report waits: still marked, with its uses written.
      expect((await markOf("settled")).token).toBe(current.token);
      expect(await usesOf("settled")).toEqual(["waiting:headline"]);
      expect(await store.settle(current, [], [use("hero")])).toBe(true);
      expect(await usesOf("settled")).toEqual(["hero:headline"]);
      // Settled with none: the binding was taken out.
      await store.markDirty(doc);
      expect(await store.settle(await markOf("settled"), [], [])).toBe(true);
      expect(await usesOf("settled")).toEqual([]);
    });

    it("records a new document's uses, and leaves a marked one's to its judgement", async () => {
      const doc = documentOf("recorded");
      await store.record(doc, [], [use("first")]);
      expect(await usesOf("recorded")).toEqual(["first:headline"]);
      await store.record(doc, [], [use("first"), use("second", "tagline")]);
      expect((await usesOf("recorded")).sort()).toEqual([
        "first:headline",
        "second:tagline",
      ]);
      // A write marks it; the check's older reading is not recorded.
      await store.markDirty(doc);
      await store.record(doc, [], [use("stale")]);
      expect((await usesOf("recorded")).sort()).toEqual([
        "first:headline",
        "second:tagline",
      ]);
    });

    it("drops the uses of documents a complete check no longer found, keeping a marked one's", async () => {
      await store.record(documentOf("gone"), [], [use("gone")]);
      await store.record(documentOf("marked"), [], [use("kept")]);
      await store.markDirty(documentOf("marked"));
      // A check that started after both were written.
      await store.dropCheckedBefore(new Date(Date.now() + 5_000));
      expect(await usesOf("gone")).toEqual([]);
      expect(await usesOf("marked")).toEqual(["kept:headline"]);
    });
  }
);
