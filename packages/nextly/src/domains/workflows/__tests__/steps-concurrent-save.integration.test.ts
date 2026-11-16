/**
 * A step judged beside a save still in flight, on PostgreSQL, where two transactions really run
 * at once (SQLite serializes writers, so it cannot race there).
 *
 * The save has written newer content to the document's own row and moved its version, and has not
 * committed. A step that read the version without waiting would see the old one, match what the
 * reviewer was shown, and approve content the save is about to replace. The step must wait for
 * the save's row lock, then see the new version and refuse as stale.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionRegistryService } from "../../collections/services/collection-registry-service";
import { revisionBumpColumns } from "../../versions/document-revision";
import { untilSomeoneWaitsOnALock } from "../../versions/__tests__/helpers/lock-wait";
import { workflowDefinitionHash } from "../hash";
import { takeWorkflowStep } from "../steps";

import {
  bootSteps,
  entry,
  partOf,
  person,
  seedState,
  stateOf,
  versionOf,
} from "./helpers/step-harness";
import { editorial } from "./helpers/step-workflows";

const HASH = workflowDefinitionHash(editorial);

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

// Skipped, not absent, where PostgreSQL is not configured, so the file still reports its suite.
describe.skipIf(!getConfiguredTestDialects().includes("postgresql"))(
  "a step beside a save in flight (postgresql)",
  () => {
    const dialect = "postgresql" as const;
    it("waits for the save and refuses an approval of the content it replaced", async () => {
      t = await bootSteps(dialect);
      const app = t;
      const bob = await person(app, "bob", [["sign-off", "pages"]]);
      const page = await entry(app, "pages");
      const shared = partOf("pages", page, null);
      await seedState(app, shared, "legal", {
        enteredBy: "alice",
        definitionHash: HASH,
      });
      const shown = await versionOf(app, "pages", page, null);
      const registry = app.getService(
        "collectionRegistryService"
      ) as CollectionRegistryService;
      const table = (await registry.getCollectionBySlug("pages"))?.tableName;
      if (!table) throw new Error("no table for pages");

      // A save that has written its content and moved the version, held open.
      const wrote = deferred();
      const release = deferred();
      const save = app.adapter.transaction(async tx => {
        await tx.update(
          table,
          {
            title: "Replaced",
            ...revisionBumpColumns({ type: "user", id: "carol" }),
          },
          { and: [{ column: "id", op: "=", value: page }] }
        );
        wrote.resolve();
        await release.promise;
      });
      await wrote.promise;

      const outcome = takeWorkflowStep(app.adapter, {
        document: {
          scopeKind: "collection",
          scopeSlug: "pages",
          entryId: page,
        },
        step: "clear",
        parts: [null],
        seen: [{ part: null, revision: 1, version: shown }],
        caller: bob,
      }).then(
        result => ({ refused: false as const, result }),
        (error: unknown) => ({ refused: true as const, error })
      );
      try {
        // The step either waits on the save's row lock, or finishes without waiting.
        await Promise.race([
          // A barrier that never sees a waiter times out; the step finishing first is the answer then.
          untilSomeoneWaitsOnALock(app.adapter, dialect).catch(() => undefined),
          outcome,
        ]);
      } finally {
        release.resolve();
        await save;
      }

      expect(await outcome).toMatchObject({
        refused: true,
        error: {
          code: "CONFLICT",
          publicData: { reason: "stale", parts: [null] },
        },
      });
      expect(await stateOf(app, shared)).toMatchObject({
        stage: "legal",
        approval: null,
        revision: 1,
      });
    });
  }
);
