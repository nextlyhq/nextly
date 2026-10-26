/**
 * Upgrade step: hash passwords stored before this release.
 *
 * An earlier release kept a password inside a container, through a field
 * group held inline in a group or repeater, as it was written. This step
 * stores each such value as a hash of itself, so the password still verifies,
 * and leaves a value already in a hasher's format alone. It reports counts
 * per collection, Single and field group, never a value.
 *
 * @module cli/commands/upgrade-steps/stored-passwords
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  countPasswordsStoredAsGiven,
  hashPasswordsStoredAsGiven,
  type StoredPasswordsSource,
  type StoredPlainPasswordCount,
} from "../../../domains/field-groups/stored-plain-passwords";
import { consoleLogger } from "../../../services/shared";
import { installRegistryResolver } from "../../utils/registry-resolver";
import type { UpgradeStep, UpgradeStepContext } from "../upgrade-step";

/** The registry installed on each adapter, so every step shares one. */
const registries = new WeakMap<
  DrizzleAdapter,
  StoredPasswordsSource["registry"]
>();

/**
 * Where the steps read, over the upgrade's connection. The CLI hands the
 * upgrade a DrizzleAdapter; its tables are resolved through a registry
 * installed here once, as every CLI command that reads through the adapter
 * installs one, and shared by the steps after, so a table one registers
 * stays resolvable for the rest.
 */
export function storedPasswordsOn(
  adapter: DrizzleAdapter
): StoredPasswordsSource {
  let registry = registries.get(adapter);
  if (!registry) {
    registry = installRegistryResolver(adapter);
    registries.set(adapter, registry);
  }
  return { adapter, registry, logger: consoleLogger };
}

/** How many passwords stored as given the counts add up to. */
export const storedPasswordTotal = (
  counts: readonly StoredPlainPasswordCount[]
) => counts.reduce((sum, entry) => sum + entry.count, 0);

/**
 * The line `nextly migrate` prints while passwords stored before this release
 * are still held as given, or `null` when none is. One wording, so the
 * notice and the step cannot drift.
 */
export function storedPasswordsNotice(count: number): string | null {
  if (count === 0) return null;
  return `${String(count)} password(s) stored before this release are not yet hashed. Run \`nextly upgrade\` to hash them.`;
}

const sourceOf = (context: UpgradeStepContext) =>
  storedPasswordsOn(context.adapter as unknown as DrizzleAdapter);

export const storedPasswordsStep: UpgradeStep = {
  title: "hash passwords stored before this release",
  pending: async context =>
    storedPasswordTotal(await countPasswordsStoredAsGiven(sourceOf(context))),
  run: async context => {
    const counts = await hashPasswordsStoredAsGiven(sourceOf(context));
    for (const { kind, slug, count } of counts) {
      context.log(`  ${kind} ${slug}: ${String(count)}`);
    }
    return storedPasswordTotal(counts);
  },
};
