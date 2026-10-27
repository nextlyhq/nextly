/**
 * A code-defined access rule is consulted for a caller with no session.
 *
 * `checkAccess` cannot answer this question. It returns `false` at `!userId`
 * before it reads the rule at all, because everything past that line resolves
 * roles and permissions from a user id. Its only caller in the collection
 * access service was gated on a truthy `user` for the same reason.
 *
 * The consequence was that `access: { create: false }` on a collection was
 * accepted at boot, recorded in the registry, and never consulted for the one
 * caller it most obviously describes: an anonymous visitor posting to a public
 * route. Nothing else asked, so the declaration was inert while looking
 * deliberate.
 *
 * These pin the three answers the evaluator owes: deny, allow, and "no opinion"
 * so the caller falls through to its public default.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearRuleFilterReports } from "../../../auth/access/rule-answer";
import { clearRuleAnswerNotices } from "../../../auth/access/rule-answer-log";
import { consoleLogger } from "../../../shared/types";

import { RBACAccessControlService } from "./rbac-access-control-service";

function service() {
  return new RBACAccessControlService();
}

describe("code-defined access for a caller with no session", () => {
  it("denies when the rule is a literal false", () => {
    // The case from the report: a host closing public creation.
    return expect(
      service().checkAnonymousCodeAccess({
        operation: "create",
        resource: "submissions",
        codeAccess: { create: false },
      })
    ).resolves.toBe(false);
  });

  it("allows when the rule is a literal true", () => {
    // The control. A check that denied everything would satisfy the assertion
    // above while closing every public form on every install.
    return expect(
      service().checkAnonymousCodeAccess({
        operation: "create",
        resource: "submissions",
        codeAccess: { create: true },
      })
    ).resolves.toBe(true);
  });

  it("runs a function rule against a real anonymous context", async () => {
    // `user` is null and both lists are empty, which is the truth about this
    // caller rather than a stand-in. A rule reading `roles` must not see roles.
    let seen: unknown;
    const allowed = await service().checkAnonymousCodeAccess({
      operation: "read",
      resource: "forms",
      codeAccess: {
        read: ctx => {
          seen = ctx;
          return !!ctx.user;
        },
      },
    });

    expect(allowed).toBe(false);
    expect(seen).toMatchObject({
      user: null,
      roles: [],
      permissions: [],
      operation: "read",
      collection: "forms",
    });
  });

  it("answers undefined when no rule governs the operation", async () => {
    // Not `false`. "No opinion" leaves the caller to its public default, and
    // returning a verdict here would close every operation a collection did
    // not happen to name.
    await expect(
      service().checkAnonymousCodeAccess({
        operation: "create",
        resource: "forms",
        codeAccess: { read: true },
      })
    ).resolves.toBeUndefined();

    await expect(
      service().checkAnonymousCodeAccess({
        operation: "create",
        resource: "forms",
        codeAccess: {},
      })
    ).resolves.toBeUndefined();
  });

  it("denies when the rule throws, rather than falling through", async () => {
    // Fail-secure, matching the authenticated path. A rule that threw did not
    // allow anything, and answering `undefined` here would hand the caller a
    // public default that allows.
    await expect(
      service().checkAnonymousCodeAccess({
        operation: "create",
        resource: "forms",
        codeAccess: {
          create: () => {
            throw new Error("rule exploded");
          },
        },
      })
    ).resolves.toBe(false);
  });
});

describe("a function rule's answer for a caller with no session", () => {
  beforeEach(() => {
    clearRuleAnswerNotices();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const answerFor = (answer: unknown) =>
    service().checkAnonymousCodeAccess({
      operation: "read",
      resource: "forms",
      codeAccess: { read: () => answer as boolean },
    });

  it("refuses on any answer but true: null, undefined and a truthy value alike", async () => {
    // Before, any answer but `false` let a visitor through, and `undefined`
    // read as "no rule", so the public default admitted them.
    for (const answer of [null, undefined, "yes", 1]) {
      await expect(answerFor(answer)).resolves.toBe(false);
    }
    // The control: only `true` allows.
    await expect(answerFor(true)).resolves.toBe(true);
  });

  it("names each newly refused rule once, and not one that refused before", async () => {
    const warn = vi.spyOn(consoleLogger, "warn").mockImplementation(() => {});
    await answerFor(null);
    await answerFor(null);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(
      'The read rule of "forms" answered null, so a visitor is now refused'
    );
    // `false` refused a visitor before too, and `true` still allows.
    await answerFor(false);
    await answerFor(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("names a rule's answer by its kind only: no value is copied, and none can fail the check", async () => {
    const warn = vi.spyOn(consoleLogger, "warn").mockImplementation(() => {});
    // A rule that hands back something it should not have: the notice says
    // what kind of answer it was, never what was in it.
    await expect(answerFor("Bearer secret-token")).resolves.toBe(false);
    expect(String(warn.mock.calls[0][0])).toContain("answered a string");
    expect(String(warn.mock.calls[0][0])).not.toContain("secret-token");
    // An answer with no JSON form, or one that refers to itself, still
    // refuses rather than failing the request.
    clearRuleAnswerNotices();
    await expect(answerFor(BigInt(1))).resolves.toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    clearRuleAnswerNotices();
    await expect(answerFor(cyclic)).resolves.toBe(false);
    // Nor an answer that throws on any inspection, such as a revoked proxy:
    // awaiting it already reads `then` and throws, which refuses as a rule
    // that threw, and the notice reads nothing of it either.
    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    clearRuleAnswerNotices();
    await expect(answerFor(revoked.proxy)).resolves.toBe(false);
  });
});

describe("a rule that answers with a filter, for a caller with no session", () => {
  /** A read rule answering `filter`, which the rule type does not allow yet. */
  const answering = (filter: unknown) => () => filter as boolean;

  beforeEach(() => {
    clearRuleFilterReports();
    clearRuleAnswerNotices();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses a well-formed filter, which this check does not apply", async () => {
    const reported = vi
      .spyOn(consoleLogger, "error")
      .mockImplementation(() => {});
    const noticed = vi
      .spyOn(consoleLogger, "warn")
      .mockImplementation(() => {});
    await expect(
      service().checkAnonymousCodeAccess({
        operation: "read",
        resource: "posts",
        codeAccess: { read: answering({ slug: { equals: "probe" } }) },
      })
    ).resolves.toBe(false);
    // A filter where one belongs is no misuse.
    expect(reported).not.toHaveBeenCalled();
    // The notice names it a filter, and does not tell its rule to answer only
    // true or false.
    expect(noticed).toHaveBeenCalledTimes(1);
    const notice = String(noticed.mock.calls[0]?.[0]);
    expect(notice).toContain('The read rule of "posts" answered a filter');
    expect(notice).toContain("does not apply a rule's filter");
    expect(notice).not.toContain("false to refuse");
  });

  it("refuses a filter that is not well formed, and reports it as that once", async () => {
    const reported = vi
      .spyOn(consoleLogger, "error")
      .mockImplementation(() => {});
    const noticed = vi
      .spyOn(consoleLogger, "warn")
      .mockImplementation(() => {});
    const ask = () =>
      service().checkAnonymousCodeAccess({
        operation: "read",
        resource: "posts",
        codeAccess: { read: answering({ slug: { in: [] } }) },
      });

    await expect(ask()).resolves.toBe(false);
    await expect(ask()).resolves.toBe(false);

    expect(reported).toHaveBeenCalledTimes(1);
    expect(String(reported.mock.calls[0]?.[0])).toContain(
      'read rule of "posts"'
    );
    // Reported as a malformed filter, not also as a truthy answer.
    expect(noticed).not.toHaveBeenCalled();
  });
});
