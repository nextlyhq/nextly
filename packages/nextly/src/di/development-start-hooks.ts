/**
 * The configuration a development start compiles its schema hooks from.
 *
 * @module di/development-start-hooks
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { compileExtensionSchema } from "../domains/schema/extension/publish";
import { NextlyError } from "../errors";
import { isProductionStart } from "../init/production-start";

import { configWithRecordedHandOversIn } from "./load-dynamic-tables";

type CompileInput = Parameters<typeof compileExtensionSchema>[0];

/**
 * `input`'s configuration with each collection handed to the Schema Builder described by its record
 * (`configWithRecordedHandOvers`), as `db:sync` and a reload compile it, so a hook one of them
 * accepted does not stop the next start.
 *
 * Where a hook fits the collection's code entry and not its record, as one on a field since removed
 * in the Builder does, the configuration as written, with a warning: a Builder save would otherwise
 * stop every start, and the admin the field could be put back in with it. Where a hook fits neither,
 * the configuration as written too, whose own compile then refuses it.
 *
 * In production the configuration as written, with no read: the migrations production runs on were
 * written from it.
 */
export async function developmentStartConfig(
  adapter: DrizzleAdapter,
  input: CompileInput
): Promise<CompileInput["config"]> {
  if (isProductionStart()) return input.config;
  const recorded = await configWithRecordedHandOversIn(adapter, input.config);
  if (recorded === input.config) return recorded;
  try {
    await compileExtensionSchema({ ...input, config: recorded });
    return recorded;
  } catch (error) {
    // Throws where the hook does not fit the entry either, as the start's own compile would.
    await compileExtensionSchema(input);
    const problem = NextlyError.is(error) ? problemOf(error) : String(error);
    input.logger.warn(
      `A schema hook does not fit a collection handed to the Schema Builder (${handedOverIn(input.config, recorded)}): ${problem} ` +
        "The start goes on with the fields of its entry in nextly.config; `nextly db:sync` and a reload refuse the hook. " +
        "Change the hook, or put the field back in the Schema Builder."
    );
    return input.config;
  }
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
