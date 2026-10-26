/**
 * Every answer the collection gate gives, pinned in one file.
 *
 * The gate decides by caller, rule, action and setup, and the integration
 * table asks it through real ways in on each dialect. This asks it directly,
 * over more callers and rule values than a way in can name: a role claimed on
 * the `user` object that the database does not confirm, a key whose scope
 * carries slugs without grant rows, a key holding publish without update, and
 * a rule answering a truthy value that is not `true`. Each answer is written
 * with its status and message, so a change in what a refusal says is seen as
 * well as a change in whether it refuses.
 *
 * The access-control service is the real one, with each rule registered as an
 * app registers it. Only the role and permission lookups are faked, from one
 * table of who holds what, so every way the gate reads a caller (the
 * super-admin lookup, the permission check, the rule's context and the
 * caller's roles) reads the same truth.
 *
 * When an answer moves on purpose, rerun with `-u`: the diff of
 * `collection-gate-answers.txt` is the record of what moved.
 */
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import {
  GATE_SETUPS,
  gateCallers,
  gateRules,
  type GateRule,
  type GateSetup,
} from "../../../auth/access/__tests__/gate-answer-fixtures";
import { runWithCallerScope } from "../../../auth/caller-scope";
import type { AccessOperation } from "../../../services/access";
import { RBACAccessControlService } from "../../auth/services/rbac-access-control-service";
import {
  createMockAdapter,
  createMockDb,
  silentLogger,
} from "../__tests__/collection-test-helpers";

import { CollectionAccessService } from "./collection-access-service";

vi.mock("../../../services/lib/permissions", async importOriginal =>
  (
    await import("../../../auth/access/__tests__/gate-answer-fixtures")
  ).fakePermissions(await importOriginal<object>())
);

const SLUG = "posts";

const OPERATIONS: readonly AccessOperation[] = [
  "create",
  "read",
  "update",
  "delete",
  "publish",
  "unpublish",
];

/** The gate's logger: a refusal it only returns is not logged by it. */
const logger = { ...silentLogger, info: vi.fn() };

/**
 * Every reason a refusal carried for the server's log, so each kind is seen
 * to have been reached. The gate returns it on the refusal; it is logged where
 * the refusal reaches its caller.
 */
const reasons: string[] = [];

const CALLERS = gateCallers(SLUG, OPERATIONS);
const RULES = gateRules(SLUG);

function gateFor(setup: GateSetup, rule: GateRule | undefined) {
  if (setup === "no-service") {
    return new CollectionAccessService(
      createMockAdapter(createMockDb({ rows: [] })) as never,
      logger as never
    );
  }
  const rbac = new RBACAccessControlService();
  if (rule !== undefined) {
    // The same rule for every action, so each action is asked of it.
    rbac.registerCollectionAccess(
      SLUG,
      Object.fromEntries(OPERATIONS.map(op => [op, rule]))
    );
  }
  return new CollectionAccessService(
    createMockAdapter(createMockDb({ rows: [] })) as never,
    logger as never,
    rbac
  );
}

/** Each caller's answers for one setup and rule, one line per action. */
async function answersFor(
  setup: GateSetup,
  ruleName: string,
  rule: GateRule | undefined
): Promise<string[]> {
  const gate = gateFor(setup, rule);
  const lines: string[] = [];
  for (const [callerName, caller] of Object.entries(CALLERS)) {
    lines.push(`${setup} ${ruleName} ${callerName}`);
    for (const operation of OPERATIONS) {
      const refused = await runWithCallerScope(caller.ambient, () =>
        gate.checkCollectionAccess({
          collectionName: SLUG,
          operation,
          user: caller.user,
          authenticatedScope: caller.scope,
          routeAuthorized: setup === "route-authorized",
        })
      );
      if (refused?.refusalReason) reasons.push(refused.refusalReason);
      lines.push(
        refused === null
          ? `  ${operation}:A`
          : `  ${operation}:${refused.statusCode} ${refused.message}`
      );
    }
  }
  return lines;
}

describe("the collection gate's answers", () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("are the answers the file records, for every case", async () => {
    // A rule that throws is reported by the gate that catches it.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const lines: string[] = [];
    for (const setup of GATE_SETUPS) {
      for (const [ruleName, rule] of Object.entries(RULES)) {
        // Without the service no rule is registered, so one row says it all.
        if (setup === "no-service" && ruleName !== "none") continue;
        lines.push(...(await answersFor(setup, ruleName, rule)));
      }
    }
    // POPULATION CONTROL: every kind of answer was reached.
    const text = lines.join("\n");
    expect(text).toContain(":A");
    // Both kinds of refusal were reached: a caller lacking the grant, and a
    // publish with no user. They read alike to the caller; their reasons are
    // the server's, carried on the refusal for its log.
    expect(text).toContain(":403 You can't");
    expect(reasons).toContainEqual(
      expect.stringContaining("the caller may not")
    );
    expect(reasons).toContainEqual(
      expect.stringContaining("publish on posts requires an authenticated user")
    );
    // Returned, not logged: a caller asking only whether it may is not refused.
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining("Refused"),
      expect.anything()
    );
    await expect(`${text}\n`).toMatchFileSnapshot(
      join(__dirname, "collection-gate-answers.txt")
    );
  });
});
