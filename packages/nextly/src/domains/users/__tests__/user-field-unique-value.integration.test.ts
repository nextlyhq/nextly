/**
 * A value already held in a unique custom user field is refused, on every
 * configured dialect, and the user's other custom fields keep being written.
 *
 * The write paths treated any failure of the `user_ext` write as "the table is
 * not there yet": creating a user retried without its custom fields and turned
 * them off for the rest of the process, and an update logged and carried on.
 * Once a unique field has its index, a duplicate value is the likeliest such
 * failure, so it silently dropped the user's custom fields.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLogger } from "../../../cli/utils/logger";
import { provisionUserFieldTables } from "../../../cli/commands/migrate";
import { text } from "../../../collections/fields/helpers";
import { getDialectTables } from "../../../database/index";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../schema/field-types/field-type-registry";
import { NextlyError } from "../../../errors";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { UserExtSchemaService } from "../services/user-ext-schema-service";
import { UserFieldDefinitionService } from "../services/user-field-definition-service";
import { UserMutationService } from "../services/user-mutation-service";
import type { UserConfig } from "../../../users";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const FIELDS = [
  text({ name: "employeeId", unique: true }),
  text({ name: "team" }),
];

describe.each(getConfiguredTestDialects())(
  "a unique custom user field's taken value (%s)",
  dialect => {
    let handle: TestNextly;
    let users: UserMutationService;
    const q = dialect === "mysql" ? "`" : '"';

    /** The custom field values stored for a user, read from user_ext. */
    async function stored(
      userId: unknown
    ): Promise<Record<string, unknown> | undefined> {
      const rows = await handle.adapter.executeQuery<Record<string, unknown>>(
        `SELECT ${q}employee_id${q} AS employee, ${q}team${q} AS team FROM ${q}user_ext${q} WHERE ${q}user_id${q} = '${String(userId)}'`
      );
      return rows[0];
    }

    function create(email: string, employeeId: string, team: string) {
      return users.createLocalUser({
        email,
        name: email,
        password: "TestPassword123!",
        isActive: true,
        employeeId,
        team,
      } as Parameters<UserMutationService["createLocalUser"]>[0]);
    }

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      // A sentinel account, so createLocalUser never takes the install's
      // first-account branch.
      const now = new Date();
      const tables = getDialectTables(dialect);
      await (
        handle.adapter.getDrizzle() as unknown as {
          insert(t: unknown): { values(v: unknown): Promise<unknown> };
        }
      )
        .insert(tables.users)
        .values({
          id: "sentinel",
          email: "sentinel@test.local",
          name: "Sentinel",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
      // The table and its unique index, as `nextly migrate` makes them.
      await provisionUserFieldTables(
        { fields: FIELDS },
        handle.adapter,
        createLogger({ quiet: true })
      );
      const schema = new UserExtSchemaService(
        dialect,
        new UserFieldDefinitionService(handle.adapter, silentLogger),
        silentLogger
      );
      await schema.loadMergedFields();
      users = new UserMutationService(
        handle.adapter,
        silentLogger,
        { fields: FIELDS },
        schema
      );
    });

    afterEach(async () => {
      await handle?.destroy();
    });

    it("refuses to create a user with a value another user holds, and keeps writing custom fields after", async () => {
      await create("first@test.local", "E1", "red");

      const error = await create("second@test.local", "E1", "blue").catch(
        (e: unknown) => e
      );
      expect(NextlyError.is(error)).toBe(true);
      expect((error as NextlyError).code).toBe("DUPLICATE");
      // What is logged names the constraint or column, never the value: a
      // custom field may hold personal data.
      const logged = JSON.stringify((error as NextlyError).logContext);
      expect(logged).not.toContain("E1");
      expect(logged).toMatch(/uq_user_ext_employee_id|user_ext\.employee_id/);

      // The service still writes custom fields: it took the refusal for what
      // it is, not for a missing table.
      const third = await create("third@test.local", "E3", "green");
      expect(await stored(third.id)).toMatchObject({
        employee: "E3",
        team: "green",
      });
    });

    it("refuses to update a user to a value another user holds, and leaves theirs as it was", async () => {
      await create("first@test.local", "E1", "red");
      const other = await create("other@test.local", "E2", "blue");

      const error = await users
        .updateUser(String(other.id), {
          employeeId: "E1",
        } as Parameters<UserMutationService["updateUser"]>[1])
        .catch((e: unknown) => e);
      expect(NextlyError.is(error)).toBe(true);
      expect((error as NextlyError).code).toBe("DUPLICATE");
      // What is logged names the constraint or column, never the value: a
      // custom field may hold personal data.
      const logged = JSON.stringify((error as NextlyError).logContext);
      expect(logged).not.toContain("E1");
      expect(logged).toMatch(/uq_user_ext_employee_id|user_ext\.employee_id/);
      expect(await stored(other.id)).toMatchObject({ employee: "E2" });

      // A later update still reaches user_ext.
      await users.updateUser(String(other.id), {
        team: "violet",
      } as Parameters<UserMutationService["updateUser"]>[1]);
      expect(await stored(other.id)).toMatchObject({ team: "violet" });
    });

    it("refuses the whole update when its custom field value is taken, leaving the account's own fields as they were", async () => {
      await create("first@test.local", "E1", "red");
      const other = await create("other@test.local", "E2", "blue");

      const error = await users
        .updateUser(String(other.id), {
          name: "Renamed",
          employeeId: "E1",
        } as Parameters<UserMutationService["updateUser"]>[1])
        .catch((e: unknown) => e);
      expect(NextlyError.is(error)).toBe(true);
      expect((error as NextlyError).code).toBe("DUPLICATE");

      // The account row and user_ext commit together or not at all: a refused
      // update that had already renamed the account would report a failure
      // for a change that partly happened.
      const [account] = await handle.adapter.executeQuery<{ name: string }>(
        `SELECT ${q}name${q} AS name FROM ${q}users${q} WHERE ${q}id${q} = '${String(other.id)}'`
      );
      expect(account?.name).toBe("other@test.local");
      expect(await stored(other.id)).toMatchObject({ employee: "E2" });
    });

    describe("a unique plugin field stored as text, with no maxLength", () => {
      afterEach(() => {
        clearFieldTypes();
      });

      it("refuses a value longer than its MySQL column before writing, and keeps writing custom fields", async () => {
        registerFieldType({
          type: "handle",
          storage: "text",
          component: "@acme/handles/admin#Handle",
          surfaces: ["users"],
        });
        const config = {
          fields: [...FIELDS, { name: "handle", type: "handle", unique: true }],
        } as unknown as UserConfig;
        await provisionUserFieldTables(
          config,
          handle.adapter,
          createLogger({ quiet: true })
        );
        const schema = new UserExtSchemaService(
          dialect,
          new UserFieldDefinitionService(handle.adapter, silentLogger),
          silentLogger
        );
        await schema.loadMergedFields();
        const withHandle = new UserMutationService(
          handle.adapter,
          silentLogger,
          config,
          schema
        );
        const createWith = (email: string, handleValue: string) =>
          withHandle.createLocalUser({
            email,
            name: email,
            password: "TestPassword123!",
            isActive: true,
            employeeId: email,
            team: "red",
            handle: handleValue,
          } as Parameters<UserMutationService["createLocalUser"]>[0]);

        const long = "h".repeat(300);
        const result = await createWith("long@test.local", long).catch(
          (e: unknown) => e
        );

        if (dialect === "mysql") {
          // The column is a VARCHAR(255): the value is refused as the
          // caller's, not sent to the driver to fail as a missing table.
          expect(NextlyError.isValidation(result)).toBe(true);
          const after = await createWith("after@test.local", "short");
          expect(await stored(after.id)).toMatchObject({ team: "red" });
        } else {
          // A TEXT column, indexed as it is: nothing to bound.
          expect(NextlyError.is(result)).toBe(false);
        }
      });
    });

    describe("a plugin field already stored as TEXT, made unique", () => {
      afterEach(() => {
        clearFieldTypes();
      });

      it("keeps every stored value whole, and on MySQL refuses naming the field", async () => {
        registerFieldType({
          type: "handle",
          storage: "text",
          component: "@acme/handles/admin#Handle",
          surfaces: ["users"],
        });
        const logger = createLogger({ quiet: true });
        // An install from before: the field without `unique`, so its column
        // is TEXT on every dialect, holding a value longer than a VARCHAR(255).
        await provisionUserFieldTables(
          {
            fields: [...FIELDS, { name: "handle", type: "handle" }],
          } as Parameters<typeof provisionUserFieldTables>[0],
          handle.adapter,
          logger
        );
        const user = await create("long@test.local", "E9", "red");
        const long = "h".repeat(300);
        await handle.adapter.executeQuery(
          `UPDATE ${q}user_ext${q} SET ${q}handle${q} = '${long}' WHERE ${q}user_id${q} = '${String(user.id)}'`
        );

        const result = await provisionUserFieldTables(
          {
            fields: [
              ...FIELDS,
              { name: "handle", type: "handle", unique: true },
            ],
          } as Parameters<typeof provisionUserFieldTables>[0],
          handle.adapter,
          logger
        ).catch((e: unknown) => e);

        if (dialect === "mysql") {
          // MySQL cannot index the TEXT column, and the upgrade never
          // rewrites it: `nextly migrate` stops, saying which field and why.
          expect(NextlyError.is(result)).toBe(true);
          expect((result as NextlyError).code).toBe("VALIDATION_ERROR");
          expect(JSON.stringify((result as NextlyError).logContext)).toContain(
            "handle"
          );
        } else {
          expect(result).toBeTypeOf("number");
        }
        const [row] = await handle.adapter.executeQuery<{ handle: string }>(
          `SELECT ${q}handle${q} AS handle FROM ${q}user_ext${q} WHERE ${q}user_id${q} = '${String(user.id)}'`
        );
        expect(row?.handle).toBe(long);
      });
    });
  }
);
