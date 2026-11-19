/**
 * A binding's shape, as a node's props and a document's metadata both hold
 * them.
 *
 * @module validation-bindings
 */
import { bindPathFits } from "./binding-rules";
import {
  BINDING_SOURCES,
  type BlockNode,
  COMPONENT_INSTANCE_TYPE,
  isBindingSource,
} from "./document";
import { describeValue, pointer } from "./issue-text";
import { isPlainRecord } from "./plain-record";
import {
  boundSettingId,
  keepsItsListWhenMoved,
} from "./resolve-instances-exposures";
import type { ValidationIssue } from "./validation-contract";

/**
 * A binding's shape: an object keyed by prop, each a dot-joined path of field
 * identifiers (`isBindPath`, so nothing evaluable is stored) with a known
 * source and the key a Single needs. The rules that need the schema, the one
 * relation a path may follow among them, are checked over the whole document
 * when the context carries one (`bindingSchemaIssues`), and always where
 * bindings are resolved.
 */
export function validateBindings(
  node: BlockNode,
  path: string,
  issues: ValidationIssue[]
): void {
  if (node.bindings === undefined) return;
  if (!isPlainRecord(node.bindings)) {
    issues.push({
      path: pointer(path, "bindings"),
      code: "invalid-binding",
      severity: "error",
      message: "A node bindings field must be an object keyed by prop name.",
    });
    return;
  }
  const bindingsPath = pointer(path, "bindings");
  for (const [prop, binding] of Object.entries(node.bindings)) {
    const bPath = pointer(bindingsPath, prop);
    // A component placement has no props of its own to fill: it binds its
    // settings, each under `overrides.<setting id>`, and composing it writes
    // the binding onto the component's block that the setting fills.
    if (
      node.type === COMPONENT_INSTANCE_TYPE &&
      boundSettingId(prop) === undefined
    ) {
      issues.push({
        path: bPath,
        code: "invalid-binding",
        severity: "error",
        message: `A component placement binds only its settings, each as overrides.<setting id>, not "${describeValue(prop)}".`,
      });
      continue;
    }
    // The schema-aware checks run over the whole document once the walk is
    // done (`bindingSchemaIssues`), so a problem a stored form already held
    // stays a warning.
    const readable = validBindingShape(binding, bPath, issues);
    if (
      readable &&
      node.type === COMPONENT_INSTANCE_TYPE &&
      !keepsItsListWhenMoved(binding)
    ) {
      issues.push({
        path: pointer(bPath, "list"),
        code: "invalid-binding",
        severity: "error",
        message:
          "A component placement's list item binding names the list it reads, by its id: the component's block it fills may sit in a list of its own.",
      });
    }
  }
}

/**
 * One binding's shape, wherever it is stored: an object with a `$bind` path
 * of field identifiers (`isBindPath`, so nothing evaluable is stored), a
 * known source, and the key a Single needs. Answers whether it was readable
 * enough for the checks that follow it.
 */
export function validBindingShape(
  binding: unknown,
  bPath: string,
  issues: ValidationIssue[]
): binding is Record<string, unknown> {
  // Check the shape BEFORE reading any field: a null/primitive binding value
  // must produce an issue, not a thrown property access.
  if (!isPlainRecord(binding)) {
    issues.push({
      path: bPath,
      code: "invalid-binding",
      severity: "error",
      message: "A binding must be an object with a string $bind path.",
    });
    return false;
  }
  const bindPath = binding.$bind;
  if (typeof bindPath !== "string") {
    issues.push({
      path: bPath,
      code: "invalid-binding",
      severity: "error",
      message: "A binding must be an object with a string $bind path.",
    });
    return false;
  }
  // A binding following a setting names the setting's id, which is no field
  // path; where it may stand is `settingBindingIssues`'s to say.
  if (!bindPathFits(binding.source, bindPath)) {
    issues.push({
      path: pointer(bPath, "$bind"),
      code: "invalid-binding",
      severity: "error",
      message:
        binding.source === "setting"
          ? `Binding "${describeValue(bindPath)}" must name one of the component's settings.`
          : `Binding path "${describeValue(bindPath)}" must be a dot-joined field path (never an expression).`,
    });
  }
  const source: unknown = binding.source;
  if (
    source !== undefined &&
    (typeof source !== "string" || !isBindingSource(source))
  ) {
    issues.push({
      path: pointer(bPath, "source"),
      code: "invalid-binding",
      severity: "error",
      message: `Binding source "${describeValue(source)}" is not one of: ${BINDING_SOURCES.join(", ")}.`,
    });
  }
  const sourceKey = binding.sourceKey;
  if (source === "single") {
    if (typeof sourceKey !== "string" || sourceKey.length === 0) {
      issues.push({
        path: pointer(bPath, "sourceKey"),
        code: "missing-source-key",
        severity: "error",
        message:
          'A binding with source "single" must name the single via sourceKey.',
        suggestion: "Set sourceKey to the single's slug.",
      });
    }
  } else if (sourceKey !== undefined) {
    // sourceKey is reserved for single-sourced bindings; on any other source
    // it is an ambiguous, unresolvable field.
    issues.push({
      path: pointer(bPath, "sourceKey"),
      code: "invalid-binding",
      severity: "error",
      message: 'sourceKey is only allowed when source is "single".',
    });
  }
  listShapeIssue(binding, source, bPath, issues);
  return true;
}

/**
 * The enclosing list an item binding names, where one is named: a list's
 * node id, and only on an item binding, the one source a list draws.
 */
function listShapeIssue(
  binding: Record<string, unknown>,
  source: unknown,
  bPath: string,
  issues: ValidationIssue[]
): void {
  const list = binding.list;
  if (list === undefined) return;
  if (source !== "item" || typeof list !== "string" || list.length === 0) {
    issues.push({
      path: pointer(bPath, "list"),
      code: "invalid-binding",
      severity: "error",
      message:
        'list names the enclosing list an item binding reads, by its id, and is only allowed when source is "item".',
    });
  }
}
