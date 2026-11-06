/**
 * Every write that changes a blocks value is judged again inside its own
 * transaction, after it is stored and while it holds the composition graph
 * lock (`composition-graph-lock`).
 *
 * The blocks field's validation judges a write before the write's transaction
 * opens, against the graph as it then stands. Two writes made at once can each
 * pass against a graph without the other, and together store a component loop
 * or a page composed past the depth limit. Here, in core's in-transaction
 * phase, the write locks the graph and its stored value is judged against
 * every definition as last committed: a second writer waits at the lock until
 * the first commits, and then judges against what the first stored. A write
 * this refuses is rolled back whole.
 *
 * Only what depends on other documents is judged again: loops, the composed
 * nesting, depth and slot locks of the document, and for a component the
 * documents placing it (`compositionGraphIssues`). Everything else was judged by the validation
 * already, and nothing another write commits can change it.
 *
 * The lock is taken only by a write whose blocks value or status changed, so a
 * write to a collection holding no blocks field, or one leaving its blocks
 * alone, never waits on it. Collections and Singles alike.
 *
 * Blocks values inside a repeater's rows or a field-group instance are not
 * judged here: they are left to validation.
 *
 * @module composition-rejudge
 */
import { isPlainRecord } from "@nextlyhq/blocks-engine";
import {
  NextlyError,
  type InTransactionContext,
  type PluginContext,
  type PluginFieldWrite,
} from "@nextlyhq/plugin-sdk";

import { indexHostFinder } from "./component-hosts";
import { componentUsageIndex } from "./component-usage";
import { holdCompositionGraph } from "./composition-graph-lock";
import {
  compositionGraphIssues,
  type CompositionSetup,
  type HostFinder,
} from "./fields/blocks-composition";
import { BLOCKS_TYPE } from "./fields/blocksField";
import { readStoredJson, sameStoredValue } from "./stored-json";
import { usageTableOf, usageTableRows } from "./usage-index-tables";

/** How a Single's writes are named to the in-transaction phase. */
const SINGLE_PREFIX = "single:";

/**
 * Judge every write that changes a blocks value again in its transaction,
 * under the graph lock. `setup` is read per write: it exists once the plugin is
 * installed.
 */
export function registerCompositionRejudge(
  ctx: Pick<PluginContext, "hooks" | "dialect">,
  setup: () => CompositionSetup | undefined
): void {
  ctx.hooks.onInTransaction("*", async write => {
    const judging = setup();
    if (judging === undefined) return;
    const issues = await rejudgedIssues(write, judging, ctx.dialect);
    if (issues.length > 0) throw NextlyError.validation({ errors: issues });
  });
}

/** The issues one stored write raises, judged under the lock. */
async function rejudgedIssues(
  write: InTransactionContext,
  setup: CompositionSetup,
  dialect: PluginContext["dialect"]
): Promise<{ path: string; code: string; message: string }[]> {
  if (write.operation === "delete" || write.data === undefined) return [];
  const data = write.data;
  const original = write.originalData;
  const statusChanged = !sameStoredValue(data.status, original?.status);
  // Every blocks field the collection declares, from its schema: a value
  // shaped like a document in another field is no blocks value.
  const changed = (await write.fieldPaths(BLOCKS_TYPE)).filter(
    path =>
      statusChanged ||
      !sameStoredValue(valueAt(data, path), valueAt(original, path))
  );
  if (changed.length === 0) return [];

  const single = write.collection.startsWith(SINGLE_PREFIX);
  const fieldWrite: PluginFieldWrite = single
    ? {
        kind: "single",
        slug: write.collection.slice(SINGLE_PREFIX.length),
        inTransaction: true,
        readStored: target => write.readStored(BLOCKS_TYPE, target),
      }
    : {
        kind: "collection",
        slug: write.collection,
        id: write.id,
        inTransaction: true,
        readStored: target => write.readStored(BLOCKS_TYPE, target),
      };

  await holdCompositionGraph(write.db, dialect);
  const judging: CompositionSetup = {
    ...setup,
    hostsOf: hostsOnTransaction(write),
    hostsInTransaction: true,
    // Said by the validation already, which judged every host it could not
    // vouch for before the transaction opened.
    onUnjudged: undefined,
    // Lists are judged by their shape here: their schema is read on another
    // connection, and nothing another write commits changes it.
    listFields: undefined,
  };
  // A held working draft is the only form the write changed.
  const nextStatus =
    data._isWorkingDraft === true || typeof data.status !== "string"
      ? undefined
      : data.status;
  const issues: { path: string; code: string; message: string }[] = [];
  for (const path of changed) {
    issues.push(
      ...(await compositionGraphIssues(
        readStoredJson(valueAt(data, path)),
        {
          write: fieldWrite,
          path,
          nextStatus,
          before: readStoredJson(valueAt(original, path)),
        },
        judging
      ))
    );
  }
  return issues;
}

/** The value at a dotted path, or undefined where the path holds none. */
function valueAt(
  data: Record<string, unknown> | undefined,
  path: string
): unknown {
  let at: unknown = data;
  for (const segment of path.split(".")) {
    const record = readStoredJson(at);
    if (!isPlainRecord(record)) return undefined;
    at = record[segment];
  }
  return at;
}

/**
 * The documents placing a component, as the usage index lists them, read on
 * the write's own transaction. Whether the index lists every document was the
 * validation's to warn about; under the lock only what it lists is judged.
 */
function hostsOnTransaction(write: InTransactionContext): HostFinder {
  const listed = indexHostFinder({
    rows: () => usageTableRows(write.db, usageTableOf(componentUsageIndex)),
    health: () =>
      Promise.reject(
        NextlyError.internal({
          logContext: { reason: "usage-health-read-under-graph-lock" },
        })
      ),
  });
  return {
    whole: () => Promise.resolve(true),
    placing: ids => listed.placing(ids),
  };
}
