/**
 * An export file's text read as the tool's export it was chosen as. The one
 * way a file is read, in the browser before only what it holds is sent, and
 * on the server for a file sent whole: it imports nothing from the server.
 *
 * @module import/read-file
 */
import type { ImportFileSource } from "./contract";
import { readRankMathCsv } from "./csv";
import { readPayload } from "./payload";
import type { ParsedSource } from "./records";
import { readRankMathExport, readYoast } from "./wordpress";

/** `text` read as `kind`'s export, in `language` where the file has several. */
export function readFile(
  kind: ImportFileSource,
  text: string,
  language: string | undefined
): ParsedSource {
  switch (kind) {
    case "yoast":
      return readYoast(text);
    case "rankMath":
      return text.trimStart().startsWith("<")
        ? readRankMathExport(text)
        : readRankMathCsv(text);
    case "payload":
      return readPayload(text, language);
  }
}
