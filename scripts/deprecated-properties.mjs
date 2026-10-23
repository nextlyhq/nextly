// Which properties a sample writes that the API it writes them for has
// deprecated, asked of the compiler's language server.
//
// The compiler reports no diagnostic for this. `{ collections: [...] }` written
// against a type whose `collections` carries `@deprecated` compiles with no
// error, warning or suggestion, so a documented example can teach the
// deprecated spelling for as long as nobody reads it. So each property a
// literal writes is asked about directly.
//
// Hover on a property key answers for the member the literal fills in, which
// is the compiler's own resolution of everything that decides it: the
// literal's contextual type, the union arm its discriminants select, a nested
// literal judged against its own property's type. A literal with no declared
// shape has nothing to be deprecated against, and its hover carries no tag. A
// union the literal leaves ambiguous answers with the union's own member,
// which carries a tag only when every arm does.
import { extname } from "node:path";
import { pathToFileURL } from "node:url";

import { parseSource, walk } from "@nextlyhq/module-specifiers/parse-source";

/**
 * `{ name, start }` for each property in `source` whose name the text decides,
 * `start` being the offset of its key. `{ collections }`, `{ "collections" }`
 * and `{ ["collections"]: x }` all name `collections`. A computed key that has
 * to be evaluated, and a spread, name nothing a declared property can be
 * looked up by, and are skipped.
 */
export function writtenProperties(source, fileName) {
  const found = [];
  walk(parseSource(source, fileName).program, node => {
    if (node.type !== "ObjectExpression") return;
    for (const property of node.properties) {
      const name = staticKeyName(property);
      if (name !== undefined) found.push({ name, start: property.key.start });
    }
  });
  return found;
}

/** The name a property's key spells, when no evaluation is needed to know it. */
function staticKeyName(property) {
  if (property.type !== "Property") return undefined;
  const { key } = property;
  if (key.type === "Identifier" && !property.computed) return key.name;
  if (key.type !== "Literal") return undefined;
  return ["string", "number"].includes(typeof key.value)
    ? String(key.value)
    : undefined;
}

/** The language id the server reads a file under, by its extension. */
const LANGUAGE = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".mjs": "javascript",
  ".jsx": "javascriptreact",
};

/** The protocol's position of a UTF-16 offset, which is what the parser reports. */
export function positionOf(source, offset) {
  const before = source.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  return {
    line: before.split("\n").length - 1,
    character: offset - lineStart,
  };
}

const DEPRECATED = /^\*@deprecated\*(?: — )?([\s\S]*?)(?:\n\n\*@|$(?![\s\S]))/m;

/**
 * The deprecation note a hover carries: the text after its `*@deprecated*`
 * line, up to the next tag, `""` for a tag with no text, and undefined when
 * there is no tag.
 *
 * A hover that answers nothing is refused rather than read as "no tag": the
 * server answers every key in a file it has open, so an empty answer means it
 * was not asked what was meant, and reading that as clean is the silent
 * direction.
 */
export function deprecationIn(hover, where) {
  const text = hoverText(hover);
  if (text === undefined) {
    throw new Error(`deprecated properties: no hover for ${where}`);
  }
  return DEPRECATED.exec(text)?.[1].trim();
}

/** A hover's text, whichever of the protocol's shapes it comes in. */
function hoverText(hover) {
  const contents = hover?.contents;
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents.map(part => part.value ?? part).join("\n\n");
  }
  return contents?.value;
}

/**
 * `{ name, start, note }` for each property `source` writes that its API has
 * deprecated, asked of `server` (from `startLanguageServer`, initialised on a
 * project that includes `file`). The file is opened with `source` as its text
 * for the questions and closed after them.
 */
export async function deprecatedPropertiesIn(server, file, source) {
  const uri = pathToFileURL(file).href;
  server.notify("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: LANGUAGE[extname(file)] ?? "typescript",
      version: 1,
      text: source,
    },
  });
  try {
    const written = writtenProperties(source, file);
    const notes = await Promise.all(
      written.map(property => noteFor(server, uri, source, property))
    );
    return written
      .map((property, index) => ({ ...property, note: notes[index] }))
      .filter(property => property.note !== undefined);
  } finally {
    server.notify("textDocument/didClose", { textDocument: { uri } });
  }
}

/** The deprecation note of one written property, or undefined. */
async function noteFor(server, uri, source, { name, start }) {
  // The key's first character, a quote included: the server answers for the
  // property from anywhere in its key.
  const position = positionOf(source, start);
  const hover = await server.request("textDocument/hover", {
    textDocument: { uri },
    position,
  });
  return deprecationIn(
    hover,
    `'${name}' at ${uri}:${String(position.line + 1)}`
  );
}
