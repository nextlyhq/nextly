/**
 * The configuration a development start compiles its schema hooks from.
 *
 * @module di/development-start-hooks
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  compileExtensionSchema,
  declaresExtensionSchema,
} from "../domains/schema/extension/publish";
import {
  fieldsStoredOnRow,
  toSnakeCase,
} from "../domains/schema/services/field-column-descriptor";
import { NextlyError } from "../errors";
import { isProductionStart } from "../init/production-start";

import { configWithRecordedHandOversIn } from "./load-dynamic-tables";

type CompileInput = Parameters<typeof compileExtensionSchema>[0];

/**
 * `input`'s configuration with each collection handed to the Schema Builder described by its record
 * (`configWithRecordedHandOvers`), as `db:sync` and a reload compile it, so a hook one of them
 * accepted does not stop the next start.
 *
 * Where a hook names a field the record lacks and the code entry has, as one since removed in the
 * Builder is, the record with the entry's other fields beside it (`withEntryFields`), with a
 * warning: a Builder save would otherwise stop every start, and the admin the field could be put
 * back in with it. A hook on a field neither has still stops the start.
 *
 * In production the configuration as written, with no read: the migrations production runs on were
 * written from it. So too where nothing declares a schema hook, as the compile then reads no entity.
 */
export async function developmentStartConfig(
  adapter: DrizzleAdapter,
  input: CompileInput
): Promise<CompileInput["config"]> {
  if (isProductionStart() || !declaresExtensionSchema(input)) {
    return input.config;
  }
  const recorded = await configWithRecordedHandOversIn(adapter, input.config);
  if (recorded === input.config) return recorded;
  try {
    await compileExtensionSchema({ ...input, config: recorded });
    return recorded;
  } catch (error) {
    const both = withEntryFields(input.config, recorded);
    // Throws where a hook names a field neither has, as the start's own compile would.
    await compileExtensionSchema({ ...input, config: both });
    const problem = NextlyError.is(error) ? problemOf(error) : String(error);
    input.logger.warn(
      `A schema hook does not fit a collection handed to the Schema Builder (${handedOverIn(input.config, recorded)}): ${problem} ` +
        "The start goes on, with the fields of its entry in nextly.config beside the Builder's; `nextly db:sync` and a reload refuse the hook. " +
        "Change the hook, or put the field back in the Schema Builder."
    );
    return both;
  }
}

/** A field, as far as telling one from another by its column needs. */
interface NamedField {
  name?: string;
}

/** An entry of a configuration's collections, as far as its fields. */
interface WithFields {
  fields?: readonly NamedField[];
}

/**
 * `recorded` with, on each collection it describes by its record, the fields of the code entry
 * whose columns the record has none of.
 */
function withEntryFields(
  config: CompileInput["config"],
  recorded: CompileInput["config"]
): CompileInput["config"] {
  const collections = (recorded.collections ?? []).map((entry, at) => {
    const coded = config.collections?.[at];
    if (entry === coded) return entry;
    const own = (entry as WithFields).fields ?? [];
    const columns = new Set(columnsOf(own));
    const others = fieldsStoredOnRow((coded as WithFields).fields ?? []).filter(
      ({ name }) => name !== undefined && !columns.has(toSnakeCase(name))
    );
    return { ...(entry as object), fields: [...own, ...others] };
  });
  return { ...recorded, collections };
}

/** The columns `fields` occupy on the entity's own row. */
function columnsOf(fields: readonly NamedField[]): string[] {
  return fieldsStoredOnRow(fields).flatMap(({ name }) =>
    name === undefined ? [] : [toSnakeCase(name)]
  );
}

/** The collections `recorded` describes by their records, by slug. */
function handedOverIn(
  config: CompileInput["config"],
  recorded: CompileInput["config"]
): string {
  return (recorded.collections ?? [])
    .filter((entry, at) => entry !== config.collections?.[at])
    .map(entry => String((entry as { slug?: unknown }).slug))
    .join(", ");
}

/** What a refused compile says of the hook: each problem it lists, or its message. */
function problemOf(error: NextlyError): string {
  const listed = (
    error.publicData as { errors?: { message?: string }[] } | undefined
  )?.errors?.flatMap(({ message }) => (message === undefined ? [] : [message]));
  return listed === undefined || listed.length === 0
    ? error.publicMessage
    : listed.join(" ");
}
