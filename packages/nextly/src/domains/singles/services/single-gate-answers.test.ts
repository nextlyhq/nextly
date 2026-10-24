/**
 * Every answer the Single gate gives, pinned in one file.
 *
 * The same callers, rules and setups the collection gate's answer file is
 * asked over (`auth/access/__tests__/gate-answer-fixtures`), sent through
 * `checkSingleAccess` for each action a Single has. Each answer is written
 * with its status and message, so a change in what a refusal says is seen as
 * well as a change in whether it refuses.
 *
 * The access-control service is the real one, with each rule registered as an
 * app registers it. Only the role and permission lookups are faked, from one
 * table of who holds what.
 *
 * When an answer moves on purpose, rerun with `-u`: the diff of
 * `single-gate-answers.txt` is the record of what moved.
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
import { RBACAccessControlService } from "../../auth/services/rbac-access-control-service";

import { checkSingleAccess } from "./single-query-service";

vi.mock("../../../services/lib/permissions", async importOriginal =>
  (
    await import("../../../auth/access/__tests__/gate-answer-fixtures")
  ).fakePermissions(await importOriginal<object>())
);

const SLUG = "home";

const OPERATIONS = ["read", "update", "publish", "unpublish"] as const;

const CALLERS = gateCallers(SLUG, OPERATIONS);
const RULES = gateRules(SLUG);

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function serviceFor(setup: GateSetup, rule: GateRule | undefined) {
  if (setup === "no-service") return undefined;
  const rbac = new RBACAccessControlService();
  if (rule !== undefined) {
    // The same rule for every action, so each action is asked of it.
    rbac.registerSingleAccess(
      SLUG,
      Object.fromEntries(OPERATIONS.map(op => [op, rule]))
    );
  }
  return rbac;
}

/** Each caller's answers for one setup and rule, one line per action. */
/** Every reason a refusal carried for the server's log. */
const reasons: string[] = [];

async function answersFor(
  setup: GateSetup,
  ruleName: string,
  rule: GateRule | undefined
): Promise<string[]> {
  const rbacAccessControlService = serviceFor(setup, rule);
  const lines: string[] = [];
  for (const [callerName, caller] of Object.entries(CALLERS)) {
    lines.push(`${setup} ${ruleName} ${callerName}`);
    for (const operation of OPERATIONS) {
      const refused = await runWithCallerScope(caller.ambient, () =>
        checkSingleAccess({
          slug: SLUG,
          operation,
          user: caller.user,
          authenticatedScope: caller.scope,
          routeAuthorized: setup === "route-authorized",
          rbacAccessControlService,
          logger: logger as never,
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

describe("the Single gate's answers", () => {
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
    // Returned, not logged: a caller asking only whether it may is not refused.
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining("Refused"),
      expect.anything()
    );
    expect(reasons).toContainEqual(
      expect.stringContaining("the caller may not")
    );
    expect(reasons).toContainEqual(
      expect.stringContaining('publish on single "home" requires')
    );
    await expect(`${text}\n`).toMatchFileSnapshot(
      join(__dirname, "single-gate-answers.txt")
    );
  });
});
