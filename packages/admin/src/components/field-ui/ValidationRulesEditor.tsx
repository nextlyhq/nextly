"use client";

/**
 * The validation rules a field accepts, edited as a set of controls.
 *
 * Two surfaces drew this independently — the schema builder's field editor and
 * the form builder's — and both already composed `ValidationNumberField`, so
 * the control was shared and only the arrangement was duplicated. The copies
 * had drifted in three ways, one of them a defect rather than a difference of
 * taste, which is what this exists to settle.
 *
 * **Which rules apply is asked, never enumerated.** The caller passes the
 * allowed set; it does not pass a field type for this component to branch on.
 * A list of type names cannot see a type it was not written to know about, so
 * the surface that decided by `type === "text" || type === "textarea"` offered
 * a plugin-contributed field type nothing at all. Core already answers this —
 * `validationRulesForFieldType` — and taking the answer as an argument is what
 * makes a wrong answer impossible to write here.
 *
 * **Neutral about the caller's storage, following `ConditionRow`.** The two
 * surfaces store the custom error message under different keys — `message` and
 * `errorMessage` — and a shared component that silently reconciled them would
 * make every stored value under one of them wrong. So this names the rule the
 * way core's own `FieldValidationRule` vocabulary does and each surface maps
 * its own key at the call site, where the difference stays visible.
 *
 * **The container is not shared.** Each surface keeps its own tab chrome,
 * heading and spacing, exactly as `ConditionRow` left the list container to its
 * callers. What is here is the part that is genuinely the same.
 *
 * @module components/field-ui/ValidationRulesEditor
 */

import { Input, Label } from "@nextlyhq/ui";
import type { FieldValidationRule } from "nextly/field-catalog";
import { useId, type JSX } from "react";

import {
  boundProblem,
  NUMERIC_RULES,
  type NumericRule,
} from "@admin/lib/validation-bounds";

import { ValidationBoundField } from "./ValidationNumberField";

/**
 * Numeric rules drawn side by side, in the order presented.
 *
 * Rendering order is this component's own concern rather than the order core
 * happens to list them in, so the layout stays stable as the vocabulary grows.
 *
 * Whether a bound as it stands can be kept is not drawn from here: the rule
 * lives in `lib/validation-bounds`, shared with the save that holds a field
 * its panel already flagged, so the two can never disagree.
 */
const NUMERIC_PAIRS: readonly (readonly [NumericRule, NumericRule])[] = [
  ["minLength", "maxLength"],
  ["minRows", "maxRows"],
  ["min", "max"],
];

/**
 * The values this editor reads and writes.
 *
 * Named as core names the rules, so a surface storing them under these keys
 * passes its object straight through and one storing them differently maps at
 * the call site rather than inside a component that cannot know which it has.
 *
 * @deprecated Use `FieldSettingsPanel` from `@nextlyhq/plugin-sdk/admin`
 *   instead. Removed no earlier than 0.0.2-alpha.75, and only once the Form
 *   Builder and user custom fields use the shared picker and panel.
 */
export interface ValidationRuleValues {
  minLength?: number | undefined;
  maxLength?: number | undefined;
  minRows?: number | undefined;
  maxRows?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
  pattern?: string | undefined;
  message?: string | undefined;
}

/**
 * The rules this editor draws a control for.
 *
 * Exported so a surface can ask whether it would render anything rather than
 * restating the list — a caller that says "checkbox and hidden have no options"
 * is the same hardcoded-type reasoning this component exists to remove, one
 * level out. `required` is absent because every surface offers it elsewhere.
 *
 * @deprecated Use `FieldSettingsPanel` from `@nextlyhq/plugin-sdk/admin`
 *   instead. Removed no earlier than 0.0.2-alpha.75, and only once the Form
 *   Builder and user custom fields use the shared picker and panel.
 */
export const EDITABLE_VALIDATION_RULES: readonly FieldValidationRule[] = [
  ...(Object.keys(NUMERIC_RULES) as NumericRule[]),
  "pattern",
  "message",
];

/** Whether this editor would draw anything at all for an allowed set. */
/**
 * @deprecated Use `FieldSettingsPanel` from `@nextlyhq/plugin-sdk/admin`
 *   instead. Removed no earlier than 0.0.2-alpha.75, and only once the Form
 *   Builder and user custom fields use the shared picker and panel.
 */
export function drawsAnyValidationRule(
  allowed: readonly FieldValidationRule[]
): boolean {
  return allowed.some(rule => EDITABLE_VALIDATION_RULES.includes(rule));
}

/**
 * @deprecated Use `FieldSettingsPanel` from `@nextlyhq/plugin-sdk/admin`
 *   instead. Removed no earlier than 0.0.2-alpha.75, and only once the Form
 *   Builder and user custom fields use the shared picker and panel.
 */
export interface ValidationRulesEditorProps {
  /**
   * Which rules this field accepts.
   *
   * Ask `validationRulesForFieldType` from `nextly/field-catalog` rather than
   * deriving it from a list of type names: a plugin-contributed type inherits
   * the rules of the storage primitive it behaves as, which a hand-written list
   * cannot know.
   */
  allowed: readonly FieldValidationRule[];
  /**
   * What the custom message is shown for, which only the caller knows.
   *
   * A surface whose runtime hands the message to one rule can say so and help
   * the author write copy for it. One that hands the same string to required,
   * length and format failures must not, or copy written for a pattern appears
   * on failures it does not describe. Defaulting to `"validation"` means a
   * caller that has not thought about it gets the wording that is true either
   * way.
   */
  messageDescribes?: "pattern" | "validation";
  value: ValidationRuleValues;
  /** Receives only the rules that changed, for the caller to merge as it stores. */
  onChange: (next: Partial<ValidationRuleValues>) => void;
  disabled?: boolean;
}

/**
 * @deprecated Use `FieldSettingsPanel` from `@nextlyhq/plugin-sdk/admin`
 *   instead. Removed no earlier than 0.0.2-alpha.75, and only once the Form
 *   Builder and user custom fields use the shared picker and panel.
 */
export function ValidationRulesEditor({
  allowed,
  value,
  onChange,
  disabled = false,
  messageDescribes = "validation",
}: ValidationRulesEditorProps): JSX.Element {
  const permits = new Set<FieldValidationRule>(allowed);

  return (
    <div className="space-y-4">
      {NUMERIC_PAIRS.filter(
        ([lo, hi]) => permits.has(lo) || permits.has(hi)
      ).map(([lo, hi]) => (
        <div key={lo} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[lo, hi]
            .filter(rule => permits.has(rule))
            .map(rule => (
              <ValidationBoundField
                key={rule}
                label={NUMERIC_RULES[rule].label}
                description={NUMERIC_RULES[rule].description}
                counts={NUMERIC_RULES[rule].counts}
                value={value[rule]}
                problem={boundProblem(rule, value)}
                disabled={disabled}
                onChange={(n: number | undefined) => onChange({ [rule]: n })}
              />
            ))}
        </div>
      ))}

      {permits.has("pattern") && (
        <PatternRow
          value={value.pattern}
          disabled={disabled}
          onChange={pattern => onChange({ pattern })}
        />
      )}

      {permits.has("message") && (
        <MessageRow
          value={value.message}
          disabled={disabled}
          describes={messageDescribes}
          patternSet={(value.pattern ?? "").trim() !== ""}
          onChange={message => onChange({ message })}
        />
      )}
    </div>
  );
}

function PatternRow({
  value,
  disabled,
  onChange,
}: {
  value: string | undefined;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Pattern</Label>
      <Input
        id={id}
        placeholder="^[a-z0-9-]+$"
        value={value ?? ""}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        Regex the value must match.
      </p>
    </div>
  );
}

function MessageRow({
  value,
  disabled,
  describes,
  patternSet,
  onChange,
}: {
  value: string | undefined;
  disabled?: boolean;
  describes: "pattern" | "validation";
  /** Whether a Pattern is written, which a message is then wanted for. */
  patternSet: boolean;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const nudgeId = `${id}-nudge`;
  // A pattern cannot be put into words for the editor who fails it, so with
  // none written they are told only that the value "does not match the
  // required format" — not what is missing. The author is the one who knows,
  // so they are asked here, once a pattern exists and while the box is blank.
  const nudge =
    describes === "pattern" && patternSet && (value ?? "").trim() === "";
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Custom error message</Label>
      <Input
        id={id}
        value={value ?? ""}
        disabled={disabled}
        placeholder={
          describes === "pattern" ? "e.g. Must contain @123" : undefined
        }
        aria-describedby={nudge ? nudgeId : undefined}
        onChange={e => onChange(e.target.value)}
      />
      {nudge && (
        <p id={nudgeId} className="text-xs text-foreground">
          Without a message, editors only see that the value does not match the
          required format. Say what it needs.
        </p>
      )}
      {/* Which failure this message describes is the caller's, not something
          this component can see. Naming the Pattern is right where the runtime
          applies the message to that rule, and wrong where the same string also
          reaches required, length and format failures — copy written for a
          regex would then appear on failures it does not describe. */}
      <p className="text-xs text-muted-foreground">
        {describes === "pattern"
          ? "Shown when the value fails the Pattern above. Falls back to a default message if blank."
          : "Shown when the value fails validation. Falls back to a default message if blank."}
      </p>
    </div>
  );
}
