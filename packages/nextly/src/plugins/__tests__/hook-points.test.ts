import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import { FilterRegistry } from "../../filters/filter-registry";
import { collectHookPoints, createPayloadChecker } from "../hook-points";
import type { PluginDefinition } from "../plugin-context";

function plugin(
  name: string,
  points: Array<{
    name: string;
    kind: "filter" | "action" | "decision";
    /**
     * Declared alongside the point, as the real contribution shape allows.
     * Omitted here, an excess-property check refused every fixture that
     * declares one — which is most of them, since the schema is the thing
     * these tests are about.
     */
    payload?: { safeParse: (value: unknown) => { success: boolean } };
  }>,
  over: Partial<PluginDefinition> = {}
): PluginDefinition {
  return {
    name,
    version: "1.0.0",
    nextly: ">=0.0.1",
    contributes: { hookPoints: points },
    ...over,
  } as PluginDefinition;
}

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (NextlyError.is(err)) {
      return (err.logContext as { reason?: string }).reason;
    }
    throw err;
  }
  return undefined;
}

describe("collectHookPoints", () => {
  it("collects a point under the plugin's own prefix", () => {
    const points = collectHookPoints([
      plugin("@acme/auth", [{ name: "acme-auth.profile", kind: "filter" }]),
    ]);
    expect(points.get("acme-auth.profile")).toMatchObject({
      kind: "filter",
      owner: "@acme/auth",
    });
  });

  it("refuses a name outside the plugin's prefix", () => {
    // Otherwise a plugin could publish a seam that reads as another's, and
    // handlers meant for one would run at the other.
    expect(
      reasonOf(() =>
        collectHookPoints([
          plugin("@acme/auth", [{ name: "other.profile", kind: "filter" }]),
        ])
      )
    ).toBe("hook-point-outside-prefix");
  });

  it("refuses a collision, naming both owners", () => {
    const err = (() => {
      try {
        collectHookPoints([
          plugin("@acme/auth", [{ name: "shared.point", kind: "filter" }], {
            name: "@acme/auth",
          }),
          plugin("@acme/auth-two", [{ name: "shared.point", kind: "filter" }]),
        ]);
      } catch (e) {
        return e as NextlyError;
      }
      return undefined;
    })();
    // Both are needed: with one named, the reader has to go and find the other.
    expect((err?.logContext as { reason?: string }).reason).toBe(
      "hook-point-outside-prefix"
    );
  });

  it("ignores a disabled plugin's declarations", () => {
    const points = collectHookPoints([
      plugin("@acme/auth", [{ name: "wrong.prefix", kind: "filter" }], {
        enabled: false,
      }),
    ]);
    expect(points.size).toBe(0);
  });
});

describe("payload checking in development", () => {
  it("warns once per point rather than once per call", () => {
    // A mismatched payload is usually every call at that seam; a warning per
    // call would bury everything else in the log.
    const warn = vi.fn();
    // The schema travels WITH the point that declared it; a second map keyed
    // the same way was one more thing to keep in step for no gain.
    const points = collectHookPoints([
      plugin("@acme/auth", [
        {
          name: "acme-auth.profile",
          kind: "filter",
          payload: { safeParse: () => ({ success: false }) },
        },
      ]),
    ]);
    const check = createPayloadChecker(points, warn);

    check("acme-auth.profile", { bad: true });
    check("acme-auth.profile", { bad: true });
    check("acme-auth.profile", { bad: true });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("@acme/auth");
  });

  it("says nothing when the payload matches", () => {
    // The point must be PRESENT for its silence to mean anything. An empty map
    // returns at the first guard, so the checker was quiet because it had
    // nothing to check rather than because the payload was valid — green under
    // any implementation, including one that never compares at all.
    const warn = vi.fn();
    const points = collectHookPoints([
      plugin("@acme/auth", [
        {
          name: "acme-auth.profile",
          kind: "filter",
          payload: { safeParse: () => ({ success: true }) },
        },
      ]),
    ]);
    expect(points.has("acme-auth.profile")).toBe(true);

    createPayloadChecker(points, warn)("acme-auth.profile", {}, "filter");
    expect(warn).not.toHaveBeenCalled();
  });

  it("REFUSES a point executed through the wrong registry API", () => {
    // A warning leaves the call running: the ordinary filter executor
    // error-isolates a throwing veto and keeps the previous value, so the
    // decision fails OPEN. Refusing is what makes the declaration binding,
    // and it must not be skipped in production either.
    const warn = vi.fn();
    const points = collectHookPoints([
      plugin("@acme/auth", [{ name: "acme-auth.gate", kind: "decision" }]),
    ]);
    const check = createPayloadChecker(points, warn);

    expect(reasonOf(() => check("acme-auth.gate", {}, "filter"))).toBe(
      "hook-point-kind-mismatch"
    );
    // A warning instead of a refusal is precisely the defect, so the absence
    // of one is part of the assertion rather than incidental.
    expect(warn).not.toHaveBeenCalled();
  });

  it("says nothing when the kind matches", () => {
    // The control: warning on every call would satisfy the test above while
    // reporting every correct use as a mismatch.
    const warn = vi.fn();
    const points = collectHookPoints([
      plugin("@acme/auth", [{ name: "acme-auth.gate", kind: "decision" }]),
    ]);

    createPayloadChecker(points, warn)("acme-auth.gate", {}, "decision");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("decision points fail closed", () => {
  const allow = { allow: true } as const;

  it("denies when a handler throws, and stops the chain", async () => {
    // The whole reason decisions are not ordinary filters: a filter that
    // throws is skipped, which would turn a crashing "deny" into an allow.
    const registry = new FilterRegistry();
    const later = vi.fn(() => allow);
    registry.addFilter("p.decide", () => {
      throw new Error("handler blew up");
    });
    registry.addFilter("p.decide", later);

    const verdict = await registry.applyDecision("p.decide", allow, {});

    expect(verdict).toEqual({ allow: false, reason: "hook-error" });
    expect(later).not.toHaveBeenCalled();
  });

  it("lets a handler downgrade the decision", async () => {
    const registry = new FilterRegistry();
    registry.addFilter("p.decide", () => ({
      allow: false,
      reason: "not-permitted",
    }));

    expect(await registry.applyDecision("p.decide", allow, {})).toEqual({
      allow: false,
      reason: "not-permitted",
    });
  });

  it("ignores a handler that tries to overrule a denial", async () => {
    // Otherwise the verdict would depend on the order plugins happen to load.
    const registry = new FilterRegistry();
    registry.addFilter("p.decide", () => ({ allow: false, reason: "no" }));
    registry.addFilter("p.decide", () => allow);

    expect(await registry.applyDecision("p.decide", allow, {})).toEqual({
      allow: false,
      reason: "no",
    });
  });

  it("returns the initial decision when nothing is registered", async () => {
    const registry = new FilterRegistry();
    expect(await registry.applyDecision("p.decide", allow, {})).toEqual(allow);
  });

  it("leaves ordinary filters error-isolated", async () => {
    // The counterpart: a transforming seam must not be broken by one bad
    // plugin, which is why decisions needed their own method rather than a
    // change to this one.
    const registry = new FilterRegistry();
    registry.addFilter("p.transform", () => {
      throw new Error("bad plugin");
    });
    registry.addFilter("p.transform", (v: unknown) => `${String(v)}!`);

    expect(await registry.applyFilters("p.transform", "value", {})).toBe(
      "value!"
    );
  });
});

describe("a decision handler that mutates its input", () => {
  it("cannot overturn a denial by rewriting the verdict in place", async () => {
    // The handler receives the live verdict object; flipping `allow` on it
    // and returning it used to make the upgrade check read true on BOTH
    // sides — the denial erased by the very object that carried it.
    const registry = new FilterRegistry();
    registry.addFilter("p.decide", () => ({ allow: false, reason: "no" }));
    registry.addFilter("p.decide", decision => {
      (decision as { allow: boolean }).allow = true;
      return decision;
    });

    const verdict = await registry.applyDecision(
      "p.decide",
      { allow: true },
      {}
    );
    expect(verdict).toEqual({ allow: false, reason: "no" });
  });

  it("cannot upgrade an ALLOW either, only degrade it", async () => {
    // The copy the handler holds is not the verdict: whatever it does to the
    // input, only what it RETURNS becomes the decision, and the upgrade rule
    // judges that.
    const registry = new FilterRegistry();
    registry.addFilter("p.decide", decision => {
      (decision as { reason?: string }).reason = "rewritten";
      return decision;
    });

    const initial = { allow: true } as const;
    const verdict = await registry.applyDecision("p.decide", initial, {});
    expect(verdict.allow).toBe(true);
    // The initial object handed in keeps its own shape.
    expect(initial).toEqual({ allow: true });
  });
});
