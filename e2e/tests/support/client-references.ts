/**
 * The client components a served page references, for a check that a block
 * or a style ships no script: a page that ran something in the browser would
 * reference one more than the same page without it.
 *
 * @module support/client-references
 */
import { expect, type Page } from "@playwright/test";

/**
 * The client components a served page references, read from the payload the
 * server sent (`self.__next_f`), as `<module>#<export>`. A block that ran in
 * the browser would add one; a block drawn only on the server adds none.
 */
export async function clientReferencesOf(
  page: Page,
  path: string
): Promise<string[]> {
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  return page.evaluate(() => {
    // The payload as the server sent it, from the inline scripts that pushed
    // it: hydration empties `self.__next_f` itself.
    const pushed = Array.from(document.scripts, script => {
      const text = script.textContent ?? "";
      const start = text.indexOf("self.__next_f.push(");
      if (start === -1) return "";
      const entry = JSON.parse(
        text.slice(start + "self.__next_f.push(".length, text.lastIndexOf(")"))
      ) as unknown[];
      return typeof entry[1] === "string" ? entry[1] : "";
    }).join("");
    // Under `next dev` a client reference names its module and export as
    // `$<row>`, a reference to another row of this payload that holds the
    // string. The row's number differs per response; what it holds, the
    // module's path, does not. A production build writes both in place.
    const strings = new Map(
      [
        ...pushed.matchAll(
          /(?:^|\n)([0-9a-f]+):("(?:[^"\\\n]|\\.)*")(?=\n|$)/g
        ),
      ].map(row => [String(row[1]), JSON.parse(String(row[2])) as string])
    );
    const followed = (value: unknown): string => {
      const text = String(value);
      if (!text.startsWith("$")) return text;
      const row = strings.get(text.slice(1));
      // An unresolved reference is a payload this read no longer understands,
      // and reading it as anything would let two modules compare equal.
      if (row === undefined) throw new Error(`no payload row for ${text}`);
      return row;
    };
    // A client reference row is `<row>:I[<module>,[<chunks>],"<export>"]`.
    return [
      ...new Set(
        [...pushed.matchAll(/(?:^|\n)[0-9a-f]+:I(\[[^\n]*\])/g)].map(match => {
          const [module, , name] = JSON.parse(match[1] ?? "[]") as unknown[];
          return `${followed(module)}#${followed(name)}`;
        })
      ),
    ].sort();
  });
}
