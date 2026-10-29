/**
 * Stylesheets imported for their side effect (`import "../styles/globals.css"`).
 *
 * The bundler handles them; TypeScript only needs to know the specifier is
 * expected. `noUncheckedSideEffectImports` (TypeScript 7's default, set in
 * `@nextlyhq/tsconfig`) refuses a side-effect import it cannot resolve, so
 * this declares every `.css` file as a module with no exports.
 */
declare module "*.css" {}
