// ============================================================
// Client-side interpolation (mirrors the core {{var}} engine)
// ============================================================

const TEMPLATE_VAR_RE = /{{\s*([\w.]+)\s*}}/g;

export function escapeHtmlValue(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolvePath(data: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      data
    );
}

export function interpolate(
  template: string,
  data: Record<string, unknown>,
  escape = true
): string {
  return template.replace(TEMPLATE_VAR_RE, (_m, path: string) => {
    const value = resolvePath(data, path);
    if (value === undefined || value === null) return "";
    const str =
      typeof value === "string"
        ? value
        : typeof value === "number" ||
            typeof value === "boolean" ||
            typeof value === "bigint"
          ? String(value)
          : (JSON.stringify(value) ?? "");
    return escape ? escapeHtmlValue(str) : str;
  });
}

export function collectVariableNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(TEMPLATE_VAR_RE)) names.add(match[1]);
  return [...names];
}
