/**
 * A stored `custom` read rule whose constraint filters on a LOCALIZED field of
 * the collection it guards, as a real module so the access service's dynamic
 * `import(functionPath)` can load it.
 *
 * A localized field has no column on the main table — its values live in the
 * collection's `_locales` companion, one row per language — so the predicate can
 * only be applied as a subquery against that table, in a named language.
 */
export default function localizedTargetReadRule({
  req,
}: {
  req: { user?: { id?: string } };
}): unknown {
  switch (req.user?.id) {
    // Readable only where the translation being read says "emea".
    case "emea-only":
      return { region: { equals: "emea" } };
    // A predicate naming only a field the MAIN table has. Nothing here needs a
    // companion, so nothing should be looked up for it.
    case "title-only":
      return { title: { equals: "EMEA page" } };
    // A dotted path on the same localized field. Translation discards the
    // suffix and compares the base value, which is a DIFFERENT predicate rather
    // than a narrower one, so it must be refused however it is stored.
    case "dotted-localized":
      return { "region.code": { equals: "emea" } };
    default:
      return true;
  }
}
