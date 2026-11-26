/**
 * The texts a rich text document holds, as a test reads a converted value back.
 *
 * Shared because the suites converting values into rich text, on each storage layout, read the
 * document the same way: by the texts it holds, in order, whatever form the Direct API hands it
 * over in (the parsed document, or its JSON).
 *
 * @module domains/schema/__tests__/helpers/document-texts
 */

/** Every `text` a rich text document holds, in order, the document read whole or from its JSON. */
export function textsOf(value: unknown): string[] {
  const document: unknown =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  const texts: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (typeof record.text === "string") texts.push(record.text);
    Object.values(record).forEach(visit);
  };
  visit(document);
  return texts;
}
