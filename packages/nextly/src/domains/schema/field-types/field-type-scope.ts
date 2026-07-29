/**
 * Pinning a field-type registry to one operation, on Node.
 *
 * Separate from the registry itself because that module is reachable from
 * `nextly/config` and so is bundled for the browser, where an import of
 * `node:async_hooks` cannot resolve — the bundler has no external module to
 * point it at and the build fails outright. Everything that needs to pin a
 * registry is server-side: the `db:sync` watcher, the CLI. Importing this module
 * installs the reader the registry consults; nothing imports it in a browser, so
 * there every lookup reads the live set, which is the only set that exists.
 *
 * @module domains/schema/field-types/field-type-scope
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { PluginFieldType } from "../../../plugins/contributions";

import { installScopedFieldTypeReader } from "./field-type-registry";

const scopedFieldTypes = new AsyncLocalStorage<
  ReadonlyMap<string, PluginFieldType>
>();

installScopedFieldTypeReader(() => scopedFieldTypes.getStore());

/**
 * Run `operation` with `fieldTypes` as the registry every lookup inside it sees.
 *
 * Scoped rather than installed, so a reload replacing the live set midway
 * through changes nothing for work already running, and the operation cannot
 * leave a stale set behind for anyone else. Resolution happens deep inside the
 * schema pipeline — `classifyFieldKind` reaches it from beneath
 * `getColumnDescriptor` — so an operation pins its registry for the length of
 * its async run instead of threading one through every frame in between.
 */
export function runWithFieldTypes<T>(
  fieldTypes: ReadonlyMap<string, PluginFieldType> | undefined,
  operation: () => T
): T {
  if (!fieldTypes) return operation();
  return scopedFieldTypes.run(fieldTypes, operation);
}
