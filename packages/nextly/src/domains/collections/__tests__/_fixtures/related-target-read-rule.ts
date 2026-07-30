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
  req: { user?: { id?: string; blockedId?: string; tenant?: string } };
  id?: string;
}): unknown {
  switch (req.user?.id) {
    // Refuses the caller outright, whatever they ask for. `always` is refused
    // too: the Single read rule admits that caller, so the pair describes a
    // readable document whose relationship target is not readable.
    case "denied":
    case "always":
      return false;
    // Everything except one document. Evaluated without the id this reads as
    // "allowed" and hands back the one row it exists to withhold.
    case "blocked-one":
      return id !== req.user?.blockedId;
    // Refuses one named row and admits the rest, so a list-valued relationship
    // ends up part readable and part refused.
    case "partial":
      return id !== req.user?.blockedId;
    // Answers with a PREDICATE rather than a verdict: the caller may read the
    // collection, but only the rows matching their tenant.
    case "tenant-scoped":
      return { tenant: { equals: req.user?.tenant } };
    // Answers DIFFERENTLY depending on the row asked about: unrestricted when
    // asked in general, tenant-scoped for a concrete document. A narrowing
    // resolved without the id would be the weaker of the two.
    case "id-varying":
      return id === undefined ? true : { tenant: { equals: req.user?.tenant } };
    default:
      return true;
  }
}
