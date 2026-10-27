/**
 * A Single call made inside a request that arrived on an API key, naming no
 * key scope of its own, is judged as that key: the scope in force, as a
 * collection call is judged. A hook or plugin code calling the Direct API
 * while serving a key's request is the usual such call.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { apiKeyScope } from "../../../auth/authenticated-scope";
import { runWithCallerScope } from "../../../auth/caller-scope";
import { defineSingle, text } from "../../../config";
import {
  account,
  role,
  seedPermissions,
} from "../../../direct-api/__tests__/checked-access-fixtures";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

const SINGLE = "keynotice";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The Direct API's Single calls, typed where the shim is not. */
interface Singles {
  findSingle(a: Record<string, unknown>): Promise<unknown>;
  updateSingle(a: Record<string, unknown>): Promise<unknown>;
}

async function boot(dialect: TestDialect): Promise<{
  singles: Singles;
  owner: string;
}> {
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    singles: [
      defineSingle({ slug: SINGLE, fields: [text({ name: "title" })] }),
    ],
  });
  await seedPermissions(current);
  // The install's first account is its administrator, whom no rule binds;
  // made first so the owner below is not.
  await account(current, "founder@example.com");
  const editor = await role(current, "keynotice-editor", [
    `read-${SINGLE}`,
    `update-${SINGLE}`,
  ]);
  const owner = await account(current, "owner@example.com", [editor]);
  const singles = current.nextly as unknown as Singles;
  await singles.updateSingle({
    slug: SINGLE,
    data: { title: "first" },
    overrideAccess: true,
  });
  return { singles, owner };
}

/** A key its owner made to read the Single, and nothing else. */
const readOnlyKey = apiKeyScope([
  { slug: `read-${SINGLE}`, action: "read", resource: SINGLE },
]);

describe.each(getConfiguredTestDialects())(
  "a Single call inside a key's request, naming no scope (%s)",
  dialect => {
    it("is judged as the key: its update is refused, though the key's owner may update", async () => {
      const { singles, owner } = await boot(dialect);
      const update = () =>
        singles.updateSingle({
          slug: SINGLE,
          data: { title: "changed" },
          overrideAccess: false,
          user: { id: owner },
        });

      await expect(runWithCallerScope(readOnlyKey, update)).rejects.toThrow();
      // The controls: the key may read, and its owner, outside a key's
      // request, may update.
      await expect(
        runWithCallerScope(readOnlyKey, () =>
          singles.findSingle({
            slug: SINGLE,
            overrideAccess: false,
            user: { id: owner },
          })
        )
      ).resolves.toBeDefined();
      await expect(update()).resolves.toBeDefined();
    });
  }
);
