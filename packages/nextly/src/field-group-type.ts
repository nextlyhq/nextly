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
 * import { readFieldGroupType } from "nextly/field-group-type";
 *
 * for (const block of page.body) {
 *   switch (readFieldGroupType(block)) {
 *     case "hero":
 *       return <Hero {...block} />;
 *   }
 * }
 * ```
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
 * The full set of spellings and the bulk removal helper stay internal. They serve code that walks
 * a document key by key — pruning a restore payload, stripping markers before storage — and
 * exporting them would invite callers to reimplement the read rather than ask for it.
 *
 * @module field-group-type
 */

export {
  readFieldGroupType,
  writeFieldGroupType,
  currentFieldGroupTypeKey,
} from "./domains/field-groups/storage/field-group-type-key";
