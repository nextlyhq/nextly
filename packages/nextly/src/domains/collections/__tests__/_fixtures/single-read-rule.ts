/**
 * A stored `custom` read rule for a Single, as a real module so the access
 * service's dynamic `import(functionPath)` can load it.
 *
 * Answers differently per caller so one fixture covers a constraint that
 * selects, one that selects nothing, an outright refusal, a caller-only
 * decision, and a shape that cannot be translated exactly.
 */
export default function singleReadRule({
  req,
  data,
}: {
  req: { user?: { id?: string } };
  data?: Record<string, unknown>;
}): unknown {
  switch (req.user?.id) {
    case "denied":
      return false;
    // No predicate: the caller alone decides, so nothing is filtered.
    case "always":
      return true;
    // A dotted path, whose suffix translation discards while comparing the base
    // column instead — a different predicate than the rule states.
    case "dotted":
      return { "tenant.name": { equals: "acme" } };
    // A system column the Single owns but does not list as a configured field.
    // Validating against configured fields alone would refuse this valid rule.
    case "system-column":
      return { id: { not_equals: "no-such-id" } };
    // A rule that reads the stored document, which it can only do if the row is
    // loaded before the rule is evaluated.
    case "reads-data":
      return { tenant: { equals: (data as { tenant?: string })?.tenant } };
    // Narrow to the caller's own tenant.
    default:
      return { tenant: { equals: req.user?.id } };
  }
}
