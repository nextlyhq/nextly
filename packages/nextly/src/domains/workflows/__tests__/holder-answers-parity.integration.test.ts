/**
 * Whether a person holds a permission, asked in batches (`holderAnswers`, by the roles holding it
 * and the person's roles in force), answers as the one decision does (`decidePermission` on the
 * person's actor), case by case, on every configured dialect.
 *
 * Each case also names its expected answer: parity alone would pass with both sides wrong alike.
 * A person-level grant is not a case because there is none to make: a person's grants are read
 * from their roles alone (`listEffectiveGrants` → `grantsOf(userId, roleIds)`), so `decidePermission`
 * honours no grant the roles do not carry.
 */
import { afterEach, describe, expect, it } from "vitest";

import { decidePermission } from "../../../auth/access/decide";
import { actorForUser } from "../../../auth/access/resolve-actor";
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { holderAnswer, holderAnswers, holderKey } from "../holders";

import {
  bootSteps,
  giveRole,
  person,
  role,
  superAdminRole,
  type Grant,
} from "./helpers/step-harness";

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

const PAST = new Date("2026-01-01T00:00:00.000Z");
const MEDIA_PLAIN: Grant[] = [
  ["read", "media"],
  ["create", "media"],
  ["update", "media"],
  ["delete", "media"],
];

describe.each(getConfiguredTestDialects())(
  "a person's hold on a permission, in batches and by the one decision (%s)",
  dialect => {
    it("answers each case as decidePermission does", async () => {
      t = await bootSteps(dialect);
      const app = t;
      // A role granted Clear on posts, and one inheriting it. A role inheriting one other needs a
      // permission of its own; reading posts grants nothing Clear needs.
      const base = await role(app, "clearers", [["sign-off", "posts"]]);
      const senior = await role(
        app,
        "senior-clearers",
        [["read", "posts"]],
        [base]
      );
      const superAdmin = await superAdminRole(app);

      await person(app, "direct", [["sign-off", "posts"]]);
      await person(app, "without", [["read", "posts"]]);
      await person(app, "inherited", []);
      await giveRole(app, "inherited", senior);
      await person(app, "super", []);
      await giveRole(app, "super", superAdmin);
      await person(app, "lapsed", []);
      await giveRole(app, "lapsed", base, PAST);
      await person(app, "manages-media", MEDIA_PLAIN);
      await person(app, "reads-media", [["read", "media"]]);

      const cases: {
        id: string;
        action: string;
        resource: string;
        holds: boolean;
      }[] = [
        { id: "direct", action: "sign-off", resource: "posts", holds: true },
        { id: "without", action: "sign-off", resource: "posts", holds: false },
        { id: "inherited", action: "sign-off", resource: "posts", holds: true },
        { id: "super", action: "sign-off", resource: "posts", holds: true },
        { id: "lapsed", action: "sign-off", resource: "posts", holds: false },
        // A retired `manage-` permission is held as the plain four it stood for are.
        {
          id: "manages-media",
          action: "manage",
          resource: "media",
          holds: true,
        },
        {
          id: "reads-media",
          action: "manage",
          resource: "media",
          holds: false,
        },
        { id: "nobody", action: "sign-off", resource: "posts", holds: false },
      ];

      for (const each of cases) {
        const decided = decidePermission(
          await actorForUser(each.id),
          each.action,
          each.resource
        ).allowed;
        const asked =
          (await holderAnswer(
            app.adapter,
            { kind: "user", id: each.id },
            each.action,
            each.resource
          )) === "holds";
        expect({ id: each.id, decided, asked }).toEqual({
          id: each.id,
          decided: each.holds,
          asked: each.holds,
        });
      }

      // The same people asked together answer as each did alone.
      for (const [action, resource] of [
        ["sign-off", "posts"],
        ["manage", "media"],
      ] as const) {
        const together = cases.filter(
          each => each.action === action && each.resource === resource
        );
        const answers = await holderAnswers(
          app.adapter,
          together.map(each => ({ kind: "user" as const, id: each.id })),
          action,
          resource
        );
        expect(
          together.map(each => ({
            id: each.id,
            holds:
              answers.get(holderKey({ kind: "user", id: each.id })) === "holds",
          }))
        ).toEqual(together.map(each => ({ id: each.id, holds: each.holds })));
      }
    });

    it("matches a person's or a role's id as the database does, in another case", async () => {
      // MySQL compares ids case-insensitively, so an id spelled in another case names the same
      // person or role there; PostgreSQL and SQLite compare exactly, so there it names no one. The
      // batch answers as the database matched the id, whichever that is.
      t = await bootSteps(dialect);
      const app = t;
      const clearers = await role(app, "case-clearers", [
        ["sign-off", "posts"],
      ]);
      await person(app, "casey", []);
      await giveRole(app, "casey", clearers);
      const spelled = { user: "CASEY", role: clearers.toUpperCase() };
      const matched = async (table: "users" | "roles", id: string) =>
        (
          await app.adapter.select<{ id: unknown }>(table, {
            columns: ["id"],
            where: { and: [{ column: "id", op: "=", value: id }] },
          })
        ).length > 0;
      // Not vacuous where it matters: MySQL does match both spellings.
      if (dialect === "mysql") {
        expect(await matched("users", spelled.user)).toBe(true);
        expect(await matched("roles", spelled.role)).toBe(true);
      }

      // Asked alone, and in one batch beside the stored spelling: each spelling answers as the
      // database matched it either way, so a batch naming both never loses one of them.
      const holders = [
        { kind: "user" as const, id: spelled.user },
        { kind: "role" as const, id: spelled.role },
      ];
      const stored = [
        { kind: "user" as const, id: "casey" },
        { kind: "role" as const, id: clearers },
      ];
      const expected = {
        user: (await matched("users", spelled.user)) ? "holds" : "not-found",
        role: (await matched("roles", spelled.role)) ? "holds" : "not-found",
        storedUser: "holds",
        storedRole: "holds",
      };
      for (const asked of [holders, [...stored, ...holders]]) {
        const answers = await holderAnswers(
          app.adapter,
          asked,
          "sign-off",
          "posts"
        );
        expect({
          user: answers.get(holderKey(holders[0])),
          role: answers.get(holderKey(holders[1])),
          storedUser:
            asked.length > 2 ? answers.get(holderKey(stored[0])) : "holds",
          storedRole:
            asked.length > 2 ? answers.get(holderKey(stored[1])) : "holds",
        }).toEqual(expected);
      }
    });

    it("names a missing person and a deactivated one, who hold nothing", async () => {
      t = await bootSteps(dialect);
      await person(t, "away", [["sign-off", "posts"]], { active: false });
      const answers = await holderAnswers(
        t.adapter,
        [
          { kind: "user", id: "nobody" },
          { kind: "user", id: "away" },
        ],
        "sign-off",
        "posts"
      );
      expect(answers.get("user:nobody")).toBe("not-found");
      expect(answers.get("user:away")).toBe("deactivated");
    });
  }
);
