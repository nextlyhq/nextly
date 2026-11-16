/**
 * Rich text documents as the type-change judgement meets them: whether a value is a document the
 * editor reads, and the document a text becomes, one paragraph per line. The judgement measures that
 * document against what the new column holds, so the conversion that writes it has to build the
 * same one; it is built here, once, for both.
 *
 * @module domains/schema/value-conversion/type-change/document
 */

/** A node of an editor document: a type, and children where it has any. */
interface DocumentNode {
  type?: unknown;
  children?: unknown;
}

/**
 * Whether `value` is a document the editor reads: an object whose `root` is a node of type `root`
 * holding a list of children. The editor reads nothing else as a document.
 */
export function isEditorDocument(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const root = (value as { root?: unknown }).root;
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    return false;
  }
  const node = root as DocumentNode;
  return node.type === "root" && Array.isArray(node.children);
}

/** A paragraph holding `line` as plain text, or nothing for an empty line. */
function paragraph(line: string): Record<string, unknown> {
  return {
    type: "paragraph",
    format: "",
    indent: 0,
    version: 1,
    direction: null,
    textFormat: 0,
    children:
      line === ""
        ? []
        : [
            {
              type: "text",
              text: line,
              format: 0,
              style: "",
              mode: "normal",
              detail: 0,
              version: 1,
            },
          ],
  };
}

/**
 * The document holding `text`, one paragraph per line, its characters kept as they are. A line
 * ends at a line feed, a carriage return and line feed, or a carriage return.
 */
export function documentOfText(text: string): Record<string, unknown> {
  return {
    root: {
      type: "root",
      format: "",
      indent: 0,
      version: 1,
      direction: null,
      children: text.split(/\r\n|\n|\r/).map(paragraph),
    },
  };
}
