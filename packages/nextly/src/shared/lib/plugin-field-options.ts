/**
 * Declaration checks a plugin stated for its own field type.
 *
 * A plugin type reaches none of the cases in the config validators' switches —
 * they know only the built-ins — so without this a custom type's options are
 * accepted unread. The type is the only thing that knows what its options mean,
 * and a contradiction between them (a policy admitting no value at all, a list
 * that is not a list) is a defect in the schema rather than in any write.
 *
 * Kept here rather than in `base-validator` because both the code-first
 * validators and the Schema Builder's zod schema consume it, and the two want
 * the result in different shapes. This returns the raw issues; each caller
 * renders them the way its own error channel expects.
 *
 * @module shared/lib/plugin-field-options
 */
import {
  getFieldType,
  isPluginFieldTypeOnSurface,
} from "../../domains/schema/field-types/field-type-registry";
import {
  PLUGIN_OPTIONS_KEY,
  pluginOptionContainer,
  RESERVED_PLUGIN_OPTION_KEYS,
} from "../../plugins/plugin-options";

import { detachedField } from "./detached-field";

/**
 * One problem with a field's declaration, located relative to that field.
 *
 * Carries no code. A returned `PluginFieldIssue.code` is dropped here on
 * purpose: the config validators report through error-code unions that are
 * closed and public, so a plugin-defined string would reach a consumer
 * exhaustively handling the declared members and be a value none of them
 * expects. The message keeps whatever specificity the plugin wanted to convey.
 */
export interface PluginFieldOptionIssue {
  /** Option this concerns (`"blocks.kinds"`), or absent for the field itself. */
  path?: string;
  message: string;
}

/**
 * Run `validateOptions` for a field's type, if its type declared one.
 *
 * A defective plugin fails its own field rather than the boot: a check that
 * throws is reported as a rejected declaration, exactly as a returned message
 * is, so one bad plugin cannot stop an app from starting with a stack trace.
 */
export function pluginFieldOptionIssues(field: {
  type?: unknown;
  name?: unknown;
}): PluginFieldOptionIssue[] {
  if (typeof field.type !== "string") return [];
  // Only for a type that opted into the entry-schema surface, which is the one
  // these callers validate — collections, singles and field groups all gate on
  // it. A type offered solely on `users`, `forms`, or `blocks` writes rules for
  // a declaration shape this path never sees, and running them here would let
  // it reject entry metadata it was never written about. The same applies to a
  // type whose author later drops `entries` while instances of it remain: those
  // keep rendering, and they must not start failing a boot.
  if (!isPluginFieldTypeOnSurface(field.type, "entries")) return [];

  // Checked before the type's own rules, and regardless of whether it declares
  // any: the instance restates `type` and `name` as its identity after folding
  // the container, so an option under either would be shadowed and never reach
  // the code that asked for it. The manifest schema refuses these too, but a
  // code-first declaration never passes through it.
  const container = pluginOptionContainer(field);
  const reserved = container
    ? Object.keys(container).filter(key => RESERVED_PLUGIN_OPTION_KEYS.has(key))
    : [];
  if (reserved.length > 0) {
    return reserved.map(key => ({
      path: `${PLUGIN_OPTIONS_KEY}.${key}`,
      message: asSentence(
        `${key} cannot be used as a plugin option: it states which field the type is looking at`
      ),
    }));
  }

  const custom = getFieldType(field.type);
  if (!custom?.validateOptions) return [];

  const rejected = (): PluginFieldOptionIssue[] => [
    { message: `${String(field.type)} field is not declared correctly.` },
  ];

  try {
    const result = custom.validateOptions(
      detachedField({
        ...field,
        type: field.type,
        name: typeof field.name === "string" ? field.name : undefined,
      })
    );

    if (result === true) return [];

    if (typeof result === "string") return [{ message: asSentence(result) }];

    if (Array.isArray(result)) {
      return result.map(issue => ({
        path: issue.path,
        message: asSentence(issue.message),
      }));
    }

    // Anything outside the documented union is a refusal, matching the
    // write-time seam: a check that forgets to return must not read as
    // approval, which would leave the type stating rules nothing applies.
    return rejected();
  } catch {
    return rejected();
  }
}

/** A message a client can show as-is: one sentence, ending in a period. */
function asSentence(message: string): string {
  return message.endsWith(".") ? message : `${message}.`;
}
