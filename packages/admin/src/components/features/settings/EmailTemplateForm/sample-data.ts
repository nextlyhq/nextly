import type { TemplateFormVariable } from "./schema";

// ============================================================
// Variables & sample data
// ============================================================

// Variables the layout composition injects automatically. Everything else
// comes from the send payload and the custom variables declared below.
export const BUILT_IN_VARIABLES = [
  { name: "appName", description: "Your application name" },
  { name: "year", description: "Current year" },
];

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

export function buildSampleData(
  variables: TemplateFormVariable[],
  options?: { isLayoutRow?: boolean }
): Record<string, string> {
  const data: Record<string, string> = {
    appName: SAMPLE_VALUE_BY_NAME.appName,
    year: SAMPLE_VALUE_BY_NAME.year,
  };
  if (options?.isLayoutRow) data.content = LAYOUT_CONTENT_SAMPLE;
  for (const v of variables) {
    if (!v.name || v.name.includes(".")) continue;
    data[v.name] = sampleValueForVariable(v.name);
  }
  return data;
}
