/**
 * Every write path offers every domain's pass, or none of them is trustworthy.
 *
 * A retention pass only ever runs because some write path offered it. So a call
 * site that names the policies it wants decides, silently and locally, which
 * tables this install prunes — and the failure is invisible from the
 * configuration, which still reads as a bounded window.
 *
 * That is not hypothetical. `email_deliveries` shipped reachable from exactly
 * one of eight runner call sites, the send path, on the reasoning that sends
 * are what make it grow. True while an install is sending, and useless once it
 * stops: the newest rows are the ones left, and nothing offers another pass.
 *
 * `retentionPoliciesFrom` makes the list one thing. This file is what stops a
 * NEW call site from going back to naming policies by hand.
 *
 * IT IS A SCAN, and a scan is weaker than a boundary — it reads source text and
 * can only ever be as good as its pattern. The boundary version would make the
 * per-domain fields unsupplyable except through the helper, which cannot be done
 * without changing the shape every call site and test passes today. Recorded as
 * a known limit rather than left to look complete.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveAuditRetentionConfig } from "../../audit/retention-config";
import {
  activeEmailRetention,
  emailRetentionAfterTransform,
  resolveEmailRetentionConfig,
} from "../../email/retention-config";
import { resolveWebhookRetentionConfig } from "../../webhooks/retention-config";
import { buildRetentionPasses, retentionPoliciesFrom } from "../passes";

const SRC = join(__dirname, "..", "..", "..");

/** Every `.ts` file under `src`, excluding tests. */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      sourceFiles(full, found);
    } else if (entry.endsWith(".ts") && !entry.includes(".test.")) {
      found.push(full);
    }
  }
  return found;
}

/**
 * The text of each `buildRetentionRunner({ ... })` argument in a file.
 *
 * Balanced on braces rather than stopping at the first `}`, because the
 * argument contains nested object literals and a naive cut would truncate
 * mid-call and read as compliant.
 */
function runnerCallArguments(source: string): string[] {
  const calls: string[] = [];
  const marker = "buildRetentionRunner({";
  let at = source.indexOf(marker);

  while (at !== -1) {
    let depth = 0;
    let index = at + marker.length - 1;
    for (; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(at, index + 1));
    at = source.indexOf(marker, index);
  }

  return calls;
}

describe("how write paths choose their retention passes", () => {
  it("has no call site naming policies by hand", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("buildRetentionRunner({")) continue;

      for (const call of runnerCallArguments(source)) {
        if (!call.includes("retentionPoliciesFrom")) {
          offenders.push(file.slice(SRC.length + 1));
        }
      }
    }

    // Named rather than counted: a bare count tells the next reader a rule was
    // broken without saying where, and this rule is only ever broken by
    // someone adding a call site who did not know it existed.
    expect(offenders).toEqual([]);
  });

  it("finds the call sites it claims to be checking", () => {
    // The control, and the reason the case above is evidence of anything. A
    // matcher that found nothing would report a clean sweep, and so would a
    // renamed function, a moved directory, or a typo in the marker.
    const scanned = sourceFiles(SRC).filter(file =>
      readFileSync(file, "utf8").includes("buildRetentionRunner({")
    );

    expect(scanned.length).toBeGreaterThanOrEqual(6);
  });

  it("reads a hand-named call site as an offender", () => {
    // The other half of the control: the scanner must actually REJECT the
    // shape it exists to reject. Run against a synthetic source rather than
    // against the tree, so this stays true after the tree is clean.
    const handNamed = `
      const runner = buildRetentionRunner({
        adapter,
        webhookPolicy: config.webhookRetention,
        auditPolicy: config.auditRetention,
        gate: new MetaRetentionGate(adapter),
        logger,
      });
    `;

    const calls = runnerCallArguments(handNamed);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain("retentionPoliciesFrom");
  });

  it("does not truncate a call containing nested objects", () => {
    // The failure that would make the scan pass on everything: cutting at the
    // first `}` ends the call before the spread and reads every site as an
    // offender, or ends it after and reads a nested literal as the whole call.
    const nested = `
      buildRetentionRunner({
        adapter,
        ...retentionPoliciesFrom({ webhookRetention, auditRetention }),
        gate: new MetaRetentionGate(adapter),
      });
    `;

    const [call] = runnerCallArguments(nested);
    expect(call).toContain("retentionPoliciesFrom");
    expect(call).toContain("MetaRetentionGate");
  });
});

describe("the derived policy list", () => {
  it("carries every domain the pass builder knows how to prune", () => {
    // The list and the builder are two halves of one question, so a domain
    // added to the builder and forgotten here would build no pass for anyone.
    const passes = buildRetentionPasses({
      adapter: {} as never,
      gate: {} as never,
      ...retentionPoliciesFrom({
        webhookRetention: resolveWebhookRetentionConfig({}),
        auditRetention: resolveAuditRetentionConfig({}),
        emailRetention: resolveEmailRetentionConfig(),
      }),
    });

    const keys = passes.map(pass => pass.key).sort();
    expect(keys).toEqual([
      "audit.retention.lastPassAt",
      "email.retention.lastPassAt",
      "webhooks.retention.lastPassAt",
    ]);
  });

  it("resolves the NESTED email block when nothing flattened it", () => {
    // `registerServices()` is public. A caller using it directly supplies
    // `email: { retention }` -- the flattened `emailRetention` field is
    // produced only by `sanitizeConfig` + `buildServiceConfig`. Reading just
    // the flat field left those installs with no pass while their
    // configuration plainly asked for one.
    const policies = retentionPoliciesFrom({
      email: { retention: { maxAgeMs: 1234 } },
    });

    expect(policies.emailPolicy?.maxAgeMs).toBe(1234);
  });

  it("prefers an already-flattened policy over the nested block", () => {
    // The sanitized path is authoritative: it has already applied defaults and
    // bounds, and re-resolving from the raw block could disagree with what the
    // rest of initialization is using.
    const flattened = resolveEmailRetentionConfig({ maxAgeMs: 999 });

    const policies = retentionPoliciesFrom({
      emailRetention: flattened,
      email: { retention: { maxAgeMs: 1234 } },
    });

    expect(policies.emailPolicy).toBe(flattened);
  });

  it("gives an install with no email block the default window", () => {
    // Matches `sanitizeConfig`, which resolves the same defaults whether or not
    // an `email` block exists -- a delivery log written by an admin-managed
    // provider is bounded by default rather than growing until someone notices.
    expect(retentionPoliciesFrom({}).emailPolicy?.maxAgeMs).toBe(
      resolveEmailRetentionConfig().maxAgeMs
    );
  });

  it("gives the writer and the sweep the same answer", () => {
    // They are two halves of one policy. While the runner resolved the nested
    // block and the writer read only the flattened field, an install
    // configuring `email.retention.maxAgeMs: 0` through the public
    // `registerServices()` API got a sweep that honoured "keep nothing" and a
    // writer that inserted the recipient row anyway.
    const nested = { email: { retention: { maxAgeMs: 0 } } };

    // What the SWEEP is built from, and what the WRITER must consult, are the
    // same expression rather than two that happen to agree today.
    expect(retentionPoliciesFrom(nested).emailPolicy?.maxAgeMs).toBe(0);
    expect(
      activeEmailRetention(retentionPoliciesFrom(nested).emailPolicy)?.maxAgeMs
    ).toBe(0);
  });

  it("keeps a transformer's decision, and reverts nothing on a reload", () => {
    // A plugin `setup()` that sets `email.retention: false` must survive every
    // later merge. `sanitizeConfig` computed the flattened policy BEFORE the
    // transformer ran, so any code that carries the flattened value forward
    // instead of re-deriving it silently restores the pre-transform default —
    // and starts deleting rows the live configuration was retaining.
    const preTransform = resolveEmailRetentionConfig({ maxAgeMs: 1000 });

    expect(
      emailRetentionAfterTransform({ retention: false }, preTransform)?.maxAgeMs
    ).toBe(false);
  });

  it("says nothing about email when the transformer did not", () => {
    // The control. Absence of an `email` block means the transformer had no
    // opinion, NOT that it asked for defaults — reading it as defaults would
    // overwrite a policy the base config had already resolved.
    const base = resolveEmailRetentionConfig({ maxAgeMs: 1000 });

    expect(emailRetentionAfterTransform(undefined, base)).toBe(base);
  });

  it("builds no pass for a config that configured none", () => {
    // The control against the case above passing because the builder always
    // emits three.
    expect(
      buildRetentionPasses({
        adapter: {} as never,
        gate: {} as never,
        ...retentionPoliciesFrom(undefined),
      })
    ).toEqual([]);
  });
});
