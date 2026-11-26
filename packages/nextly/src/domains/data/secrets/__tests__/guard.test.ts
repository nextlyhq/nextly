/**
 * The secret guard leaves out what the declared list names, and refuses what
 * it cannot judge.
 *
 * Each case pairs the row that must lose something with a neighbour that must
 * not, so a guard that drops everything fails as surely as one that drops
 * nothing.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { loadDialectTables } from "../../../../database/dialect-tables";
import { NextlyError } from "../../../../errors/nextly-error";
import { digestKeyMetaKey } from "../../../../plugins/security/keyed-digest";
import { SECRET_META_KEYS } from "../core-secrets";
import { createSecretGuard, type SecretGuard } from "../guard";

// Built once the dialects are loaded: the guard reads the core schema.
let guard: SecretGuard;
beforeAll(async () => {
  await Promise.all(
    ["postgresql", "mysql", "sqlite"].map(d => loadDialectTables(d))
  );
  guard = createSecretGuard({ dialect: "postgresql" });
});

/** The reason a refusal logged, which says which rule refused. */
function refusalReason(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(NextlyError);
    return (error as NextlyError).logContext?.reason;
  }
  throw new Error("expected the guard to refuse");
}

describe("createSecretGuard", () => {
  it("keeps back every row of a table that holds credentials", () => {
    expect(
      guard.row("refresh_tokens", { id: "r1", user_id: "u1", token_hash: "h" })
    ).toBeNull();
    expect(
      guard.row("api_keys", { id: "k1", key_hash: "h", name: "Key" })
    ).toBeNull();
  });

  it("drops a table's secret columns and keeps the rest of the row", () => {
    expect(
      guard.row("nextly_webhooks", {
        id: "w1",
        name: "Deploy",
        url: "https://example.test/hook",
        headers: { authorization: "Bearer x" },
        secret_hash: ["sealed"],
        secret_prefix: "whsec_ab",
      })
    ).toEqual({ id: "w1", name: "Deploy", url: "https://example.test/hook" });
  });

  it("leaves a table with no secrets as it is", () => {
    const row = { id: "r1", name: "Editor", slug: "editor" };
    expect(guard.row("roles", row)).toEqual(row);
  });

  it("drops a password hash unless sign-in data is asked for, and a secret either way", () => {
    const user = {
      id: "u1",
      email: "a@example.test",
      password_hash: "$2b$hash",
    };
    expect(guard.row("users", user)).toEqual({
      id: "u1",
      email: "a@example.test",
    });

    const withSignIn = createSecretGuard({
      dialect: "postgresql",
      includeSignInData: true,
    });
    expect(withSignIn.row("users", user)).toEqual(user);
    expect(
      withSignIn.row("email_providers", {
        id: "p1",
        name: "SMTP",
        configuration: "sealed",
      })
    ).toEqual({ id: "p1", name: "SMTP" });
  });

  it.each([true, 1, "1", null, "yes"])(
    "keeps back a plugin setting whose is_secret reads %j",
    flag => {
      expect(
        guard.row("nextly_plugin_settings", {
          owner: "p",
          key: "apiKey",
          value: "sealed",
          is_secret: flag,
        })
      ).toBeNull();
    }
  );

  it.each([false, 0, "0", "false"])(
    "keeps a plugin setting whose is_secret reads %j",
    flag => {
      const row = {
        owner: "p",
        key: "theme",
        value: '"dark"',
        is_secret: flag,
      };
      expect(guard.row("nextly_plugin_settings", row)).toEqual(row);
    }
  );

  it.each([...SECRET_META_KEYS, digestKeyMetaKey("forms")])(
    "keeps back the meta row under %s",
    key => {
      expect(guard.row("nextly_meta", { key, value: "{}" })).toBeNull();
    }
  );

  it("keeps a plain meta row", () => {
    const plain = { key: "public-role-created", value: "true" };
    expect(guard.row("nextly_meta", plain)).toEqual(plain);
  });

  it("refuses a row of a deciding table that leaves out the deciding column", () => {
    expect(
      refusalReason(() =>
        guard.row("nextly_plugin_settings", { owner: "p", value: "x" })
      )
    ).toBe("row-without-deciding-column");
  });

  it("refuses a table nobody answered for", () => {
    expect(refusalReason(() => guard.row("dc_posts", { id: "1" }))).toBe(
      "table-without-secret-answer"
    );
  });

  it("refuses a core row keyed by property names rather than column names", () => {
    // A guard comparing `password_hash` with `passwordHash` would drop nothing.
    expect(
      refusalReason(() =>
        guard.row("users", { id: "u1", passwordHash: "$2b$hash" })
      )
    ).toBe("row-keys-are-not-column-names");
  });

  it("drops a job's input, which core cannot read", () => {
    expect(
      guard.row("nextly_jobs", { id: "j1", slug: "send", input: { link: "x" } })
    ).toEqual({ id: "j1", slug: "send" });
  });

  const pluginTables = {
    plugin_forms_tokens: {
      answer: { holds: "every-row", why: "fixture" },
      columns: ["id"],
    },
    plugin_forms_entries: {
      answer: {
        holds: "columns",
        columns: [{ name: "captcha_key", kind: "secret", why: "fixture" }],
      },
      columns: ["id", "captcha_key", "body"],
    },
  } as const;

  it("applies a writer's answer for a table outside core", () => {
    const withPlugin = createSecretGuard({
      dialect: "postgresql",
      otherTables: pluginTables,
    });
    expect(withPlugin.row("plugin_forms_tokens", { id: "t" })).toBeNull();
    expect(
      withPlugin.row("plugin_forms_entries", {
        id: "e",
        captcha_key: "k",
        body: "hi",
      })
    ).toEqual({ id: "e", body: "hi" });
  });

  it("refuses a plugin table's row keyed by property names", () => {
    const withPlugin = createSecretGuard({
      dialect: "postgresql",
      otherTables: pluginTables,
    });
    expect(
      refusalReason(() =>
        withPlugin.row("plugin_forms_entries", { id: "e", captchaKey: "k" })
      )
    ).toBe("row-keys-are-not-column-names");
  });

  it("refuses a plugin answer naming a column its table lacks", () => {
    expect(
      refusalReason(() =>
        createSecretGuard({
          dialect: "postgresql",
          otherTables: {
            plugin_forms_entries: {
              answer: pluginTables.plugin_forms_entries.answer,
              columns: ["id", "body"],
            },
          },
        })
      )
    ).toBe("answer-names-a-column-the-table-lacks");
  });

  it("refuses a second answer for a core table", () => {
    expect(
      refusalReason(() =>
        createSecretGuard({
          dialect: "postgresql",
          otherTables: {
            api_keys: { answer: { holds: "nothing" }, columns: ["id"] },
          },
        })
      )
    ).toBe("secret-answer-for-core-table");
  });

  it("drops a secret column a plugin added to a core table and keeps a plain one", () => {
    const widened = createSecretGuard({
      dialect: "postgresql",
      contributedColumns: {
        users: [
          { name: "forms_reset_code", kind: "secret" },
          { name: "forms_nickname", kind: "plain" },
        ],
      },
    });
    expect(
      widened.row("users", {
        id: "u1",
        forms_reset_code: "c",
        forms_nickname: "Ada",
      })
    ).toEqual({ id: "u1", forms_nickname: "Ada" });
    // Without the declaration, the same row is refused rather than let through.
    expect(
      refusalReason(() =>
        guard.row("users", { id: "u1", forms_reset_code: "c" })
      )
    ).toBe("row-keys-are-not-column-names");
  });

  it.each([
    [
      { api_keys: [{ name: "extra", kind: "plain" as const }] },
      "contribution-to-a-table-that-takes-none",
    ],
    [
      { users: [{ name: "email", kind: "plain" as const }] },
      "contribution-reuses-a-core-column",
    ],
  ])(
    "refuses a contribution it cannot place (%j)",
    (contributedColumns, reason) => {
      expect(
        refusalReason(() =>
          createSecretGuard({ dialect: "postgresql", contributedColumns })
        )
      ).toBe(reason);
    }
  );

  it("refuses a registry name that is another core table's", () => {
    expect(
      refusalReason(() =>
        createSecretGuard({
          dialect: "sqlite",
          fieldGroupRegistryTable: "api_keys",
        })
      )
    ).toBe("registry-name-is-a-core-table");
  });

  it("answers for the field-group registry under the name the database gives it", () => {
    const renamed = createSecretGuard({
      dialect: "sqlite",
      fieldGroupRegistryTable: "nextly_field_groups",
    });
    const row = { id: "g1", slug: "hero" };
    expect(renamed.row("nextly_field_groups", row)).toEqual(row);
  });

  it("returns only the rows that may leave", () => {
    expect(
      guard.rows("nextly_meta", [
        { key: [...SECRET_META_KEYS][0], value: "{}" },
        { key: "public-role-created", value: "true" },
      ])
    ).toEqual([{ key: "public-role-created", value: "true" }]);
  });

  it.each(["mysql", "sqlite"] as const)(
    "reads %s's columns for the same table",
    dialect => {
      const other = createSecretGuard({ dialect });
      expect(
        other.row("email_queue", { id: "q1", scope: "site", message: "sealed" })
      ).toEqual({ id: "q1", scope: "site" });
    }
  );
});
