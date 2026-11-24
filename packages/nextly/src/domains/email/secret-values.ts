/**
 * The secrets a send of a template that carries one holds, and a provider's
 * failure text with them blanked out.
 *
 * A provider's error may quote the message it was handed, and the failure is
 * stored on the delivery record and written to the log. For a template that
 * carries a sign-in, reset or verification link or code, the secret's values
 * are known exactly: they are the send's own variables. So they are blanked
 * out of the failure by value, not found by shape.
 *
 * @module domains/email/secret-values
 */

/** Shorter than a six-digit code is too common to blank without mangling the text. */
const SHORTEST_SECRET = 6;

/** Bounds the walk over a send's variables, which may nest. */
const DEEPEST = 4;

/**
 * Every value a secret could appear as in a failure: each string variable
 * of at least six characters, at any depth, the query values of one that is
 * a link, and each as HTML-escaped text, as a rendered body holds it.
 */
export function secretValuesOf(variables: Record<string, unknown>): string[] {
  const found = new Set<string>();
  const add = (value: string) => {
    if (value.length < SHORTEST_SECRET) return;
    found.add(value);
    found.add(escapedAsHtml(value));
  };
  const walk = (value: unknown, depth: number): void => {
    if (typeof value === "string") {
      add(value);
      for (const part of queryValuesOf(value)) add(part);
      return;
    }
    if (depth >= DEEPEST || typeof value !== "object" || value === null) return;
    for (const inner of Object.values(value)) walk(inner, depth + 1);
  };
  walk(variables, 0);

  // Longest first, so a link is blanked whole before its own token is.
  return [...found].sort((a, b) => b.length - a.length);
}

/**
 * A send's secrets: the values of its variables when its template carries a
 * secret, and none otherwise.
 */
export function secretsOfTemplate(
  template: { carriesSecret: boolean } | null,
  variables: Record<string, unknown>
): string[] {
  return template?.carriesSecret === true ? secretValuesOf(variables) : [];
}

/** The text with every one of the secrets blanked out. */
export function withoutSecrets(
  text: string,
  secrets: readonly string[]
): string {
  return secrets.reduce(
    (blanked, secret) => blanked.split(secret).join("[secret]"),
    text
  );
}

/** A link's query values, decoded; none when the value is not a link. */
function queryValuesOf(value: string): string[] {
  if (!/^https?:\/\//i.test(value)) return [];
  try {
    return [...new URL(value).searchParams.values()];
  } catch {
    return [];
  }
}

/** The value as a rendered HTML body writes it. */
function escapedAsHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&#34;")
    .replaceAll("'", "&#39;");
}
