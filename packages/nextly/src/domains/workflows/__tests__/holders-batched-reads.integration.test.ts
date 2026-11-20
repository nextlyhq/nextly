/**
 * The reads `holders` makes for many roles cost what they cost for one, on every configured dialect:
 * a key's role slugs are resolved in one statement, and the roles holding a permission granted to
 * several roles are found in one walk up the hierarchy. Counted at the driver (`statementsOf`), and
 * each answer checked too, so a cheap wrong answer cannot pass.
 */
import { afterEach, describe, expect, it } from "vitest";

import { statementsOf } from "../../../database/__tests__/integration/helpers/count-statements";
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { roleIdsOfSlugs, rolesHolding } from "../holders";

import { bootSteps, role } from "./helpers/step-harness";

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

describe.each(getConfiguredTestDialects())(
  "holders' reads over many roles (%s)",
  dialect => {
    it("resolves a key's role slugs in one read, however many it names", async () => {
      t = await bootSteps(dialect);
      const app = t;
      const ids: string[] = [];
      for (let n = 0; n < 6; n += 1) {
        ids.push(await role(app, `slug-role-${n}`, [["read", "posts"]]));
      }
      const slugs = ids.map((_, n) => `slug-role-${n}`);
      // A slug naming no role is left out.
      const answer = await roleIdsOfSlugs(app.adapter, [...slugs, "no-such"]);
      expect([...answer].sort()).toEqual([...ids].sort());

      const one = await statementsOf(dialect, () =>
        roleIdsOfSlugs(app.adapter, slugs.slice(0, 1))
      );
      const six = await statementsOf(dialect, () =>
        roleIdsOfSlugs(app.adapter, slugs)
      );
      expect(
        six.length,
        `1 slug:\n${one.join("\n")}\n\n6 slugs:\n${six.join("\n")}`
      ).toBe(one.length);
    });

    it("finds the roles holding a permission granted to many roles in one walk", async () => {
      t = await bootSteps(dialect);
      const app = t;
      // Clear on posts granted to six roles, each inherited by a role of its own; Clear on pages
      // granted to one such pair. Each walk up the hierarchy reads a level at a time, so one walk
      // for all six costs what one for a single role does.
      const holding: string[] = [];
      for (let n = 0; n < 6; n += 1) {
        const base = await role(app, `walk-base-${n}`, [["sign-off", "posts"]]);
        holding.push(
          base,
          await role(app, `walk-senior-${n}`, [["read", "posts"]], [base])
        );
      }
      const pagesBase = await role(app, "walk-pages", [["sign-off", "pages"]]);
      const pagesSenior = await role(
        app,
        "walk-pages-senior",
        [["read", "pages"]],
        [pagesBase]
      );
      const posts = await rolesHolding(app.adapter, "sign-off", "posts");
      expect(posts).toEqual(expect.arrayContaining(holding));
      expect(posts).not.toContain(pagesBase);
      expect(await rolesHolding(app.adapter, "sign-off", "pages")).toEqual(
        expect.arrayContaining([pagesBase, pagesSenior])
      );

      const one = await statementsOf(dialect, () =>
        rolesHolding(app.adapter, "sign-off", "pages")
      );
      const six = await statementsOf(dialect, () =>
        rolesHolding(app.adapter, "sign-off", "posts")
      );
      expect(
        six.length,
        `granted to 1:\n${one.join("\n")}\n\ngranted to 6:\n${six.join("\n")}`
      ).toBe(one.length);
    });
  }
);
