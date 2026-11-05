/**
 * Where the password walk may follow a field group, for one set of fields.
 *
 * A password in a field group held inline, in a group or repeater, is stored
 * in that container's value, so hashing it on a write and withholding it on
 * a read both need that field group's fields. They are looked up once per
 * field group, on the caller's connection, and only where the fields hold a
 * field group inside a container at all: fields that hold none pay no query.
 *
 * @module domains/field-groups/password-reach
 */

import type { FieldConfig } from "../../collections/fields/types";
import { hasComponentInContainer } from "../../shared/lib/entry-validation";
import {
  NO_FIELD_GROUPS,
  type FieldGroupReach,
} from "../../shared/lib/password-fields";
import { resolveComponentFieldMap } from "../versions/tag-component-types";

import {
  lookupOncePerFieldGroup,
  type FieldGroupFieldsSource,
} from "./live-read-access";

/**
 * The field groups `fields` hold inside a container, with the fields of each
 * and of every field group they reach in turn.
 *
 * Without a reader there is nothing to resolve them with, and the walk then
 * treats such a field group as unknown: a write refuses it and a read
 * withholds it, so a missing reader fails closed.
 */
export async function passwordReachOf(
  fields: readonly unknown[],
  reader: FieldGroupFieldsSource | undefined,
  executor?: unknown
): Promise<FieldGroupReach> {
  if (!hasComponentInContainer(fields as FieldConfig[])) return NO_FIELD_GROUPS;
  if (!reader) return NO_FIELD_GROUPS;
  const schemas = await resolveComponentFieldMap(
    [...fields] as FieldConfig[],
    lookupOncePerFieldGroup({
      getComponentFields: slug => reader.getComponentFields(slug, executor),
    })
  );
  return { fieldsOf: slug => schemas.get(slug) };
}
