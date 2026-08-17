/**
 * The `blocks` field type, contributed by the plugin that can deliver it.
 *
 * Core used to ship this as a built-in: a JSON column and a read-only summary,
 * with no editor unless this plugin was installed. It is declared here instead,
 * so a field type exists exactly where the code that makes it work does, and
 * core carries no dependency on the document engine.
 *
 * Every seam a built-in had is stated here rather than assumed:
 * value rules through `validate`, declaration rules through `validateOptions`,
 * the empty document through `emptyValue`, and the generated types through
 * `codegen`.
 *
 * @module fields/blocksField
 */

import {
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
} from "@nextlyhq/blocks-engine";
import type {
  PluginFieldInstance,
  PluginFieldType,
} from "@nextlyhq/plugin-sdk";

import { emptyBlockDocument } from "./blocks-document";
import type { BlocksFieldOptions } from "./blocks-options";
import { validateBlocksValue } from "./blocks-validator";

/** The field type id. Was a built-in token; now this plugin's to own. */
export const BLOCKS_TYPE = "blocks";

/**
 * The control the entry form renders for a blocks field: a summary of the
 * stored document, and the way in to the editor that changes it.
 */
export const BLOCKS_FIELD_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#BlocksField";

/** The policy a field declares, in the loosest shape worth reading. */
function policyOf(field: PluginFieldInstance): BlocksFieldOptions {
  const declared = field.blocks;
  if (typeof declared !== "object" || declared === null) return {};
  return declared;
}

export const BLOCKS_FIELD_TYPE: PluginFieldType = {
  type: BLOCKS_TYPE,
  storage: "json",
  component: BLOCKS_FIELD_COMPONENT,
  label: "Blocks",
  description: "Page built from blocks",
  category: "Structured",
  icon: "LayoutGrid",

  /**
   * The document's own rules, run on every write.
   *
   * The engine owns every structural rule — ids, depth, node and byte caps,
   * slot legality, the kind enum — so this adapts its result rather than
   * restating any of it. Issues are addressed to the field, because the admin
   * renders a blocks field as a single control and the position inside the
   * document travels in the message.
   */
  validate: (value, args) => {
    const issues = validateBlocksValue(
      value,
      args.path,
      typeof args.field.label === "string" ? args.field.label : args.path,
      policyOf(args.field)
    );
    return issues.length === 0 ? true : issues;
  },

  /**
   * The declaration's own rules, run when a schema is registered.
   *
   * A policy that is the wrong shape, or one whose settings contradict each
   * other, is a defect in the schema rather than in any value: reporting it
   * per write would tell the writer, who cannot fix it, and would fail every
   * write until whoever declared the field noticed.
   */
  validateOptions: field => {
    const declared = (field as { blocks?: unknown }).blocks;
    if (declared === undefined) return true;

    if (
      typeof declared !== "object" ||
      declared === null ||
      Array.isArray(declared)
    ) {
      return "blocks must be an object declaring allow and/or kinds.";
    }

    const { allow, kinds } = declared as { allow?: unknown; kinds?: unknown };

    if (allow !== undefined) {
      if (!Array.isArray(allow) || allow.some(e => typeof e !== "string")) {
        return [
          {
            path: "blocks.allow",
            message: "blocks.allow must be an array of block name strings.",
          },
        ];
      }
    }

    if (kinds !== undefined) {
      if (!Array.isArray(kinds)) {
        return [
          {
            path: "blocks.kinds",
            message: "blocks.kinds must be an array of document kinds.",
          },
        ];
      }
      // An empty list accepts no document at all, so nothing could ever be
      // stored — including the empty document a required field is seeded with.
      // The contradiction is in the declaration, not in any value.
      if (kinds.length === 0) {
        return [
          {
            path: "blocks.kinds",
            message:
              "blocks.kinds cannot be empty: the field would accept no document at all. Omit it to accept a page.",
          },
        ];
      }

      // The kind set is closed. A declaration is the only place an unknown one
      // can be refused outright: the engine validates documents in forgiving
      // mode, where an unrecognised kind is a warning, and the policy check
      // then compares against the same bad value — so the field would accept
      // documents nothing else in the system understands, and seed and generate
      // for them too.
      const unknown = kinds.filter(
        kind => !(DOCUMENT_KINDS as readonly unknown[]).includes(kind)
      );
      if (unknown.length > 0) {
        return [
          {
            path: "blocks.kinds",
            message: `blocks.kinds contains unknown document kinds: ${unknown
              .map(String)
              .join(", ")}. Accepted: ${DOCUMENT_KINDS.join(", ")}.`,
          },
        ];
      }
    }

    return true;
  },

  /**
   * What the field holds before anything is written to it.
   *
   * The kind is read from the field's own policy: seeding a page into a field
   * that only accepts templates would store a value the same field rejects.
   */
  emptyValue: field => emptyBlockDocument(policyOf(field).kinds),

  codegen: {
    // Imported from this package rather than the engine directly: an app
    // depends on the plugin, and the engine is only a transitive dependency it
    // has no guarantee of being able to resolve by name.
    tsImports: [
      { names: ["BlockDocument"], from: "@nextlyhq/plugin-page-builder" },
    ],
    tsType: () => "BlockDocument",

    /**
     * The envelope, pinned to the format version the engine supports and to
     * the kinds this field accepts, so a value the generated schema admits is
     * one the server admits too. Accepting any numeric version would let an app
     * validate a document the write path then rejects. The node tree is checked
     * in depth by the engine on write rather than restated here.
     */
    zodSchema: field => {
      const kinds = policyOf(field).kinds;
      const accepted = kinds ?? ["page"];
      const kindSchema = `z.enum([${accepted
        .map(kind => `"${String(kind).replace(/["\\]/g, "\\$&")}"`)
        .join(", ")}])`;
      return `z.object({ formatVersion: z.literal(${DOCUMENT_FORMAT_VERSION}), kind: ${kindSchema}, nodes: z.array(z.unknown()) }).passthrough()`;
    },
  },
};
