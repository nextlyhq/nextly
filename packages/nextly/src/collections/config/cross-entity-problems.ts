/**
 * The configuration's rules across entities, as problems: one slug for each collection, Single
 * and field group; one table for each field group; one Single at each public address; no cycle
 * among the field groups. Each is reported with every other problem in the configuration, at its
 * place, where it is loaded or started (`configurationProblems`).
 *
 * The sentences are those `defineConfig` threw with when it judged these at import.
 *
 * @module collections/config/cross-entity-problems
 */
import {
  FIELD_GROUP_CYCLE,
  fieldGroupCycleMessage,
  fieldGroupCycleInCode,
} from "../../domains/field-groups/field-group-cycles";
import {
  ADDRESS_CLASH_REMEDY,
  singleAddressClashes,
} from "../../domains/public-addresses/distinct-public-addresses";
import { declaredPublicAddressProblem } from "../../domains/public-addresses/public-address-template";
import { resolveComponentTableName } from "../../domains/schema/utils/resolve-table-name";

/** One rule across entities broken, at the place of the entity that breaks it. */
export interface CrossEntityProblem {
  path: string;
  code: string;
  message: string;
}

/** The entities the rules are judged across, as the configuration holds them. */
export interface CrossEntityConfig {
  collections?: readonly unknown[];
  singles?: readonly unknown[];
  fieldGroups?: readonly unknown[];
}

type Kind = "collections" | "singles" | "fieldGroups";

/** An entity's slug, as one entity is told from another: compared in lowercase. */
function slugKey(entity: unknown): string | undefined {
  const slug = (entity as { slug?: unknown } | null)?.slug;
  return typeof slug === "string" ? slug.toLowerCase() : undefined;
}

function slugOf(entity: unknown): string {
  return String((entity as { slug?: unknown } | null)?.slug);
}

/** The sentence naming a slug that repeats one before it, by the kinds of the two. */
function duplicateSentence(kind: Kind, slug: string, firstKind: Kind): string {
  if (kind === "collections") {
    return `Duplicate collection slug: '${slug}'. Each collection must have a unique slug.`;
  }
  if (kind === "singles") {
    return firstKind === "collections"
      ? `Single slug '${slug}' conflicts with a Collection slug. Singles and Collections must have unique slugs.`
      : `Duplicate Single slug: '${slug}'. Each Single must have a unique slug.`;
  }
  if (firstKind === "collections") {
    return `Component slug '${slug}' conflicts with a Collection slug. Components, Collections, and Singles must have unique slugs.`;
  }
  if (firstKind === "singles") {
    return `Component slug '${slug}' conflicts with a Single slug. Components, Collections, and Singles must have unique slugs.`;
  }
  return `Duplicate Component slug: '${slug}'. Each Component must have a unique slug.`;
}

/**
 * Every rule across the entities of `config` that it breaks, each at the place of the entity that
 * breaks it: the second of two with one slug, the second of two field groups with one table, the
 * second Single at one address, the first field group of a cycle. A slug that is missing or not a
 * string is the entity's own problem, and is not compared.
 */
export function crossEntityProblems(
  config: CrossEntityConfig
): CrossEntityProblem[] {
  const problems: CrossEntityProblem[] = [];
  const collections = config.collections ?? [];
  const singles = config.singles ?? [];
  const fieldGroups = config.fieldGroups ?? [];

  // One slug each, across the three kinds, in the order the configuration declares them.
  const firstOf = new Map<string, Kind>();
  const kinds: Array<[Kind, readonly unknown[]]> = [
    ["collections", collections],
    ["singles", singles],
    ["fieldGroups", fieldGroups],
  ];
  for (const [kind, entities] of kinds) {
    entities.forEach((entity, index) => {
      const key = slugKey(entity);
      if (key === undefined) return;
      const firstKind = firstOf.get(key);
      if (firstKind !== undefined) {
        problems.push({
          path: `${kind}[${index}].slug`,
          code: "SLUG_DUPLICATE",
          message: duplicateSentence(kind, slugOf(entity), firstKind),
        });
        return;
      }
      firstOf.set(key, kind);
    });
  }

  // One table for each field group: distinct slugs can still derive one, since the resolver
  // collapses separator runs (`foo-bar` and `foo--bar` both become `comp_foo_bar`).
  const tables = new Map<string, string>();
  fieldGroups.forEach((group, index) => {
    if (slugKey(group) === undefined) return;
    const slug = slugOf(group);
    const table = resolveComponentTableName(slug);
    const first = tables.get(table);
    if (first !== undefined && first.toLowerCase() !== slug.toLowerCase()) {
      problems.push({
        path: `fieldGroups[${index}].slug`,
        code: "COMPONENT_TABLE_COLLISION",
        message:
          `Component slugs '${first}' and '${slug}' both resolve to the table '${table}'. ` +
          "Choose slugs that differ by more than their separators.",
      });
      return;
    }
    tables.set(table, slug);
  });

  // One Single at each address: compared among the Singles whose own address passes the rule.
  const addressed = singles
    .map((single, index) => ({ single, index }))
    .filter(({ single }) => {
      const entity = single as { publicAddress?: unknown; fields?: unknown };
      return (
        declaredPublicAddressProblem(
          entity.publicAddress,
          "single",
          (Array.isArray(entity.fields) ? entity.fields : []) as Parameters<
            typeof declaredPublicAddressProblem
          >[2]
        ) === null
      );
    });
  // Named by its slug, or by its place where its slug is not a string: that is its own problem,
  // reported beside this one.
  for (const { clash, sentence } of singleAddressClashes(
    addressed.map(({ single, index }) => {
      const { slug, publicAddress } = single as {
        slug?: unknown;
        publicAddress?: unknown;
      };
      return {
        slug: typeof slug === "string" ? slug : `singles[${index}]`,
        publicAddress,
      };
    })
  )) {
    const second = addressed.filter(
      ({ single }) =>
        (single as { publicAddress?: unknown }).publicAddress === clash.address
    )[1];
    problems.push({
      path: `singles[${second?.index ?? 0}].publicAddress`,
      code: "PUBLIC_ADDRESS_TAKEN",
      message: `${sentence} ${ADDRESS_CLASH_REMEDY}`,
    });
  }

  // No cycle among the field groups defined in code.
  const cycle = fieldGroupCycleInCode(
    fieldGroups.filter(group => slugKey(group) !== undefined) as Parameters<
      typeof fieldGroupCycleInCode
    >[0]
  );
  if (cycle !== null) {
    const index = fieldGroups.findIndex(
      group => slugKey(group) === cycle[0]?.toLowerCase()
    );
    problems.push({
      path: `fieldGroups[${Math.max(index, 0)}].fields`,
      code: FIELD_GROUP_CYCLE,
      message: fieldGroupCycleMessage(cycle),
    });
  }

  return problems;
}
