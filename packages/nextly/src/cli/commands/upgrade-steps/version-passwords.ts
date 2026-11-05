/**
 * Upgrade step: remove passwords kept in version history.
 *
 * A version's snapshot never keeps a password, yet one an earlier release
 * captured could still hold one inside a container. This step strips every
 * password from each such snapshot, leaving the rest of the version as it
 * was, and reports how many versions of each collection and Single it
 * changed, never a value.
 *
 * @module cli/commands/upgrade-steps/version-passwords
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  countVersionsHoldingPasswords,
  removePasswordsFromVersions,
} from "../../../domains/field-groups/stored-plain-passwords";
import type { UpgradeStep, UpgradeStepContext } from "../upgrade-step";

import { storedPasswordsOn, storedPasswordTotal } from "./stored-passwords";

const sourceOf = (context: UpgradeStepContext) =>
  storedPasswordsOn(context.adapter as unknown as DrizzleAdapter);

export const versionPasswordsStep: UpgradeStep = {
  title: "remove passwords kept in version history",
  pending: async context =>
    storedPasswordTotal(await countVersionsHoldingPasswords(sourceOf(context))),
  run: async context => {
    const counts = await removePasswordsFromVersions(sourceOf(context));
    for (const { kind, slug, count } of counts) {
      context.log(`  ${kind} ${slug}: ${String(count)}`);
    }
    return storedPasswordTotal(counts);
  },
};
