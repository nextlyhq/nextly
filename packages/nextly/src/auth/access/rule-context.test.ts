/**
 * The one context every collection, Single and field rule is handed, and the
 * one spelling of the permissions in it.
 *
 * Each block names the property that separates the builder from a plausible
 * broken one: a list that still hands a rule the earlier `posts:read`, so a
 * rule checking it still allows, and a context that loses a property a rule
 * written against today's shapes reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makePrincipal } from "../../plugins/principals/principal";
import type { AccessRuleContext } from "../../shared/types/access";
import type { GrantedPermission } from "../authenticated-scope";

import { buildRuleContext, type RuleCaller } from "./rule-context";

const grant = (action: string, resource: string): GrantedPermission => ({
  slug: `${action}-${resource}`,
  action,
  resource,
});

const editor: RuleCaller = {
  user: { id: "u1" },
  roles: ["editor"],
  permissions: [grant("read", "posts"), grant("update", "posts")],
  principal: null,
};

const readPosts = {
  operation: "read",
  target: { kind: "collection", slug: "posts" },
} as const;

/** Hands `rule` the context the builder makes for it, and returns its answer. */
function ask<T>(
  rule: (ctx: AccessRuleContext) => T,
  caller: RuleCaller = editor,
  question: Parameters<typeof buildRuleContext>[1] = readPosts,
  entry?: Parameters<typeof buildRuleContext>[2]
): T {
  return rule(buildRuleContext(caller, question, entry));
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe("the permissions a rule is handed", () => {
  it("are spelled as the role screen spells them, so a rule checking `read-posts` allows", () => {
    expect(ask(({ permissions }) => permissions.includes("read-posts"))).toBe(
      true
    );
    expect(ask(({ permissions }) => permissions.includes("delete-posts"))).toBe(
      false
    );
  });

  it("keep a permission's stored slug where it is not `<action>-<resource>`", () => {
    const manager: RuleCaller = {
      ...editor,
      permissions: [
        { slug: "manage-api-keys", action: "update", resource: "api-keys" },
      ],
    };
    const ctx = buildRuleContext(manager, readPosts);
    expect([...ctx.permissions]).toEqual(["manage-api-keys"]);
  });

  it("carry only the role screen's spelling, never the earlier one", () => {
    const ctx = buildRuleContext(editor, readPosts);
    expect([...ctx.permissions]).toEqual(["read-posts", "update-posts"]);
  });

  it("hand a slug held without its row as stored, with no old spelling to derive", () => {
    const slugsOnly: RuleCaller = { ...editor, permissions: ["read-posts"] };
    const ctx = buildRuleContext(slugsOnly, readPosts);
    expect([...ctx.permissions]).toEqual(["read-posts"]);
  });

  it("are each grant once, however many roles grant it", () => {
    const twice: RuleCaller = {
      ...editor,
      permissions: [grant("read", "posts"), grant("read", "posts")],
    };
    const ctx = buildRuleContext(twice, readPosts);
    expect([...ctx.permissions]).toEqual(["read-posts"]);
  });
});

describe("a rule checking the earlier spelling", () => {
  it("no longer allows, and is not warned about", () => {
    // The caller holds `read-posts`, which the rule names in the spelling
    // rules were handed before; that spelling is no longer in the list.
    expect(ask(({ permissions }) => permissions.includes("posts:read"))).toBe(
      false
    );
    expect(ask(({ permissions }) => permissions.indexOf("posts:update"))).toBe(
      -1
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("is never warned for the role screen's spelling", () => {
    ask(({ permissions }) => permissions.includes("read-posts"));
    ask(({ permissions }) => permissions.lastIndexOf("update-posts") >= 0);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("the one context", () => {
  it("names the language it judges, and every language the operation involves", () => {
    const ctx = buildRuleContext(editor, {
      operation: "publish",
      target: { kind: "collection", slug: "posts" },
      locale: "fr",
      locales: ["en", "fr"],
    });
    expect(ctx.locale).toBe("fr");
    expect(ctx.locales).toEqual(["en", "fr"]);
  });

  it("names a language judged alone as the only one involved", () => {
    const ctx = buildRuleContext(editor, {
      ...readPosts,
      locale: "de",
    });
    expect(ctx.locale).toBe("de");
    expect(ctx.locales).toEqual(["de"]);
  });

  it("names no language where the operation involves none", () => {
    const ctx = buildRuleContext(editor, readPosts);
    expect(ctx.locale).toBeUndefined();
    expect(ctx.locales).toEqual([]);
  });

  it("hands each rule its own list of languages", () => {
    const locales = ["en", "fr"];
    const ctx = buildRuleContext(editor, {
      ...readPosts,
      locale: "en",
      locales,
    });
    ctx.locales.push("de");
    expect(locales).toEqual(["en", "fr"]);
  });

  it("names the caller, the operation and the target, with no entry at a collection's gate", () => {
    const ctx = buildRuleContext(editor, {
      operation: "delete",
      target: { kind: "collection", slug: "posts" },
    });
    expect(ctx.user).toEqual({ id: "u1" });
    // The caller's id and roles, as the request user a field rule reads them,
    // so a rule reading `req.user.roles` is not told the caller has none.
    expect(ctx.req.user).toEqual({ id: "u1", roles: ["editor"] });
    expect(ctx.roles).toEqual(["editor"]);
    expect(ctx.principal).toBeNull();
    expect(ctx.operation).toBe("delete");
    expect(ctx.target).toEqual({ kind: "collection", slug: "posts" });
    expect(ctx.collection).toBe("posts");
    expect("id" in ctx).toBe(false);
    expect("data" in ctx).toBe(false);
  });

  it("names a Single as a Single", () => {
    const ctx = buildRuleContext(editor, {
      operation: "update",
      target: { kind: "single", slug: "site-settings" },
    });
    expect(ctx.target).toEqual({ kind: "single", slug: "site-settings" });
    expect(ctx.collection).toBe("site-settings");
  });

  it("hands a plugin's person as the principal, with no user", () => {
    const member = makePrincipal("members:member", "m1", {});
    const ctx = buildRuleContext(
      { user: null, roles: [], permissions: [], principal: member },
      readPosts
    );
    expect(ctx.user).toBeNull();
    expect(ctx.req.user).toBeUndefined();
    expect(ctx.principal).toBe(member);
    expect([...ctx.permissions]).toEqual([]);
  });

  it("carries the request's own user object where the caller has one", () => {
    const requestUser = { id: "u1", email: "e@x.test", role: "editor" };
    const ctx = buildRuleContext({ ...editor, requestUser }, readPosts);
    expect(ctx.req.user).toBe(requestUser);
    expect(ctx.user).toEqual({ id: "u1" });
  });

  it("reads the entry where it is known, only when the rule reads it", () => {
    let read = 0;
    const entry = {
      get id() {
        read++;
        return "e1";
      },
      get data() {
        read++;
        return { owner: "u1" };
      },
    };
    const ctx = buildRuleContext(editor, readPosts, entry);
    expect(read).toBe(0);
    expect(ctx.id).toBe("e1");
    expect(ctx.data).toEqual({ owner: "u1" });
    expect(read).toBe(2);
  });

  it("answers as before for a rule written against today's collection context", () => {
    const today = ({
      user,
      roles,
      permissions,
      principal,
      operation,
      collection,
    }: {
      user: { id: string } | null;
      roles: string[];
      permissions: string[];
      principal: unknown;
      operation: string;
      collection: string;
    }) =>
      user?.id === "u1" &&
      roles.includes("editor") &&
      permissions.includes("read-posts") &&
      principal === null &&
      operation === "read" &&
      collection === "posts";
    expect(ask(today)).toBe(true);
  });

  it("answers as before for a rule written against today's field context", () => {
    const today = ({
      req,
      id,
      data,
      permissions,
      roles,
      principal,
    }: {
      req: { user?: { id?: unknown } };
      id?: string;
      data?: Record<string, unknown>;
      permissions: string[];
      roles: string[];
      principal: unknown;
    }) =>
      req.user?.id === "u1" &&
      id === "e1" &&
      data?.owner === "u1" &&
      permissions.includes("update-posts") &&
      roles.includes("editor") &&
      principal === null;
    expect(
      ask(
        today,
        { ...editor, requestUser: { id: "u1" } },
        { operation: "update", target: { kind: "collection", slug: "posts" } },
        { id: "e1", data: { owner: "u1" } }
      )
    ).toBe(true);
  });
});
