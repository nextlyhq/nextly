/**
 * Which server paths an entry form draws a field for.
 *
 * Shared by the create and update hooks, which put a refused save's reasons
 * on the form's fields: a reason set on a path the form does not draw is kept
 * and shown nowhere, so those hooks ask this first and toast the rest.
 *
 * @module hooks/queries/drawn-field-path
 */
import { pathOnForm } from "@admin/lib/errors/error-mapping";
import { addressableFieldsWithin } from "@admin/lib/plugins/document-view-registry";

/**
 * Whether the form drawing `fields` has a field at a server path, judged by
 * the path's first step against the fields the form addresses at its top
 * level (an unnamed group's fields among them). `undefined` without fields,
 * which leaves every path to the form, as before fields were given.
 */
export function drawnFieldPath(
  fields: readonly { name?: string }[] | undefined
): ((path: string) => boolean) | undefined {
  if (fields === undefined) return undefined;
  const names = new Set(
    addressableFieldsWithin(fields).flatMap(({ path }) =>
      path === "" ? [] : [path]
    )
  );
  return pathOnForm(names);
}
