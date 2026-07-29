/**
 * A stored `custom` read rule for a relationship TARGET collection, as a real
 * module so the access service's dynamic `import(functionPath)` can load it.
 *
 * Keyed on the requested document id as well as the caller, because a rule
 * evaluated without an id behaves differently in both directions: it hides
 * rows the rule permits, and — for an exclusion written as `id !== blocked` —
 * admits the very row it forbids, since `undefined !== blocked` is true.
 *
 * The id to withhold travels on the caller rather than being hard-coded, so a
 * test can block a row whose id the database generated.
 */
export default function relatedTargetReadRule({
  req,
  id,
}: {
  req: { user?: { id?: string; blockedId?: string } };
  id?: string;
}): unknown {
  switch (req.user?.id) {
    // Refuses the caller outright, whatever they ask for.
    case "denied":
      return false;
    // Everything except one document. Evaluated without the id this reads as
    // "allowed" and hands back the one row it exists to withhold.
    case "blocked-one":
      return id !== req.user?.blockedId;
    default:
      return true;
  }
}
