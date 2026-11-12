/**
 * What a code access rule is told about the site, built from a configuration:
 * the one construction a start registers its services with and a command
 * builds for itself, so a rule asked by `nextly migrate` or a plugin's install
 * answers as it does at a start.
 *
 * A rule is told who asks, the operation, and the languages the operation is
 * in. The languages come from the configuration's `localization` and the ones
 * stored in Settings (`LanguageRegistry`), and whether an entity's content
 * differs by language from its declaration (`auth/access/rule-language`), both
 * read from the registered services. A command registers none, so for the
 * length of its asking it lends them, built here from its own configuration.
 *
 * @module init/code-rule-context
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { Container, container } from "../di/container";
import type { NextlyServiceConfig } from "../di/register";
import { LanguageRegistry } from "../domains/i18n/language-registry";
import { storedLanguageReader } from "../domains/i18n/stored-language-reader";
import type {
  CollectionAccessControl,
  SingleAccessControl,
} from "../shared/types/access";

/** The parts of a configuration a rule's context is built from. */
export type RuleContextConfig = Pick<
  NextlyServiceConfig,
  | "collections"
  | "singles"
  | "fieldGroups"
  | "localization"
  | "perLanguageStorage"
>;

/** A collection or Single with the code-defined access its configuration gives it. */
export type CodeDefinedAccessTarget =
  | { kind: "collection"; slug: string; access: CollectionAccessControl }
  | { kind: "single"; slug: string; access: SingleAccessControl };

/**
 * Each collection and Single the configuration gives code-defined access, as
 * the target its rules are registered under.
 */
export function codeDefinedAccessTargets(
  config: Pick<NextlyServiceConfig, "collections" | "singles">
): CodeDefinedAccessTarget[] {
  return [
    ...(config.collections ?? []).flatMap(collection =>
      collection.access
        ? [
            {
              kind: "collection" as const,
              slug: collection.slug,
              access: collection.access,
            },
          ]
        : []
    ),
    ...(config.singles ?? []).flatMap(single =>
      single.access
        ? [
            {
              kind: "single" as const,
              slug: single.slug,
              access: single.access,
            },
          ]
        : []
    ),
  ];
}

/** The site's languages for `config`: its own and those stored in Settings. */
export function languageRegistryFor(
  adapter: DrizzleAdapter,
  config: Pick<NextlyServiceConfig, "localization" | "perLanguageStorage">
): LanguageRegistry {
  return new LanguageRegistry({
    configured: config.localization,
    reader: storedLanguageReader(adapter),
    // A site keeping every translatable field per language stores its values under one
    // language even before it declares any.
    implicitLanguage: config.perLanguageStorage === true,
  });
}

/**
 * Runs `work` with code rules told what a start of `config` would tell them.
 * Where services are registered (a command that started Nextly, or migrations
 * at a start), they already answer and are used as they are. Otherwise the
 * configuration and its languages, the stored ones read once, are lent to the
 * container for the length of `work` and taken back after, leaving any service
 * registered meanwhile in place.
 */
export async function withRuleContextOf<T>(
  adapter: DrizzleAdapter,
  config: RuleContextConfig,
  work: () => Promise<T>
): Promise<T> {
  if (container.has("config")) return work();
  const languages = languageRegistryFor(adapter, config);
  await languages.refresh({ force: true });
  const lent = new Container();
  lent.registerSingleton("config", () => config);
  lent.registerSingleton("languageRegistry", () => languages);
  const restored = container.restore(lent);
  try {
    return await work();
  } finally {
    container.withdraw(restored);
  }
}
