/**
 * Reading and writing the type a field group instance announces in stored JSON.
 *
 * ## Why this is a public entry point
 *
 * A dynamic zone is returned to application code as an array of instances, each announcing which
 * field group it is under a reserved key. That key is already a public contract: user code
 * branches on it to decide how to render a row, and the admin editor reads it to pick a schema.
 *
 * It is also the one part of the storage format a database cannot be asked about. Table and column
 * names survive a rename because the code can look up which name a given database really uses; a
 * property inside a JSON document has no catalog, so code that writes the key out literally reads
 * nothing once the name changes. Publishing the accessor rather than the string keeps that rename
 * an internal detail instead of a breaking change for every consumer.
 *
 * ```ts
 * import { isFieldGroupType } from "nextly/field-group-type";
 *
 * for (const block of page.body) {
 *   if (isFieldGroupType(block, "hero")) return <Hero {...block} />;
 * }
 * ```
 *
 * 🔴 Use the predicate, not a `switch` on `readFieldGroupType`. A dynamic zone is generated as a
 * UNION, and the reader returns `string | undefined` — a value with no relationship to the
 * instance — so a `switch` on it leaves the union exactly as wide as it was and every
 * member-specific property inaccessible inside the matching branch. `readFieldGroupType` is for
 * when the slug itself is the answer (logging it, keying a map); `isFieldGroupType` is for
 * deciding what a value IS.
 *
 * ## Why its own entry rather than `nextly/field-groups`
 *
 * That module is the authoring surface — `defineFieldGroup`, config validation — and its graph
 * reaches several hundred modules and most of the Node built-ins, because validation pulls in the
 * schema pipeline. This entry is separate so that reading a stored value costs a consumer nothing
 * but two constants, which is what lets a client component use it.
 *
 * ## What is deliberately not exported
 *
 * The full set of spellings, the bulk removal helper, and the key itself stay internal.
 *
 * 🔴 The key most of all. Publishing it invites `instance[currentFieldGroupTypeKey]`, which reads
 * ONE spelling and answers `undefined` for a document written on the other side of the rename —
 * reintroducing, through the public surface, the exact incompatibility these functions exist to
 * hide. It would also make a future rename a breaking change to this package's API, for a value
 * this module describes as an internal detail.
 *
 * @module field-group-type
 */

export {
  readFieldGroupType,
  isFieldGroupType,
  writeFieldGroupType,
} from "./domains/field-groups/storage/field-group-type-key";

// The definition-side vocabulary: which `type` token a stored FIELD carries
// and which reference keys it may point at. Renderers that dispatch on a
// field's type — the admin entry form among them — ask the predicate rather
// than compare either literal, so a migrated definition renders as what it is.
// Renamed on this surface to keep the two predicates apart: the `isFieldGroupType`
// above judges a stored INSTANCE's value, this one judges a FIELD's type token.
export {
  extractFieldGroupReferences,
  isFieldGroupType as isFieldGroupFieldType,
} from "./domains/field-groups/storage/field-group-field-type";
