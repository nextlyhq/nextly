/**
 * A text's length as a person counts it: in code points, so an emoji or a
 * letter outside the Basic Multilingual Plane is one character, not the two
 * UTF-16 units `String.length` counts.
 *
 * ONE function for every bound a person is told in characters, on the server
 * and in the admin alike, so a limit a sheet allows is the limit a write
 * accepts. It imports nothing, so a browser bundle takes it without the rest
 * of the package.
 *
 * @module shared/text-length
 */

/** How many characters `value` holds, counted in code points. */
export function textLength(value: string): number {
  let count = 0;
  // A string's iterator yields one code point at a time, a surrogate pair as
  // one; counting it never builds an array the length of the text.
  for (const _codePoint of value) count += 1;
  return count;
}
