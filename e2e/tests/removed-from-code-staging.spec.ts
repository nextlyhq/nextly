/**
 * The removed-from-code staging cleans up after itself when it fails.
 *
 * `stageRemovedEntities` writes registry rows, tables and migration files,
 * then waits for the server to list them. Its caller only learns the run once
 * the staging returns, so a staging that throws, as the wait does when the
 * server never lists the rows, must undo its own writes: nothing else can,
 * and what it left would be read by every later start.
 */
import { expect } from "@playwright/test";

import { STORAGE_STATE } from "../global-setup";

import { LOCK } from "./support/locks";
import { leftoversOf, stageRemovedEntities } from "./support/removed-from-code";
import { test } from "./support/test";

// Registry rows and migration files are the schema's shared state.
test.describe.configure({ lock: [LOCK.schema] });

test("a staging whose wait for the listing fails leaves nothing behind", async ({
  playwright,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const admin = await playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });
  const run = `fails${Date.now().toString(36)}`;
  const refused = new Error("[e2e] the staged rows were never listed");
  let written: Awaited<ReturnType<typeof leftoversOf>> | undefined;
  try {
    await expect(
      stageRemovedEntities(admin, run, {
        // The wait fails as a server that never lists the rows makes it fail,
        // after reading what the staging wrote: the control that there was
        // something to clean up.
        untilListed: async () => {
          written = await leftoversOf(run);
          throw refused;
        },
      })
    ).rejects.toBe(refused);
  } finally {
    await admin.dispose();
  }

  // Every state's collection and Single, their tables where the state keeps
  // them, and the two drop migrations.
  expect(written?.rows).toHaveLength(6);
  expect(written?.tables).toHaveLength(4);
  expect(written?.files).toHaveLength(2);

  expect(await leftoversOf(run)).toEqual({ rows: [], tables: [], files: [] });
});
