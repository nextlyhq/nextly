import { parseSync } from "oxc-parser";

/**
 * Parse one JavaScript or TypeScript file, refusing a file the parser could not read.
 *
 * Every check in this repository that reads source does it through here. oxc
 * answers a syntax error with an EMPTY program plus a list of errors rather than
 * by throwing, so a check that looked only at the program would read a file it
 * never parsed as one containing nothing: no imports, no calls, no violations —
 * a clean green over a file that was never read. Refusing here makes that case
 * fail the run, once, for every caller.
 *
 * The language comes from `fileName`'s extension, so it is REQUIRED and must be
 * the file's real name: a `.tsx` file read as `.ts` parses `<div>` as a type
 * assertion, and a `.ts` angle-bracket assertion read as `.tsx` does not parse.
 *
 * Plain JavaScript, not TypeScript, so the repository's `.mjs` scripts can load
 * it on every Node version `engines` allows, without type stripping.
 */
export function parseSource(text, fileName) {
  const parsed = parseSync(fileName, text);
  if (parsed.errors.length > 0) {
    throw new Error(
      `${fileName} cannot be parsed, so nothing in it can be read: ${parsed.errors[0].message}`
    );
  }
  return parsed;
}
