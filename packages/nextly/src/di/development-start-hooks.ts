/**
 * The configuration a development start compiles its schema hooks from.
 *
 * @module di/development-start-hooks
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { ExtensionSchema } from "../domains/schema/extension/build-extension-schema";
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

/** What a start compiled its schema hooks to. */
export interface StartSchema {
  /** None where nothing declares a schema. */
  schema: ExtensionSchema | undefined;
  /** The collections handed to the Schema Builder it was compiled with, as their records had them. */
  handedOver: string;
}

/**
 * Compiles `input` with each collection handed to the Schema Builder described by its record
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
export async function compileForStart(
  adapter: DrizzleAdapter,
  input: CompileInput
): Promise<StartSchema> {
  const recorded = await startConfig(adapter, input);
  return {
    schema: await compileRecorded(input, recorded),
    handedOver: handedOverAs(input.config, recorded),
  };
}

/**
 * `compiled` as it is now: compiled again where a record it was compiled with has changed since, or
 * a collection has been handed over or taken back, and otherwise the same, its hooks not run again.
 *
 * Asked once the start holds the schema lock, which it may have waited for while a Schema Builder
 * save changed a record: the hooks are then judged by the columns the rest of the start works from.
 */
export async function compiledForNow(
  adapter: DrizzleAdapter,
  input: CompileInput,
  compiled: StartSchema
): Promise<StartSchema> {
  const recorded = await startConfig(adapter, input);
  const handedOver = handedOverAs(input.config, recorded);
  if (handedOver === compiled.handedOver) return compiled;
  return { schema: await compileRecorded(input, recorded), handedOver };
}

/** The configuration a start's hooks are judged by first: `compileForStart` says which that is. */
async function startConfig(
  adapter: DrizzleAdapter,
  input: CompileInput
): Promise<CompileInput["config"]> {
  return isProductionStart() || !declaresExtensionSchema(input)
    ? input.config
    : configWithRecordedHandOversIn(adapter, input.config);
}

/** `input` compiled with `recorded`, or with the entry's other fields beside it. */
async function compileRecorded(
  input: CompileInput,
  recorded: CompileInput["config"]
): Promise<ExtensionSchema | undefined> {
  if (recorded === input.config) return compileExtensionSchema(input);
  try {
    return await compileExtensionSchema({ ...input, config: recorded });
  } catch (error) {
    // Throws where a hook names a field neither has, as any compile would.
    const schema = await compileExtensionSchema({
      ...input,
      config: withEntryFields(input.config, recorded),
    });
    const problem = NextlyError.is(error) ? problemOf(error) : String(error);
    input.logger.warn(
      `A schema hook does not fit a collection handed to the Schema Builder (${handedOverIn(input.config, recorded).join(", ")}): ${problem} ` +
        "The start goes on, with the fields of its entry in nextly.config beside the Builder's; `nextly db:sync` and a reload refuse the hook. " +
        "Change the hook, or put the field back in the Schema Builder."
    );
    return schema;
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

/** The entries `recorded` describes by their records. */
function recordedIn(
  config: CompileInput["config"],
  recorded: CompileInput["config"]
): unknown[] {
  return (recorded.collections ?? []).filter(
    (entry, at) => entry !== config.collections?.[at]
  );
}

/** The collections `recorded` describes by their records, by slug. */
function handedOverIn(
  config: CompileInput["config"],
  recorded: CompileInput["config"]
): string[] {
  return recordedIn(config, recorded).map(entry =>
    String((entry as { slug?: unknown }).slug)
  );
}

/** Those collections as their records have them, to tell one reading from another. */
function handedOverAs(
  config: CompileInput["config"],
  recorded: CompileInput["config"]
): string {
  return JSON.stringify(recordedIn(config, recorded));
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
