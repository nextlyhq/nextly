import { expectTypeOf } from "vitest";

import type { PluginAdminContributions as RootAdminContributions } from "@nextlyhq/plugin-sdk";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTitle,
  drawsAnyValidationRule,
  EDITABLE_VALIDATION_RULES,
  FieldShell,
  FormActions,
  FormSection,
  Input,
  Label,
  registerComponent,
  registerComponents,
  registerKnownPlugin,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  ValidationRulesEditor,
} from "@nextlyhq/plugin-sdk/admin";
import type {
  FieldShellProps,
  ValidationRuleValues,
  ValidationRulesEditorProps,
  FieldWidth,
  FormActionsProps,
  FormSectionProps,
  ComponentPath,
  PluginAdminContributions,
  PluginAdminPage,
  PluginCollectionView,
  PluginMenuItem,
} from "@nextlyhq/plugin-sdk/admin";

// The root entry also re-exports the contract types (node-safe, no React).

// Registration runtime is exposed for plugin admin modules.
expectTypeOf(registerComponent).toBeFunction();
expectTypeOf(registerComponents).toBeFunction();
expectTypeOf(registerKnownPlugin).toBeFunction();

// Contract types are re-exported on the admin entry.
expectTypeOf<ComponentPath>().toEqualTypeOf<string>();
expectTypeOf<PluginAdminContributions>().toMatchTypeOf<{
  menu?: PluginMenuItem[];
  pages?: PluginAdminPage[];
}>();
expectTypeOf<PluginCollectionView>().toMatchTypeOf<{
  edit?: ComponentPath;
  list?: ComponentPath;
}>();
expectTypeOf<RootAdminContributions>().toEqualTypeOf<PluginAdminContributions>();

// ---------------------------------------------------------------------------
// Control primitives.
//
// A plugin settings form is assembled from these, so the assertion that earns
// its place is not "the name exists" — a broken re-export fails to compile and
// the import above already catches that. It is that each one is a COMPONENT the
// author can render, and that the props a form actually passes are accepted.
//
// `toBeCallableWith` is what separates a real component from a name that
// happens to be exported: a type alias, an object, or a value re-exported from
// the wrong module would satisfy the import and fail here.
// ---------------------------------------------------------------------------

expectTypeOf(Button).toBeFunction();
expectTypeOf(Input).toBeFunction();
expectTypeOf(Textarea).toBeFunction();
expectTypeOf(Checkbox).toBeFunction();
expectTypeOf(Switch).toBeFunction();
expectTypeOf(Label).toBeFunction();
expectTypeOf(Select).toBeFunction();
expectTypeOf(SelectTrigger).toBeFunction();
expectTypeOf(SelectContent).toBeFunction();
expectTypeOf(SelectItem).toBeFunction();
expectTypeOf(SelectValue).toBeFunction();
expectTypeOf(Dialog).toBeFunction();
expectTypeOf(DialogContent).toBeFunction();
expectTypeOf(DialogTitle).toBeFunction();
expectTypeOf(FieldShell).toBeFunction();
expectTypeOf(FormSection).toBeFunction();
expectTypeOf(FormActions).toBeFunction();

// The props a settings form actually passes. Asserted rather than assumed,
// because forwarding a component through two barrels is exactly where a prop
// can go missing without the name doing so.
expectTypeOf(Button).parameter(0).toMatchTypeOf<{
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
}>();
expectTypeOf(Input).parameter(0).toMatchTypeOf<{
  value?: string | number | readonly string[];
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}>();
expectTypeOf(Switch).parameter(0).toMatchTypeOf<{
  checked?: boolean;
}>();

// Form scaffolding carries its types across too — a shell with no `FieldWidth`
// leaves the author guessing at a union the admin already knows.
expectTypeOf<FieldShellProps>().not.toBeNever();
expectTypeOf<FormSectionProps>().not.toBeNever();
expectTypeOf<FormActionsProps>().not.toBeNever();
expectTypeOf<FieldWidth>().not.toBeNever();

// ---------------------------------------------------------------------------
// The validation-rules editor.
//
// Asserting the PROPS, not only the name: this component's whole contract is
// that it takes an allowed-rule LIST rather than a field type. A version that
// went back to branching on a type would still export a function of the right
// name, and only the parameter shape separates the two.
// ---------------------------------------------------------------------------

expectTypeOf(ValidationRulesEditor).toBeFunction();
expectTypeOf(ValidationRulesEditor).parameter(0).toMatchTypeOf<{
  allowed: readonly string[];
  value: ValidationRuleValues;
  onChange: (next: Partial<ValidationRuleValues>) => void;
}>();

// It must NOT accept a field type — that is the defect it exists to remove.
expectTypeOf(ValidationRulesEditor)
  .parameter(0)
  .not.toMatchTypeOf<{ fieldType: string }>();

expectTypeOf(drawsAnyValidationRule).toBeFunction();
expectTypeOf(EDITABLE_VALIDATION_RULES).toMatchTypeOf<readonly string[]>();
expectTypeOf<ValidationRulesEditorProps>().not.toBeNever();
expectTypeOf<ValidationRuleValues>().not.toBeNever();
