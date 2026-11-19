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
 *
 * So an overwrite holds the version it was judged against, and compares it
 * under the row lock as a `_rev` is: one that moved means another save landed,
 * and the values are judged again on the pool, against the Single as it is
 * now, in a new attempt; at most three, then refused with nothing saved. Only
 * the judgement and the transaction run again, never the hooks before them,
 * and nothing after the commit runs until one attempt commits. A save of
 * another language, which leaves this language as it was, moves nothing.
 * Judged again of the values as sent, not as the write has since changed
 * them, and never inside the transaction, so a validator's read of the pool
 * waits on no connection the transaction holds.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { defineSingle, password, pluginField, text } from "../../../config";
import type { PluginFieldValidateArgs } from "../../../plugins/contributions";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

// One connection, so a read the judgement under the row lock makes on the
// pool has none to take while the transaction holds it. Set before any
// instance boots: the pool reads it then.
process.env.DB_POOL_MAX = "1";

const SLUG = "lockedcodesite";
const MANAGER = { id: "manager-1", email: "manager@example.com" };
const EDITOR = { id: "editor-1", email: "editor@example.com" };

/**
 * Runs once, between a validator's read of the stored value and its answer:
 * where another writer's save lands in the race.
 */
let between: (() => Promise<void>) | undefined;

/**
 * Runs on every judgement of the code `"first"`, at the same point: another
 * writer that lands a save each time this one is judged.
 */
let everyJudgement: (() => Promise<void>) | undefined;

/** Each code value the validator judged, in order. */
let judged: unknown[] = [];

/**
 * Whether the validator also reads the Single through the Direct API, on the
 * pool, as the page builder's validator reads the site's shared styles.
 */
let readsPool = false;

/** The code each Single-level hook was handed, in order. */
let heard: { beforeChange: unknown[]; afterChange: unknown[] } = {
  beforeChange: [],
  afterChange: [],
};

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
          judged.push(value);
          if (readsPool) {
            await current?.nextly.findSingle({
              slug: SLUG,
              overrideAccess: true,
            });
          }
          const land = between;
          between = undefined;
          if (land) await land();
          if (value === "first" && everyJudgement) await everyJudgement();
          const user = args.req.user as { id?: string } | undefined;
          return unchanged || user?.id === MANAGER.id
            ? true
            : "Only a manager may change the code";
        },
      },
    ],
  },
});

/** The refusal of the code, naming it: a refusal with no issue is not it. */
const REFUSED_CODE = {
  code: "VALIDATION_ERROR",
  publicData: {
    errors: [
      expect.objectContaining({
        path: "code",
        message: "Only a manager may change the code.",
      }),
    ],
  },
};

let current: TestNextly | undefined;

afterEach(async () => {
  between = undefined;
  everyJudgement = undefined;
  readsPool = false;
  judged = [];
  heard = { beforeChange: [], afterChange: [] };
  await current?.destroy();
  current = undefined;
});

/**
 * The site, the code set to `"first"` by the manager. `localized` keeps the
 * headline per language, in English and Spanish, the code shared.
 */
async function boot(
  dialect: TestDialect,
  { localized = false }: { localized?: boolean } = {}
): Promise<TestNextly> {
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    plugins: [guardedCodePlugin],
    ...(localized
      ? { localization: { locales: ["en", "es"], defaultLocale: "en" } }
      : {}),
    singles: [
      defineSingle({
        slug: SLUG,
        ...(localized ? { localized: true } : {}),
        // What a save's hooks were handed, to show a retry runs them once.
        hooks: {
          beforeChange: [
            context => {
              heard.beforeChange.push(
                (context.data as { code?: unknown } | undefined)?.code
              );
              return context.data;
            },
          ],
          afterChange: [
            context => {
              heard.afterChange.push(
                (context.data as { code?: unknown } | undefined)?.code
              );
              return context.data;
            },
          ],
        },
        fields: [
          text({ name: "headline", ...(localized ? { localized: true } : {}) }),
          pluginField({ name: "code", type: "guarded-code" }),
          // Stored as a hash longer than the length allowed of what is sent.
          password({ name: "secret", maxLength: 32 }),
        ],
      }),
    ],
  });
  // The code as it starts, set by the manager.
  await save(current, MANAGER, "first");
  judged = [];
  heard = { beforeChange: [], afterChange: [] };
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
      await expect(save(site, EDITOR, "first")).rejects.toMatchObject(
        REFUSED_CODE
      );
      // The manager's change stands.
      expect(await storedCode(site)).toBe("managers");
    });

    it("judges an overwrite again when its Single moved, writes it, and runs its hooks once", async () => {
      // The control: a writer allowed to change the code still overwrites in
      // the race, so the refusal above is the rule, not every overwrite in a
      // race refused.
      const site = await boot(dialect);
      between = async () => {
        await save(site, MANAGER, "managers");
      };
      await save(site, MANAGER, "first");
      expect(await storedCode(site)).toBe("first");
      // Judged twice: once against "first", and again against "managers".
      expect(judged.filter(value => value === "first")).toHaveLength(2);
      // Its hooks before the write, and after the commit, ran once each.
      expect(heard.beforeChange.filter(code => code === "first")).toHaveLength(
        1
      );
      expect(heard.afterChange.filter(code => code === "first")).toHaveLength(
        1
      );
    });

    it("refuses an overwrite whose Single moves on every attempt, saving nothing", async () => {
      const site = await boot(dialect);
      let landed = 0;
      everyJudgement = async () => {
        landed += 1;
        await save(site, MANAGER, `managers-${landed}`);
      };
      await expect(save(site, MANAGER, "first")).rejects.toMatchObject({
        code: "CONFLICT",
        message:
          "Another save kept changing this page while yours was being checked, so nothing was saved. Try again.",
      });
      // Three attempts, each judged once, and nothing of this save kept.
      expect(judged.filter(value => value === "first")).toHaveLength(3);
      expect(await storedCode(site)).toBe("managers-3");
      expect(heard.afterChange.filter(code => code === "first")).toHaveLength(
        0
      );
    });

    it("judges an overwrite once when only another language changed in between", async () => {
      const site = await boot(dialect, { localized: true });
      between = async () => {
        await site.nextly.updateSingle({
          slug: SLUG,
          data: { headline: "Hola", _overwrite: true },
          locale: "es",
          user: MANAGER,
          overrideAccess: true,
        });
      };
      await site.nextly.updateSingle({
        slug: SLUG,
        data: { code: "first", headline: "Hello", _overwrite: true },
        locale: "en",
        user: MANAGER,
        overrideAccess: true,
      });
      expect(judged.filter(value => value === "first")).toHaveLength(1);
      expect(await storedCode(site)).toBe("first");
    });

    it("judges an overwrite again when its own language changed in between", async () => {
      const site = await boot(dialect, { localized: true });
      // An English save of the translated headline alone, which moves the
      // English version and not the Single's own.
      between = async () => {
        await site.nextly.updateSingle({
          slug: SLUG,
          data: { headline: "Hi", _overwrite: true },
          locale: "en",
          user: MANAGER,
          overrideAccess: true,
        });
      };
      await site.nextly.updateSingle({
        slug: SLUG,
        data: { code: "first", headline: "Hello", _overwrite: true },
        locale: "en",
        user: MANAGER,
        overrideAccess: true,
      });
      expect(judged.filter(value => value === "first")).toHaveLength(2);
    });

    it("writes an overwrite judged again by a validator that reads the pool, on one connection", async () => {
      const site = await boot(dialect);
      readsPool = true;
      between = async () => {
        await save(site, MANAGER, "managers");
      };
      await save(site, MANAGER, "first");
      expect(await storedCode(site)).toBe("first");
      expect(judged.filter(value => value === "first")).toHaveLength(2);
    });

    it("judges a password again as it was sent, not as the hash the write stores", async () => {
      const site = await boot(dialect);
      // Judged again, since another save lands after the first judgement.
      between = async () => {
        await save(site, MANAGER, "managers");
      };
      // 28 characters as sent; the hash the write stores in its place is 60,
      // which the length rule would refuse were it judged instead.
      await expect(
        site.nextly.updateSingle({
          slug: SLUG,
          data: {
            code: "first",
            secret: "a-password-of-28-characters!",
            _overwrite: true,
          },
          user: MANAGER,
          overrideAccess: true,
        })
      ).resolves.toBeDefined();
      expect(judged.filter(value => value === "first")).toHaveLength(2);
    });

    it("tells a caller judged by their permissions the refusal under the lock, on one connection", async () => {
      const site = await boot(dialect);
      // The editor may read and update the Single, so the refusal is told
      // as their permissions allow, which asks the read gate.
      await userWhoMay(site, EDITOR.id, "read", [SLUG]);
      await grantTo(site, EDITOR.id, "update", [SLUG]);
      between = async () => {
        await save(site, MANAGER, "managers");
        // A role given meanwhile, so what the editor may do is read afresh
        // rather than remembered from the save's own access check.
        await grantTo(site, EDITOR.id, "delete", [SLUG]);
      };
      await expect(
        site.nextly.updateSingle({
          slug: SLUG,
          data: { code: "first", _overwrite: true },
          user: EDITOR,
          overrideAccess: false,
        })
      ).rejects.toMatchObject(REFUSED_CODE);
      expect(await storedCode(site)).toBe("managers");
    });

    it("keeps an editor's overwrite that changes nothing", async () => {
      const site = await boot(dialect);
      await save(site, EDITOR, "first");
      expect(await storedCode(site)).toBe("first");
    });
  }
);
