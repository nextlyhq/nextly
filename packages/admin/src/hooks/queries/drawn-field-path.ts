/**
 * Which server paths an entry form draws a field for.
 *
 * Shared by the create and update hooks, which put a refused save's reasons
 * on the form's fields: a reason set on a path the form does not draw is kept
 * and shown nowhere, so those hooks ask this first and toast the rest.
 *
 * "Draws" is the form's own decision, `viewFieldRefusal` over the field and
 * the unnamed groups around it: a field `admin.hidden` hides, one a hidden
 * group around it hides, and one whose condition does not hold right now are
 * not drawn, so their reasons go to the toast.
 *
 * @module hooks/queries/drawn-field-path
 */
import { viewFieldRefusal } from "@admin/components/features/entries/EntryForm/document-view-field-gate";
import { pathOnForm } from "@admin/lib/errors/error-mapping";
import { addressableFieldsWithin } from "@admin/lib/plugins/document-view-registry";

/** Nothing to read: a condition is judged against no value. */
const NO_VALUES = (): unknown => undefined;

/**
 * Whether the form drawing `fields` has a field at a server path, judged by
 * the path's first step against the fields the form addresses at its top
 * level (an unnamed group's fields among them) and draws at the moment it is
 * asked. `valueAt` reads the form's value at a path, for the conditions; a
 * condition read without it holds only where its rule holds for no value, so
 * a reason is sent to the toast rather than to a field that may be hidden.
 * `undefined` without fields, which leaves every path to the form.
 */
export function drawnFieldPath(
  fields: readonly { name?: string }[] | undefined,
  valueAt: (path: string) => unknown = NO_VALUES
): ((path: string) => boolean) | undefined {
  if (fields === undefined) return undefined;
  const addressable = addressableFieldsWithin(fields).filter(
    ({ path }) => path !== ""
  );
  return path => {
    const drawn = addressable.filter(
      ({ field, within, bases }) =>
        viewFieldRefusal({ declaration: field, within, bases }, valueAt) !==
        "hidden"
    );
    return pathOnForm(new Set(drawn.map(each => each.path)))(path);
  };
}
