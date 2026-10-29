/**
 * The words the roles screen uses for levels and actions.
 *
 * Kept apart from the rows themselves (`./level-rows`) so a row and its tests
 * read the same names: a level control named "Can edit" and a summary saying
 * "View and create" come from here and nowhere else.
 *
 * @module lib/permissions/level-labels
 */

import type { Permission } from "../../types/ui/form";

import type { AccessLevel } from "./levels";

/** What each level is called on the screen. */
export const LEVEL_LABELS: Readonly<Record<AccessLevel, string>> = {
  none: "No access",
  view: "Can view",
  edit: "Can edit",
  publish: "Can publish",
};

/**
 * The names of the standard actions, in the order the screen lists them.
 * An action a level decides reads as what it lets a person do: `read` is
 * View and `update` is Edit.
 */
const ACTION_LABELS: ReadonlyMap<string, string> = new Map([
  ["read", "View"],
  ["create", "Create"],
  ["update", "Edit"],
  ["delete", "Delete"],
  ["publish", "Publish"],
  ["unpublish", "Unpublish"],
]);

/**
 * What a permission's switch is called: the action's name where it is a
 * standard one, else the permission's own name, since only the resource
 * knows what an action of its own does.
 */
export function actionLabel(permission: Permission): string {
  return ACTION_LABELS.get(permission.action) ?? permission.name;
}

/**
 * The permissions of a row in the screen's order: the standard actions
 * first, as {@link ACTION_LABELS} lists them, then any other in the order
 * given.
 */
export function inActionOrder(
  permissions: readonly Permission[]
): Permission[] {
  const order = [...ACTION_LABELS.keys()];
  const rank = (permission: Permission) => {
    const at = order.indexOf(permission.action);
    return at === -1 ? order.length : at;
  };
  return [...permissions].sort((a, b) => rank(a) - rank(b));
}

/**
 * A Custom row's actions in words, for the line under its name: "View and
 * create", "View, create and edit". Only the standard actions are named,
 * since a level is read over them alone; an empty string where none is held.
 */
export function customSummary(permissions: readonly Permission[]): string {
  const words = inActionOrder(permissions).flatMap(permission => {
    const label = ACTION_LABELS.get(permission.action);
    return label === undefined ? [] : [label.toLowerCase()];
  });
  if (words.length === 0) return "";
  const sentence = listed(words);
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** Words joined as a sentence lists them: "a", "a and b", "a, b and c". */
export function listed(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * The line under a row whose collection or Single declares an access rule in
 * code, naming what the rule limits: the level the screen sets is the most a
 * role can be given, since the rule may still refuse or narrow it.
 */
export function narrowedInCode(
  kind: "collection" | "single",
  declaredRules: readonly string[]
): string {
  const actions = listed(
    declaredRules.map(rule => ACTION_LABELS.get(rule)?.toLowerCase() ?? rule)
  );
  const owner = kind === "single" ? "This Single's" : "This collection's";
  return `${owner} code also limits who can ${actions} it. The level here is the most a role can be given.`;
}
