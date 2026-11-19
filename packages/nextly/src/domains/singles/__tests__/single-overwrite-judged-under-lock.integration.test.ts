/**
 * A Single save no version check covers is judged on the row as committed.
 *
 * A save is judged on the pool before its transaction opens. One that carries
 * `_rev` is refused if another save lands in between; one that says
 * `_overwrite`, or carries no version, is not. Judged only before, such a save
 * replaces what another writer stored in between with a value judged against
 * what it replaced: here, an editor's overwrite puts back the code a manager
 * just changed, and the rule that only a manager may change it never sees the
 * change.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, pluginField, text } from "../../../config";
import type { PluginFieldValidateArgs } from "../../../plugins/contributions";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

const SLUG = "lockedcodesite";
const MANAGER = { id: "manager-1", email: "manager@example.com" };
const EDITOR = { id: "editor-1", email: "editor@example.com" };

/**
 * Runs once, between a validator's read of the stored value and its answer:
 * where another writer's save lands in the race.
 */
let between: (() => Promise<void>) | undefined;

/**
 * Code only a manager may change: an unchanged value passes for anyone, as
 * the Page Builder's page code does.
 */
const guardedCodePlugin = definePlugin({
  name: "@test/guarded-code",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    fieldTypes: [
      {
        type: "guarded-code",
        storage: "text",
        component: "@test/guarded-code/admin#GuardedCodeInput",
        validate: async (value: unknown, args: PluginFieldValidateArgs) => {
          const stored = await args.write?.readStored({
            single: SLUG,
            field: "code",
            form: "published",
          });
          const unchanged =
            stored !== undefined &&
            stored.kind === "value" &&
            stored.value === value;
          const land = between;
          between = undefined;
          if (land) await land();
          const user = args.req.user as { id?: string } | undefined;
          return unchanged || user?.id === MANAGER.id
            ? true
            : "Only a manager may change the code";
        },
      },
    ],
  },
});

let current: TestNextly | undefined;

afterEach(async () => {
  between = undefined;
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    plugins: [guardedCodePlugin],
    singles: [
      defineSingle({
        slug: SLUG,
        fields: [
          text({ name: "headline" }),
          pluginField({ name: "code", type: "guarded-code" }),
        ],
      }),
    ],
  });
  // The code as it starts, set by the manager.
  await save(current, MANAGER, "first");
  return current;
}

/** One save of the Single's code, overwriting whatever is stored. */
function save(
  site: TestNextly,
  user: { id: string; email: string },
  code: string
) {
  return site.nextly.updateSingle({
    slug: SLUG,
    data: { code, _overwrite: true },
    user,
    overrideAccess: true,
  });
}

async function storedCode(site: TestNextly): Promise<unknown> {
  const found = (await site.nextly.findSingle({
    slug: SLUG,
    overrideAccess: true,
  })) as { code?: unknown };
  return found.code;
}

describe.each(getConfiguredTestDialects())(
  "a Single overwrite judged under its row lock (integration, %s)",
  dialect => {
    it("refuses an editor's overwrite that would put back code a manager changed in between", async () => {
      const site = await boot(dialect);
      // The editor saves the code as they read it; the manager changes it
      // after the editor's value was judged, before it is written.
      between = async () => {
        await save(site, MANAGER, "managers");
      };
      await expect(save(site, EDITOR, "first")).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      // The manager's change stands.
      expect(await storedCode(site)).toBe("managers");
    });

    it("keeps the same overwrite when the writer may change the code", async () => {
      // The control: judged again under the lock, a writer allowed to change
      // the code still overwrites, so the refusal above is the rule, not the
      // lock refusing every overwrite in a race.
      const site = await boot(dialect);
      between = async () => {
        await save(site, MANAGER, "managers");
      };
      await save(site, MANAGER, "first");
      expect(await storedCode(site)).toBe("first");
    });

    it("keeps an editor's overwrite that changes nothing", async () => {
      const site = await boot(dialect);
      await save(site, EDITOR, "first");
      expect(await storedCode(site)).toBe("first");
    });
  }
);
