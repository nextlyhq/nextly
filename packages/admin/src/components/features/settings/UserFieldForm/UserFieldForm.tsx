"use client";

/**
 * The user-field editor: the shared field picker chooses a new field's type
 * and label, and the shared settings panel edits it, configured for user
 * fields (`users-field-surface`). The page keeps its own save, one field at a
 * time: what the panel edits is checked by the user-field schema (reserved
 * names, choices, bounds) and handed to the page as form values.
 */
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  FormActions,
  Label,
  Switch,
} from "@nextlyhq/ui";
import { USER_FIELD_TYPE_CATALOG } from "nextly/field-catalog";
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type JSX,
  type KeyboardEvent,
} from "react";

import {
  describeFieldTypes,
  FieldPicker,
  FieldSettingsPanel,
  type FieldPickerChoice,
  type FieldPickerConfig,
  type FieldSettingsField,
} from "@admin/components/field-ui";
import { Info, Loader2 } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import type { UserFieldDefinitionRecord } from "@admin/services/userFieldsApi";

import {
  buildUserFieldSchema,
  DEFAULT_VALUES,
  fieldToFormValues,
  LENGTH_BOUND_TYPES,
  type UserFieldFormValues,
} from "./schemas/userFieldSchema";
import { panelFieldToValues, valuesToPanelField } from "./user-field-panel";
import { userFieldName, usersFieldSurface } from "./users-field-surface";

// ============================================================
// UserFieldForm Component
// ============================================================

export interface UserFieldFormProps {
  mode: "create" | "edit";
  userField?: UserFieldDefinitionRecord;
  isPending: boolean;
  onSubmit: (values: UserFieldFormValues) => void;
  /**
   * Shown and not changed: the caller may read the field but not update it,
   * so every control is disabled and nothing is offered to save.
   */
  readOnly?: boolean;
}

/** The types whose placeholder a user field keeps. */
const PLACEHOLDER_TYPES: readonly string[] = [
  "text",
  "textarea",
  "email",
  "url",
  "phone",
];

/**
 * The type-specific values that fit `type`, so a default or bound declared for
 * one type never survives into one it cannot fit.
 */
function keptFor(
  values: UserFieldFormValues,
  type: string
): Partial<UserFieldFormValues> {
  const lengths = LENGTH_BOUND_TYPES.includes(type);
  const numeric = type === "number";
  return {
    options: type === "select" || type === "radio" ? values.options : [],
    hasMany: type === "select" ? values.hasMany : false,
    placeholder: PLACEHOLDER_TYPES.includes(type) ? values.placeholder : "",
    minLength: lengths ? values.minLength : "",
    maxLength: lengths ? values.maxLength : "",
    minValue: numeric ? values.minValue : "",
    maxValue: numeric ? values.maxValue : "",
    defaultValue: "",
  };
}

/**
 * The values with the type changed, keeping only what fits it. The label is
 * the one the picker was given; the name follows it only while it still
 * follows the old label, so a name the person typed is kept.
 */
function withType(
  values: UserFieldFormValues,
  choice: FieldPickerChoice
): UserFieldFormValues {
  const nameFollowedLabel =
    values.name === "" || values.name === userFieldName(values.label);
  return {
    ...values,
    ...keptFor(values, choice.type),
    type: choice.type,
    label: choice.label,
    name: nameFollowedLabel ? choice.name : values.name,
  };
}

/**
 * Whether an Enter key press saves the field: one in a single-line text box
 * that no control inside already answered (a list's own Enter, a picker's
 * search), and not while an input method is composing a character.
 */
function enterSaves(event: KeyboardEvent<HTMLElement>): boolean {
  const target = event.target;
  return (
    event.key === "Enter" &&
    !event.defaultPrevented &&
    !event.nativeEvent.isComposing &&
    target instanceof HTMLInputElement &&
    target.getAttribute("role") !== "combobox" &&
    !["checkbox", "radio", "button", "submit", "file"].includes(target.type)
  );
}

/** What the user-field schema refuses in the values, as sentences. */
function problemsIn(
  mode: "create" | "edit",
  values: UserFieldFormValues
): { problems: string[]; values: UserFieldFormValues } {
  const result = buildUserFieldSchema(mode).safeParse(values);
  if (result.success) {
    return { problems: [], values: result.data as UserFieldFormValues };
  }
  return {
    problems: result.error.issues.map(issue => issue.message),
    values,
  };
}

export function UserFieldForm({
  mode,
  userField,
  isPending,
  onSubmit,
  readOnly = false,
}: UserFieldFormProps): JSX.Element {
  const isEdit = mode === "edit";
  const isCodeSourced = isEdit && userField?.source === "code";
  // A code-defined field cannot be changed here by anyone, and no field by a
  // caller who may only read it: either way the form shows and offers nothing.
  const isLocked = isCodeSourced || readOnly;
  const activeId = useId();

  // `null` while a new field has no type yet: the picker chooses it first.
  const [values, setValues] = useState<UserFieldFormValues | null>(() =>
    userField ? fieldToFormValues(userField) : null
  );
  const [dirty, setDirty] = useState(false);
  // Opened by the person, not on arrival: a dialog that opens by itself hides
  // the page it sits on before anyone has seen it.
  const [picking, setPicking] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  // The field arrives after the page does when it is opened directly.
  useEffect(() => {
    if (userField && isEdit) setValues(fieldToFormValues(userField));
  }, [userField, isEdit]);

  // Name, type and a dropdown's "several choices" identify the stored values,
  // which the server never moves: fixed once the field exists, as it refuses.
  const surface = useMemo(() => usersFieldSurface(isEdit), [isEdit]);
  const pickerConfig = useMemo<FieldPickerConfig>(
    () => ({
      surface: "users",
      types: describeFieldTypes(USER_FIELD_TYPE_CATALOG),
      deriveName: userFieldName,
    }),
    []
  );

  const panelField = useMemo(
    () => (values ? valuesToPanelField(values) : null),
    [values]
  );

  const change = (next: UserFieldFormValues) => {
    setValues(next);
    setDirty(true);
    setProblems([]);
  };

  const pick = (choice: FieldPickerChoice) => {
    change(withType(values ?? DEFAULT_VALUES, choice));
    setPicking(false);
  };

  const submit = () => {
    if (!values) return;
    const checked = problemsIn(mode, values);
    setProblems(checked.problems);
    if (checked.problems.length === 0) onSubmit(checked.values);
  };

  return (
    // Enter in a text box saves, as it did when this was one form element.
    // Not a <form>: the shared panel's buttons carry no type, and inside a
    // form each would submit it.
    <div
      className="space-y-6"
      onKeyDown={event => {
        if (isLocked || !enterSaves(event)) return;
        event.preventDefault();
        submit();
      }}
    >
      {isCodeSourced && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Code-defined field</AlertTitle>
          <AlertDescription>
            This field is defined in code (defineConfig) and cannot be edited
            here. To modify it, update your application configuration file.
          </AlertDescription>
        </Alert>
      )}

      {values && panelField ? (
        <div className="overflow-hidden rounded-md border border-border">
          <FieldSettingsPanel
            surface={surface}
            field={panelField}
            ancestors={[]}
            siblings={[]}
            saved={isEdit}
            readOnly={isLocked}
            onChange={(next: FieldSettingsField) =>
              change(panelFieldToValues(next, values))
            }
            // Before the field exists its type is still a choice to remake.
            actions={
              !isEdit &&
              !isLocked && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPicking(true)}
                >
                  Change type…
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Choose what kind of field this is.
          </p>
          <Button type="button" onClick={() => setPicking(true)}>
            Choose a field type
          </Button>
        </div>
      )}

      {values && (
        <div className="flex items-center justify-between rounded-md border border-border p-4">
          <div className="space-y-0.5">
            <Label htmlFor={activeId}>Active</Label>
            <p className="text-xs text-muted-foreground">
              An inactive field is kept, with its values, but not shown on user
              accounts.
            </p>
          </div>
          <Switch
            id={activeId}
            checked={values.isActive}
            disabled={isLocked}
            onCheckedChange={isActive => change({ ...values, isActive })}
          />
        </div>
      )}

      {problems.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>The field cannot be saved yet</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {problems.map(problem => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {!isLocked && (
        <FormActions dirty={dirty}>
          <Link href={ROUTES.USERS_FIELDS}>
            <Button type="button" variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </Link>
          <Button
            type="button"
            disabled={isPending || !values}
            onClick={submit}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {isEdit ? "Updating..." : "Creating..."}
              </>
            ) : isEdit ? (
              "Update Field"
            ) : (
              "Create Field"
            )}
          </Button>
        </FormActions>
      )}

      {!isEdit && (
        <FieldPicker
          open={picking}
          config={pickerConfig}
          title={values ? "Change the field's type" : undefined}
          initialLabel={values?.label}
          // One field per page: there is no "another" to add here.
          offerAddAnother={false}
          onCancel={() => setPicking(false)}
          onAdd={choice => pick(choice)}
        />
      )}
    </div>
  );
}
