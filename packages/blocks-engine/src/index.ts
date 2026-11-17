/**
 * @nextlyhq/blocks-engine — the runtime-free core of the Nextly page builder.
 *
 * This package owns the stored document format and the pure operations over
 * it. It never imports React or Nextly at runtime, so documents can be
 * created, inspected, and transformed from any JavaScript environment.
 */

// The public exports live in `./exports/`, one part per area, each with the
// reason its names are public. The order below is the order the bundle reaches
// their modules, so it matters: the bindings part comes last on purpose (see
// its first comment).
export * from "./exports/document";
export * from "./exports/tree";
export * from "./exports/components";
export * from "./exports/validation";
export * from "./exports/blocks";
export * from "./exports/style";
export * from "./exports/operations";
export * from "./exports/bindings";
