/**
 * A stored `custom` read rule, as a real module so the access service's dynamic
 * `import(functionPath)` can load it.
 *
 * Returns a query CONSTRAINT rather than a boolean, which is the shape that
 * exposed the bug these tests guard: the constraint used to be reduced to the
 * first field's `equals` value, so a second field went unapplied and a falsy or
 * non-`equals` value applied nothing at all.
 *
 * The shape returned is chosen per-caller so one fixture covers every case the
 * tests need.
 */
export default function tenantReadRule({
  req,
}: {
  req: { user?: { id?: string } };
}): unknown {
  switch (req.user?.id) {
    // Two fields: both have to bind, or rows from the other region come back.
    case "multi-field":
      return { tenant: { equals: "acme" }, region: { equals: "eu" } };
    // A falsy value: `equals: 0` is a legitimate predicate ("free items").
    case "falsy-value":
      return { price: { equals: 0 } };
    // An operator other than `equals`.
    case "in-operator":
      return { region: { in: ["eu", "uk"] } };
    // A valid predicate beside one the translators cannot handle. Geo operators
    // reach SQL through a separate extractor, so `buildWhereClause` drops them
    // and keeps the sibling — leaving a weaker predicate that looks translated.
    case "partial-geo":
      return {
        tenant: { equals: "acme" },
        location: { within: { lat: 0, lng: 0, radius: 1 } },
      };
    // A valid predicate beside a field that is not on the table at all, which
    // `buildDrizzleCondition` skips while keeping the sibling.
    case "partial-unknown-field":
      return { tenant: { equals: "acme" }, nosuchcolumn: { equals: "x" } };
    // An empty IN list — what a rule returns when the caller has no permitted
    // ids. It should match nothing; dropped, it leaves the sibling matching
    // everything the sibling allows.
    case "empty-in":
      return { tenant: { equals: "acme" }, region: { in: [] } };
    // An inherited property name rather than a real operator.
    case "inherited-operator":
      return { tenant: { equals: "acme" }, region: { toString: "x" } };
    // An inherited property name used as a FIELD. A plain lookup resolves it to
    // a function, which reads as a present column.
    case "inherited-field":
      return { tenant: { equals: "acme" }, toString: { not_equals: "x" } };
    // An empty alternatives group, as a rule building branches dynamically can
    // produce. It should authorize nothing.
    case "empty-or":
      return { tenant: { equals: "acme" }, or: [] };
    // A scalar `in`, which the translator normalizes to a one-element list, so
    // it is a valid rule and must NOT be refused.
    case "scalar-in":
      return { region: { in: "eu" } };
    default:
      return true;
  }
}
