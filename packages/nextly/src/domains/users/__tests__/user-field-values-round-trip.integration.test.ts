/**
 * A custom user field of each type gives back, on every configured dialect, the value it was
 * given: through the Direct API and through REST alike.
 *
 * Every read and write of a user's custom fields goes through the runtime table, and Drizzle
 * encodes and decodes a value by the type that table declares. Where it declared another type than
 * the column the builder made, the value was translated through the wrong one: on PostgreSQL a
 * date in a `TIMESTAMP WITH TIME ZONE` column was decoded as a plain timestamp and read back as an
 * invalid date. Each type is written with a value its wrong declaration would change, and read
 * back.
 *
 * And a number column an earlier release made `REAL` on PostgreSQL, where numbers are now made
 * `DOUBLE PRECISION`, is left as it is: a start does not alter it, it keeps being read and written,
 * and the column report names it rather than changing it.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { findColumnDifferences } from "../../schema/repair-columns/find-differences";
import type {
  EntityDefinition,
  RepairEntity,
} from "../../schema/repair-columns/types";
import type { UserExtSchemaService } from "../services/user-ext-schema-service";
import type { UserFieldDefinitionService } from "../services/user-field-definition-service";

interface Direct {
  users: {
    create(a: Record<string, unknown>): Promise<{ item: { id: string } }>;
    update(a: Record<string, unknown>): Promise<unknown>;
    findByID(a: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
}

const OPTIONS = [
  { label: "Alpha", value: "alpha" },
  { label: "Beta", value: "beta" },
];

/** One field of each type a user field may be, as the admin's user fields page defines it. */
const FIELDS: Array<Record<string, unknown>> = [
  { name: "nickname", label: "Nickname", type: "text" },
  { name: "shortBio", label: "Short bio", type: "text", maxLength: 80 },
  { name: "about", label: "About", type: "textarea" },
  { name: "workEmail", label: "Work email", type: "email" },
  { name: "website", label: "Website", type: "url" },
  { name: "score", label: "Score", type: "number" },
  { name: "isMentor", label: "Mentor", type: "checkbox" },
  { name: "birthday", label: "Birthday", type: "date" },
  { name: "team", label: "Team", type: "select", options: OPTIONS },
  {
    name: "teams",
    label: "Teams",
    type: "select",
    hasMany: true,
    options: OPTIONS,
  },
  { name: "tier", label: "Tier", type: "radio", options: OPTIONS },
];

/**
 * Values each wrong declaration would change: a long text past a 255 varchar, a number past
 * float4's precision, an instant that only a time-zone-aware decode keeps.
 */
const VALUES: Record<string, unknown> = {
  nickname: "n".repeat(300),
  shortBio: "b".repeat(80),
  about: "a line\nand another",
  workEmail: "someone@example.com",
  website: "https://example.com/profile",
  score: 1234567.89,
  isMentor: true,
  birthday: "2026-03-01T10:30:00.000Z",
  team: "beta",
  teams: ["alpha", "beta"],
  tier: "alpha",
};

/** A read value as it should equal what was written: dates compared by their instant. */
function asWritten(field: string, value: unknown): unknown {
  if (field !== "birthday") return value;
  if (value === null || value === undefined) return value;
  const instant = new Date(value as string | Date);
  return Number.isNaN(instant.getTime())
    ? "Invalid Date"
    : instant.toISOString();
}

/** The custom fields of a read user, as written. */
function customOf(user: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(VALUES).map(field => [field, asWritten(field, user[field])])
  );
}

describe.each(getConfiguredTestDialects())(
  "a custom user field's value, written and read back (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let direct: Direct;
    let ownerId: string;
    let cookie: string;

    /** One REST call, signed in as the install's owner. */
    function rest(
      method: "GET" | "PATCH",
      path: string[],
      body?: unknown
    ): Promise<Response> {
      const handlers = createDynamicHandlers();
      return handlers[method](
        new Request(`http://localhost/api/${path.join("/")}`, {
          method,
          headers: {
            cookie,
            origin: "http://localhost",
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        { params: Promise.resolve({ params: path }) }
      );
    }

    /** The user_ext table, as the user fields page provisions it after a change. */
    async function provision(): Promise<void> {
      const schema = t.getService(
        "userExtSchemaService"
      ) as unknown as UserExtSchemaService;
      await schema.reloadMergedFields();
      await schema.ensureUserExtSchema(t.adapter.getDrizzle());
    }

    beforeAll(async () => {
      t = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      direct = t.nextly as unknown as Direct;
      const seeder = t.getService("permissionSeedService") as unknown as {
        seedSystemPermissions: () => Promise<unknown>;
      };
      await seeder.seedSystemPermissions();
      const definitions = t.getService(
        "userFieldDefinitionService"
      ) as unknown as UserFieldDefinitionService;
      for (const field of FIELDS) {
        await definitions.createField(
          field as Parameters<UserFieldDefinitionService["createField"]>[0]
        );
      }
      await provision();
      // The install's first account is its owner, whom REST signs in as.
      ownerId = (
        await direct.users.create({
          email: "owner@example.com",
          password: "Password123!",
          data: { name: "Owner", isActive: true },
        })
      ).item.id;
      cookie = `nextly_session=${await signAccessToken(
        buildClaims({
          userId: ownerId,
          email: "owner@example.com",
          name: "Owner",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      )}`;
    }, 120_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    it("gives back each value written through the Direct API", async () => {
      const { id } = (
        await direct.users.create({
          email: "direct@example.com",
          password: "Password123!",
          data: { name: "Direct", isActive: true, ...VALUES },
        })
      ).item;

      const read = await direct.users.findByID({ id });
      expect(customOf(read)).toEqual(customOf(VALUES));
    });

    it("gives back each value written through REST", async () => {
      const { id } = (
        await direct.users.create({
          email: "rest@example.com",
          password: "Password123!",
          data: { name: "Rest", isActive: true },
        })
      ).item;

      const patched = await rest("PATCH", ["users", id], VALUES);
      expect(patched.status, await patched.clone().text()).toBe(200);
      const res = await rest("GET", ["users", id]);
      expect(res.status, await res.clone().text()).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      const read = (body.item ?? body) as Record<string, unknown>;
      expect(customOf(read)).toEqual(customOf(VALUES));
    });

    it("refuses a text longer than its field holds", async () => {
      const { id } = (
        await direct.users.create({
          email: "long@example.com",
          password: "Password123!",
          data: { name: "Long", isActive: true },
        })
      ).item;

      await expect(
        direct.users.update({ id, data: { shortBio: "b".repeat(81) } })
      ).rejects.toThrow();
      // Positive control: the same field takes a value of its length.
      await direct.users.update({ id, data: { shortBio: "b".repeat(80) } });
      const read = await direct.users.findByID({ id });
      expect(read.shortBio).toBe("b".repeat(80));
    });

    it.runIf(dialect === "postgresql")(
      "leaves a number column an earlier release made REAL as it is, working and reported",
      async () => {
        /** The column's type in the database. */
        async function typeOfScore(): Promise<unknown> {
          const [row] = await t.adapter.executeQuery<{ data_type: string }>(
            "SELECT data_type FROM information_schema.columns WHERE table_name = 'user_ext' AND column_name = 'score'"
          );
          return row?.data_type;
        }
        // Positive control: this release makes it DOUBLE PRECISION.
        expect(await typeOfScore()).toBe("double precision");
        // As an install made before has it.
        await t.adapter.executeQuery(
          'ALTER TABLE "user_ext" ALTER COLUMN "score" TYPE REAL'
        );
        expect(await typeOfScore()).toBe("real");

        // A start provisions user_ext again, as it does on every boot and in `nextly migrate`.
        await provision();
        expect(await typeOfScore()).toBe("real");

        // It is still read and written, at the precision it holds.
        const { id } = (
          await direct.users.create({
            email: "legacy@example.com",
            password: "Password123!",
            data: { name: "Legacy", isActive: true, score: 2.5 },
          })
        ).item;
        expect((await direct.users.findByID({ id })).score).toBe(2.5);

        // The column report names it as differing, and changes nothing.
        const definition: EntityDefinition = {
          fields: FIELDS as EntityDefinition["fields"],
          localized: false,
          origin: "userFields",
        };
        const users: RepairEntity = {
          kind: "userFields",
          slug: "users",
          table: "user_ext",
          applied: { ...definition, source: "registry" },
          configured: definition,
        };
        const findings = await findColumnDifferences({
          db: t.adapter.getDrizzle(),
          dialect: "postgresql",
          entities: [users],
        });
        const score = findings.find(
          finding =>
            "column" in finding &&
            String((finding as { column?: unknown }).column) === "score"
        );
        expect(score?.kind).toBe("differs");
        expect(await typeOfScore()).toBe("real");
      }
    );
  }
);
