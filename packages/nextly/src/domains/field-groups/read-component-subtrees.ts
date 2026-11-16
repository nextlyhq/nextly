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
import { EXACT_STORED_LANGUAGE } from "../i18n/locale-selector";

import { directFieldGroupFields } from "./field-group-write-access";

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
  /**
   * Read `locale` exactly as stored, whether or not the site has it active:
   * for a reader that must see a language Settings removed and keeps.
   */
  exactLanguage?: boolean;
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
export async function readComponentSubtrees(
  args: ReadComponentSubtreesArgs
): Promise<Record<string, unknown>> {
  const { locale, ...rest } = args;
  const read = await readComponentSubtreesByLocale({
    ...rest,
    locales: [locale],
  });
  return read.get(locale) ?? {};
}

/**
 * {@link readComponentSubtrees} for several languages at once, keyed by the
 * language asked (`undefined` for the default resolution): each component
 * table is read ONCE for them all, and each localized one's translations once
 * for every language (`_locale IN (…)`), and each language's subtrees are
 * exactly what a read of that language alone returns. For a reader holding a
 * lock while it reads, so the reads it makes do not multiply with the
 * languages.
 */
export async function readComponentSubtreesByLocale({
  fieldGroupDataService,
  tx,
  entryId,
  parentTable,
  fieldConfigs,
  locales,
  exactLanguage = false,
  reason,
  logContext,
  onReadFailure,
}: Omit<ReadComponentSubtreesArgs, "locale"> & {
  /** The languages to read; see `locale` on {@link ReadComponentSubtreesArgs}. */
  locales: readonly (string | undefined)[];
}): Promise<Map<string | undefined, Record<string, unknown>>> {
  const asked = [...new Set(locales)];
  const byLocale = new Map<string | undefined, Record<string, unknown>>(
    asked.map(locale => [locale, {}])
  );
  if (!fieldGroupDataService || asked.length === 0) return byLocale;

  // The field groups whose instances are rows read at this level, those inside a group with no
  // name among them, as the write stores them (`directFieldGroupFields`). Read from the top level
  // alone, a version or a restore's capture of such a field group held nothing.
  const componentFields = directFieldGroupFields(fieldConfigs).filter(
    (f): f is typeof f & { name: string } => isFieldGroupField(f) && !!f.name
  );
  if (componentFields.length === 0) return byLocale;

  try {
    const populated =
      await fieldGroupDataService.populateComponentDataByLanguage({
        entry: { id: entryId },
        parentTable,
        fields: fieldConfigs,
        executor: tx.getDrizzle(),
        depth: 0,
        strict: true,
        // Each named language read with no fallback, so an embedded localized
        // component reports that language's own text rather than another
        // standing in for it; no language reads the default resolution.
        languages: asked.map(locale =>
          locale !== undefined
            ? {
                locale,
                fallbackLocale: exactLanguage
                  ? EXACT_STORED_LANGUAGE
                  : (false as const),
              }
            : {}
        ),
      });
    asked.forEach((locale, index) => {
      const entry = populated[index];
      const components: Record<string, unknown> = {};
      for (const f of componentFields) {
        const value = entry?.[f.name];
        if (value !== undefined) components[f.name] = value;
      }
      byLocale.set(locale, components);
    });
  } catch (err) {
    onReadFailure?.(err);
    throw NextlyError.internal({
      cause: err instanceof Error ? err : undefined,
      logContext: { reason, ...logContext },
    });
  }
  return byLocale;
}
