import type {
  EmailTemplateVariableField,
  EmailTemplateVariablePresentation,
  EmailTemplateVariableType,
} from "@admin/services/emailTemplateApi";

// ============================================================
// Variables & sample data
// ============================================================

// Names the built-in flows pass themselves and the layout chrome carries
// (`appName`, `year`). Offered to the author as completions and starting
// values; an ordinary body is NOT handed them for free (see SUPPLIED below),
// so each is still the template's to declare where a send must supply it.
export const BUILT_IN_VARIABLES: {
  name: string;
  description: string;
}[] = [
  { name: "appName", description: "Your application name" },
  { name: "year", description: "Current year" },
];

/**
 * The names a body never has to declare, because the renderer supplies them
 * whatever the send holds: the brand settings, under both spellings (see
 * `renderTemplate`, which hands every body `brand` and `nextly_brand`).
 * `appName` and `year` are not among them — an ordinary body renders whatever
 * its sender passed, and nothing when it passed nothing.
 */
export const SUPPLIED_VARIABLE_NAMES: ReadonlySet<string> = new Set([
  "brand",
  "nextly_brand",
]);

/**
 * The names a given row never has to declare. A layout row is the wrapper
 * itself, so the composition hands it the chrome too: `content`, `appName`
 * and `year`.
 */
export function suppliedNamesFor(isLayoutRow: boolean): ReadonlySet<string> {
  if (!isLayoutRow) return SUPPLIED_VARIABLE_NAMES;
  return new Set([...SUPPLIED_VARIABLE_NAMES, "content", "appName", "year"]);
}

const SAMPLE_VALUE_BY_NAME: Record<string, string> = {
  appName: "Northwind",
  year: String(new Date().getFullYear()),
  userName: "Priya Raman",
  name: "Priya Raman",
  userEmail: "priya.raman@northwind.io",
  email: "priya.raman@northwind.io",
  verifyLink: "https://app.northwind.io/verify?token=8f2c1a",
  resetLink: "https://app.northwind.io/reset?token=8f2c1a",
  url: "https://app.northwind.io/action?token=8f2c1a",
  token: "8f2c1a",
  expiresIn: "30 minutes",
  siteName: "Northwind",
  siteUrl: "https://northwind.io",
};

function sampleValueForVariable(name: string): string {
  return SAMPLE_VALUE_BY_NAME[name] ?? `Sample ${name}`;
}

/**
 * The stand-in body an author sees at a layout's `{{content}}` slot.
 *
 * Sample data rather than something the preview splices in: `content` is the
 * variable a layout declares, so supplying it here renders it through the same
 * server composition as every other variable, and leaves it visible and
 * editable in the sample-data drawer instead of hidden in the renderer.
 */
const LAYOUT_CONTENT_SAMPLE = "Your email content appears here.";

/** A declaration, as the sample data reads one: its name and how it's shown. */
export interface SampleDeclaration {
  name: string;
  presentation?: EmailTemplateVariablePresentation;
}

/** A starting value for a field of `type`, when its declaration gives none. */
function valueOfType(
  name: string,
  type: EmailTemplateVariableType | undefined,
  fields: EmailTemplateVariableField[] | undefined
): unknown {
  switch (type) {
    case "number":
      return 1;
    case "money":
      return 19.99;
    case "date":
      return new Date().toISOString().slice(0, 10);
    case "link":
      return SAMPLE_VALUE_BY_NAME[name] ?? "https://example.com";
    case "boolean":
      return true;
    case "list":
      // One row of the list's items, so the loop shows something.
      return fields?.length ? [objectOf(fields)] : [`Sample ${name}`];
    case "object":
      return objectOf(fields ?? []);
    default:
      return sampleValueForVariable(name);
  }
}

/** An object with a starting value for each of `fields`. */
function objectOf(
  fields: readonly EmailTemplateVariableField[]
): Record<string, unknown> {
  return Object.fromEntries(
    fields.map(field => [
      field.name,
      field.example ?? valueOfType(field.name, field.type, field.fields),
    ])
  );
}

/**
 * A variable's starting test value: its declared example, else a value of its
 * type, else today's sample for its name.
 */
function startingValue(declaration: SampleDeclaration): unknown {
  const presentation = declaration.presentation ?? {};
  return (
    presentation.example ??
    valueOfType(declaration.name, presentation.type, presentation.fields)
  );
}

export function buildSampleData(
  variables: SampleDeclaration[],
  options?: { isLayoutRow?: boolean }
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    appName: SAMPLE_VALUE_BY_NAME.appName,
    year: SAMPLE_VALUE_BY_NAME.year,
  };
  if (options?.isLayoutRow) data.content = LAYOUT_CONTENT_SAMPLE;
  for (const v of variables) {
    if (!v.name || v.name.includes(".")) continue;
    data[v.name] = startingValue(v);
  }
  return data;
}
