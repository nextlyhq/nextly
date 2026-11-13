/**
 * The names a new entity derives from its singular name: the plural and the
 * address, each followed while it still holds what the name would give.
 *
 * Shared by the new-entity dialog and the settings' Basics tab, so the two
 * derive alike.
 *
 * @module lib/builder/entity-names
 */
import type { BuilderKind } from "@admin/components/features/schema-builder/builder-config";

import { toKebabName, toSnakeName } from "./field-transformers";
import { pluralizeName } from "./pluralize-helper";

/** The names the singular name derives. */
export interface EntityNames {
  singularName: string;
  pluralName?: string;
  slug: string;
}

/**
 * The address a name derives for `kind`: kebab-case for a Single, whose entry
 * form's slug field takes kebab only, snake_case for the others. The server
 * accepts a hyphen in every kind's address; this is only what is offered.
 */
export function addressFromName(kind: BuilderKind, name: string): string {
  return kind === "single" ? toKebabName(name) : toSnakeName(name);
}

/**
 * The names once the singular name becomes `singular`.
 *
 * The plural and the address follow the name while each is EMPTY or still
 * equal to what the OLD name derived; any other value is the person's own and
 * stays. Nothing records the override: it is read from the values each time,
 * so editing a value back to the derived one resumes following, and clearing it
 * does too.
 */
export function namesFollowingName(
  kind: BuilderKind,
  names: EntityNames,
  singular: string
): EntityNames {
  const followsAddress =
    !names.slug || names.slug === addressFromName(kind, names.singularName);
  const followsPlural =
    !names.pluralName || names.pluralName === pluralizeName(names.singularName);
  return {
    singularName: singular,
    slug: followsAddress ? addressFromName(kind, singular) : names.slug,
    pluralName: followsPlural ? pluralizeName(singular) : names.pluralName,
  };
}
