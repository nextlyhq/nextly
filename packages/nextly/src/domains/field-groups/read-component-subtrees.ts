/**
 * Reading an entity's component subtrees for a durable snapshot or event.
 *
 * Collections and Singles both need this, with the same three load-bearing
 * arguments, and each carried its own copy. The arguments are the whole point
 * of having one: two of them are redaction and integrity decisions, and a copy
 * that drifts on either ships a document it should not or captures one it
 * cannot restore.
 *
 * Neutral to both domains deliberately — under `singles/` it would be a place
 * the collection path had to reach sideways into, which is how the second copy
 * gets written.
 *
 * @module domains/field-groups/read-component-subtrees
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { isFieldGroupField } from "../../collections/fields/guards";
import type { FieldConfig } from "../../collections/fields/types";
import { NextlyError } from "../../errors/nextly-error";
import type { FieldGroupDataService } from "../../services/field-groups/field-group-data-service";

export interface ReadComponentSubtreesArgs {
  /** Absent when no component service is registered; the result is then empty. */
  fieldGroupDataService: FieldGroupDataService | undefined;
  /** Read on the CALLER's transaction, for read-your-writes. */
  tx: TransactionContext;
  entryId: string;
  parentTable: string;
  fieldConfigs: FieldConfig[];
  /**
   * The locale the components were written at. Read with no fallback, so an
   * embedded localized component reports this language's own text rather than
   * another standing in for it. Undefined reads the default resolution.
   */
  locale?: string | undefined;
  /** Distinguishes the call sites in the thrown error's log context. */
  reason: string;
  logContext?: Record<string, unknown>;
  /** Called before the read failure is rethrown, for a caller that also logs. */
  onReadFailure?: (error: unknown) => void;
}

/**
 * Read a Single's component subtrees, keyed by field name.
 *
 * Always `depth: 0` and `strict: true`, and both are load-bearing rather than
 * defaults worth overriding per caller:
 *
 * - `depth: 0` keeps a component's relationship and upload references as stored
 *   ids. An expanded relationship stores the whole related row where the
 *   component write path expects an id, so restoring such a snapshot fails
 *   persistence — and it smuggles the target's own hidden and password fields
 *   past a redaction list built from this Single's tree alone.
 * - `strict: true` makes a read failure fail the write. Every caller is either
 *   assembling a durable webhook payload or capturing durable version history,
 *   and both are worse for having silently-missing component data than for not
 *   existing: one corrupts a changed-field diff, the other restores a document
 *   with subtrees blanked.
 */
export async function readComponentSubtrees({
  fieldGroupDataService,
  tx,
  entryId,
  parentTable,
  fieldConfigs,
  locale,
  reason,
  logContext,
  onReadFailure,
}: ReadComponentSubtreesArgs): Promise<Record<string, unknown>> {
  const components: Record<string, unknown> = {};
  if (!fieldGroupDataService) return components;

  const componentFields = fieldConfigs.filter(
    (f): f is typeof f & { name: string } => isFieldGroupField(f) && !!f.name
  );
  if (componentFields.length === 0) return components;

  try {
    const populated = await fieldGroupDataService.populateComponentData({
      entry: { id: entryId },
      parentTable,
      fields: fieldConfigs,
      executor: tx.getDrizzle(),
      depth: 0,
      strict: true,
      ...(locale !== undefined
        ? { locale, fallbackLocale: false as const }
        : {}),
    });
    for (const f of componentFields) {
      if (populated[f.name] !== undefined) {
        components[f.name] = populated[f.name];
      }
    }
  } catch (err) {
    onReadFailure?.(err);
    throw NextlyError.internal({
      cause: err instanceof Error ? err : undefined,
      logContext: { reason, ...logContext },
    });
  }
  return components;
}
