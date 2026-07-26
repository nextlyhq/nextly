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
    default:
      return true;
  }
}
