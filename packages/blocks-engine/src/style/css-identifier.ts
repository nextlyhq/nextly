/**
 * Reading a CSS identifier as the browser does, with nothing behind it.
 *
 * Kept apart from `css-value-syntax`, which imports the CSS parser, because the
 * contrast math reads colour keywords with these and ships alone through the
 * package's `./contrast` entry. **Nothing here may import anything with a
 * runtime dependency.**
 *
 * @module style/css-identifier
 */

/**
 * Lowercase the ASCII letters and nothing else.
 *
 * CSS folds identifier case for A–Z only, while JavaScript's `toLowerCase` is
 * Unicode-aware and maps U+212A KELVIN SIGN to `k`. Folding with it would match
 * `blocK` against `block` here while the browser keeps them distinct
 * identifiers and discards the declaration, so every identifier comparison in
 * `css-value` and the validator uses this instead.
 */
export function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, letter => letter.toLowerCase());
}

/**
 * An identifier with its CSS escapes decoded: `\66 oo` and `\66oo` read as
 * `foo`. A code point CSS cannot carry (zero, a surrogate, past U+10FFFF)
 * decodes to U+FFFD, as the browser's tokenizer does.
 */
export function decodeIdentifier(name: string): string {
  if (!name.includes("\\")) return name;
  return name.replace(
    /\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\r\n\f])?|([\s\S]))/g,
    (_match: string, hex?: string, literal?: string) => {
      if (hex === undefined) return literal ?? "";
      const point = Number.parseInt(hex, 16);
      const usable =
        point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff);
      return usable ? String.fromCodePoint(point) : "\uFFFD";
    }
  );
}
