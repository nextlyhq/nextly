/**
 * Comparing a plugin package's declaration with the plugin's own definition.
 *
 * The same facts live in both: the declaration so they can be read before any
 * code runs, the definition because it is what a site enforces at start. Two
 * copies drift, so they are compared, in the plugin's own tests through
 * `checkPluginPackageDeclaration`, and each difference is named.
 *
 * Only what the definition can say is compared. The databases, companion
 * packages, env vars, files, the live switch, the content a plugin reads and
 * writes, its public addresses and the steps before removing it have no
 * counterpart in a definition, so the declaration is the only place they are
 * said.
 *
 * @module plugins/declaration/compare
 */
import { isContentTypeScope } from "../content-type-scope";
import { pluginCollectionSlugs } from "../plugin-admin-meta";
import type { PluginDefinition } from "../plugin-context";
import { manifestSummary } from "../plugin-introspection";

import type { PluginContentTarget, PluginPackageDeclaration } from "./format";

/** @experimental Which part of a declaration disagrees with the definition. */
export type PluginDeclarationDifferenceKind =
  | "core"
  | "requires"
  | "works-with"
  | "tables"
  | "collections"
  | "singles"
  | "extends"
  | "access"
  | "steps"
  | "commands"
  | "agent-tools";

/** @experimental One way a declaration and a definition disagree, in plain words. */
export interface PluginDeclarationDifference {
  kind: PluginDeclarationDifferenceKind;
  message: string;
}

/**
 * The commands and agent tools a definition registers. A definition cannot
 * register either yet, so both are empty, and a declaration that names one
 * disagrees with its plugin until the plugin can register it. Kept as the one
 * place the comparison reads them, for the definition's operations to fill.
 */
function registeredOperations(_definition: PluginDefinition): {
  commands: string[];
  agentTools: string[];
} {
  return { commands: [], agentTools: [] };
}

/** `"a"`, `"a" and "b"`, `"a", "b" and "c"`. */
function quotedList(values: readonly string[]): string {
  const quoted = values.map(value => `"${value}"`);
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}

/**
 * The differences between two lists of names: each name only the definition
 * has, then each only the declaration has, in the words `noun` gives them.
 */
function compareNames(
  kind: PluginDeclarationDifferenceKind,
  noun: string,
  declared: readonly string[],
  defined: readonly string[]
): PluginDeclarationDifference[] {
  const inDeclaration = new Set(declared);
  const inDefinition = new Set(defined);
  const missing = [...inDefinition].filter(name => !inDeclaration.has(name));
  const extra = [...inDeclaration].filter(name => !inDefinition.has(name));
  const differences: PluginDeclarationDifference[] = [];
  if (missing.length > 0) {
    differences.push({
      kind,
      message: `The plugin's definition has the ${noun} ${quotedList(missing)}, which the declaration does not list.`,
    });
  }
  if (extra.length > 0) {
    differences.push({
      kind,
      message: `The declaration lists the ${noun} ${quotedList(extra)}, which the plugin's definition does not have.`,
    });
  }
  return differences;
}

/**
 * A version range as a definition holds it, trimmed, or nothing when it is
 * not text. A plugin written in JavaScript is not held to its types, so a
 * range it left out or gave as something else is named as a difference
 * rather than thrown on.
 */
function rangeText(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

/** A range as a sentence quotes it, or what stands for one that is missing. */
function quotedRange(value: unknown): string {
  const range = rangeText(value);
  return range === undefined ? "no range" : `"${range}"`;
}

/**
 * The differences between two maps of plugin name to version range: names
 * only one side has, and names whose ranges differ.
 */
function compareRanges(
  kind: PluginDeclarationDifferenceKind,
  noun: string,
  declaredUnder: string,
  definedUnder: string,
  declared: Readonly<Record<string, string>>,
  defined: Readonly<Record<string, unknown>>
): PluginDeclarationDifference[] {
  const differences = compareNames(
    kind,
    noun,
    Object.keys(declared),
    Object.keys(defined)
  );
  for (const [name, range] of Object.entries(defined)) {
    const said = declared[name];
    if (said !== undefined && said.trim() !== rangeText(range)) {
      differences.push({
        kind,
        message: `The declaration's ${declaredUnder} gives "${name}" the range "${said}", and the definition's ${definedUnder} gives it ${quotedRange(range)}.`,
      });
    }
  }
  return differences;
}

/** One content target as a name both sides spell the same way. */
function targetName(target: PluginContentTarget): string {
  if (typeof target === "string") return target;
  const kinds = [...new Set(target.every)].sort().join(" and ");
  const except = [...new Set(target.except ?? [])].sort();
  return except.length === 0
    ? `every ${kinds}`
    : `every ${kinds} except ${except.join(", ")}`;
}

/** The content types a definition's `contributes.extend` names, as target names. */
function extendedTargets(definition: PluginDefinition): string[] {
  const names: string[] = [];
  for (const extension of definition.contributes?.extend ?? []) {
    const { target } = extension;
    if (typeof target === "string") names.push(target);
    else if (Array.isArray(target)) names.push(...target);
    else if (isContentTypeScope(target)) {
      names.push(
        targetName({
          every: [...target.every],
          except: target.except && [...target.except],
        })
      );
    }
  }
  return [...new Set(names)];
}

/** Whether the definition and the declaration agree on one yes-or-no access. */
function compareFlag(
  declared: boolean,
  defined: boolean,
  what: string,
  where: string
): PluginDeclarationDifference[] {
  if (declared === defined) return [];
  return [
    {
      kind: "access",
      message: defined
        ? `The plugin's definition ${what} (${where}), and the declaration's access does not say so.`
        : `The declaration's access says the plugin ${what}, and its definition does not (${where}).`,
    },
  ];
}

/** The differences in what the plugin may access, in the words of `capabilities`. */
function compareAccess(
  declaration: PluginPackageDeclaration,
  definition: PluginDefinition
): PluginDeclarationDifference[] {
  // The same reading of a definition's reach that `nextly plugins info`
  // shows, so the comparison and the summary cannot disagree.
  const reach = manifestSummary(definition);
  const access = declaration.access ?? {};
  return [
    ...compareNames(
      "access",
      "outbound host",
      access.outbound ?? [],
      reach.outbound
    ),
    ...compareNames(
      "access",
      "secret setting",
      access.secrets ?? [],
      reach.secrets
    ),
    ...compareFlag(
      access.rawSql === true,
      reach.rawSql,
      "runs raw SQL",
      "capabilities.db.rawSql"
    ),
    ...compareFlag(
      access.login === true,
      reach.completesLogins,
      "decides who is signed in",
      "capabilities.auth.login or a determineUser auth hook"
    ),
  ];
}

/** The differences in whether the plugin has install and uninstall steps. */
function compareSteps(
  declaration: PluginPackageDeclaration,
  definition: PluginDefinition
): PluginDeclarationDifference[] {
  const differences: PluginDeclarationDifference[] = [];
  const steps = [
    [
      "install",
      "onInstall",
      declaration.steps?.install === true,
      definition.onInstall,
    ],
    [
      "uninstall",
      "onUninstall",
      declaration.steps?.uninstall === true,
      definition.onUninstall,
    ],
  ] as const;
  for (const [step, hook, declared, defined] of steps) {
    const has = typeof defined === "function";
    if (declared === has) continue;
    differences.push({
      kind: "steps",
      message: has
        ? `The plugin's definition has an ${step} step (${hook}), and the declaration's steps.${step} does not say so.`
        : `The declaration's steps.${step} says the plugin has an ${step} step, and its definition has no ${hook}.`,
    });
  }
  return differences;
}

/**
 * @experimental Every way `declaration` disagrees with `definition`, the
 * plugin's own definition: its Nextly range, the plugins it requires or works
 * with, what it may access, its tables, collections and Singles, the content
 * types it extends, its install and uninstall steps, and the commands and
 * agent tools it registers. Empty when they agree.
 *
 * Names are compared as the plugin declares them, before a site renames
 * anything.
 */
export function comparePluginPackageDeclaration(
  declaration: PluginPackageDeclaration,
  definition: PluginDefinition
): PluginDeclarationDifference[] {
  const differences: PluginDeclarationDifference[] = [];

  if (declaration.core.trim() !== rangeText(definition.nextly)) {
    differences.push({
      kind: "core",
      message: `The declaration says the plugin works with Nextly "${declaration.core}", and its definition says ${quotedRange(definition.nextly)}.`,
    });
  }

  differences.push(
    ...compareRanges(
      "requires",
      "required plugin",
      "plugins.requires",
      "dependsOn",
      declaration.plugins?.requires ?? {},
      definition.dependsOn ?? {}
    ),
    ...compareRanges(
      "works-with",
      "plugin it works with",
      "plugins.worksWith",
      "optionalDependsOn",
      declaration.plugins?.worksWith ?? {},
      definition.optionalDependsOn ?? {}
    ),
    ...compareAccess(declaration, definition),
    ...compareNames(
      "tables",
      "table",
      declaration.tables ?? [],
      (definition.contributes?.schema?.tables ?? []).map(table => table.name)
    ),
    ...compareNames(
      "collections",
      "collection",
      declaration.collections ?? [],
      pluginCollectionSlugs(definition)
    ),
    ...compareNames(
      "singles",
      "Single",
      declaration.singles ?? [],
      (definition.contributes?.singles ?? []).map(single => single.slug)
    ),
    ...compareNames(
      "extends",
      "extended content type",
      (declaration.extends ?? []).map(targetName),
      extendedTargets(definition)
    ),
    ...compareSteps(declaration, definition)
  );

  const operations = registeredOperations(definition);
  differences.push(
    ...compareNames(
      "commands",
      "command",
      declaration.commands ?? [],
      operations.commands
    ),
    ...compareNames(
      "agent-tools",
      "agent tool",
      declaration.agentTools ?? [],
      operations.agentTools
    )
  );

  return differences;
}
