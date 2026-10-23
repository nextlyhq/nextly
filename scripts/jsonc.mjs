/**
 * JSON with comments and trailing commas, as `tsconfig.json`, `turbo.jsonc` and
 * VS Code's settings write it.
 *
 * Comments are removed only outside strings, so a URL such as `"https://x"` keeps
 * its `//`; then a comma before a closing bracket is dropped. That is all the
 * dialect adds to JSON, so the rest is `JSON.parse`, and a file that is not
 * valid after both steps throws rather than parsing as something else.
 */
export function parseJsonc(text) {
  const withoutComments = text.replace(
    /("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (match, string) => string ?? ""
  );
  return JSON.parse(withoutComments.replace(/,(\s*[}\]])/g, "$1"));
}
