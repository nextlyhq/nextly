/**
 * Whether a field is virtual: declared on the entity, stored nowhere.
 *
 * The root `virtual` flag is the spelling every field type accepts; group and
 * repeater keep their documented `options.virtual` spelling working beside it.
 *
 * A leaf module with no imports on purpose. The column descriptor asks it to
 * decide that the field has no column, and the localization classifier asks it
 * to decide that the field has no translatable storage either; the classifier
 * is part of the public config surface, which must not pull the descriptor's
 * dependency tree in to answer one flag.
 */
export function isVirtualField(field: {
  virtual?: unknown;
  options?: unknown;
}): boolean {
  if (field.virtual === true) return true;
  return (
    typeof field.options === "object" &&
    field.options !== null &&
    (field.options as { virtual?: unknown }).virtual === true
  );
}
