/**
 * Shared Prettier configuration for Nextly monorepo
 *
 * This configuration enforces consistent code formatting across all packages.
 *
 * @see https://prettier.io/docs/en/options.html
 */

/** @type {import("prettier").Config} */
const config = {
  // Use semicolons at the end of statements
  semi: true,

  // Use trailing commas where valid in ES5 (objects, arrays, etc.)
  trailingComma: "es5",

  // Use double quotes instead of single quotes
  singleQuote: false,

  // Wrap lines at 80 characters
  printWidth: 80,

  // Use 2 spaces for indentation
  tabWidth: 2,

  // Use spaces for indentation (not tabs)
  useTabs: false,

  // Use Unix line endings (LF)
  endOfLine: "lf",

  // Avoid parentheses around sole arrow function parameter
  arrowParens: "avoid",

  // Print spaces between brackets in object literals
  bracketSpacing: true,

  // Put the > of a multi-line HTML element at the end of the last line
  bracketSameLine: false,

  // Only add quotes around object properties when necessary
  quoteProps: "as-needed",
};

export default config;
