/**
 * A stand-in write's `readStoredOf`, answered from its `readStored`, for the
 * suites that stand a store in for core's: each id read as `readStored` reads
 * it, an id it answers absent for left out, and a failure of any one failing
 * the whole read, as core's one query fails.
 *
 * @module __tests__/stored-reads-of
 */
import type { PluginFieldWrite, PluginStoredValue } from "@nextlyhq/plugin-sdk";

/** `readStoredOf` over `readStored`, by the rules in the module docblock. */
export function readStoredOfVia(
  readStored: PluginFieldWrite["readStored"]
): PluginFieldWrite["readStoredOf"] {
  return async ({ ids, ...target }) => {
    const found = new Map<string, PluginStoredValue>();
    for (const id of new Set(ids)) {
      const read = await readStored({ ...target, id });
      if (read.kind !== "absent") found.set(id, read);
    }
    return found;
  };
}
