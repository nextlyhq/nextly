import type { PluginContext } from "@nextlyhq/plugin-sdk";
import type { TestNextly } from "@nextlyhq/plugin-sdk/testing";

import { ACCOUNT_PRINCIPAL } from "../http/routes";

/** An audit row's target person, as the adapter reads it back. */
interface TargetOfRow {
  targetPrincipalKind: string | null;
  targetPrincipalId: string | null;
}

/**
 * Writes an audit row naming the account as its target, through the
 * plugin's own audit writer, as a staff action records one.
 */
export async function auditRowAbout(
  ctx: PluginContext,
  accountId: string
): Promise<void> {
  if (ctx.audit === undefined) throw new Error("expected the audit writer");
  await ctx.audit.write({
    kind: "nextlyhq-plugin-accounts.staff.sessions-ended",
    actorUserId: null,
    targetPrincipal: { kind: ACCOUNT_PRINCIPAL, id: accountId },
  });
}

/**
 * The audit rows whose target is one of the plugin's accounts: `naming` the
 * ones that still name `accountId` by its id, `all` every one of them.
 */
export async function auditRowsAbout(
  nextly: TestNextly,
  accountId: string
): Promise<{ naming: number; all: number }> {
  const rows = await nextly.adapter.select<TargetOfRow>("audit_log", {
    where: {
      and: [
        { column: "targetPrincipalKind", op: "=", value: ACCOUNT_PRINCIPAL },
      ],
    },
  });

  return {
    naming: rows.filter(row => row.targetPrincipalId === accountId).length,
    all: rows.length,
  };
}
