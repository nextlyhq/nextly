import type {
  EmailTemplateVariableField,
  EmailTemplateVariablePresentation,
  EmailTemplateVariableType,
} from "@admin/services/emailTemplateApi";

// ============================================================
// Variables & sample data
// ============================================================

// Variables the layout composition injects automatically. Everything else
// comes from the send payload and the custom variables declared below.
export const BUILT_IN_VARIABLES: {
  name: string;
  description: string;
}[] = [
  { name: "appName", description: "Your application name" },
  { name: "year", description: "Current year" },
];

/**
 * Names the send supplies itself, never the template's sender: the built-ins
 * above and the brand settings (`nextly_brand`). The workbench neither asks
 * for them to be declared nor marks them blank.
 */
export const SUPPLIED_VARIABLE_NAMES: ReadonlySet<string> = new Set([
  ...BUILT_IN_VARIABLES.map(variable => variable.name),
  "nextly_brand",
]);

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
export function objectOf(
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
export function startingValue(declaration: SampleDeclaration): unknown {
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
