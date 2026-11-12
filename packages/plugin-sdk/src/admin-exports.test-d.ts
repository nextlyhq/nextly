import { expectTypeOf } from "vitest";
import type { ComponentType, ReactNode } from "react";
import type {
  FieldTypeCatalogEntry,
  FieldValidationRule,
} from "nextly/field-catalog";

import type { PluginAdminContributions as RootAdminContributions } from "@nextlyhq/plugin-sdk";
import * as adminEntry from "@nextlyhq/plugin-sdk/admin";
import type {
  WidgetBarChartProps,
  WidgetFigureProps,
  WidgetListProps,
  WidgetSeriesChartProps,
  WidgetTableProps,
} from "@nextlyhq/plugin-sdk/admin";
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
  CustomEditViewProps,
  DocumentLockGates,
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

// The signed-in user's id, or null when none is known: a plugin keying
// something per user must handle "nobody" rather than receive a placeholder.
expectTypeOf(adminEntry.useCurrentUserId).returns.toEqualTypeOf<
  string | null
>();
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
// The custom Edit view contract.
//
// A plugin registering `views.Edit.Component` is handed these, and the pair a
// colleague's claim withholds travels with them. The assertion that earns its
// place is the SECOND one: the contract's field and the published type are the
// same type, so a plugin typing a prop as `DocumentLockGates` is typing it as
// whatever the contract carries rather than as a copy that agreed once.
//
// The first pins the shape. It is a restatement on purpose — renaming an
// affordance in the admin should have to be a deliberate act here rather than
// a silent one, and this is the line that says so.
// ---------------------------------------------------------------------------

expectTypeOf<DocumentLockGates>().toEqualTypeOf<{
  readonly readOnly: boolean;
  readonly actionsDisabled: boolean;
}>();
expectTypeOf<CustomEditViewProps["documentLock"]>().toEqualTypeOf<
  DocumentLockGates | undefined
>();
expectTypeOf<CustomEditViewProps>().toMatchTypeOf<{
  collectionSlug: string;
  isCreating: boolean;
}>();
// The page of the view an address names: a path, or absent on the edit address.
expectTypeOf<CustomEditViewProps["view"]>().toEqualTypeOf<string | undefined>();

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

// The widget kit: `Widget.*` holds the parts core's own cards are drawn with. Each part's props
// are the published `Widget*Props` types, so a view written against them type-checks against the
// part itself. The formatters and the colour accessor are the server-safe root's, not here.

const { Widget } = adminEntry;
expectTypeOf(Widget.Figure).parameter(0).toEqualTypeOf<WidgetFigureProps>();
expectTypeOf(Widget.BarChart).parameter(0).toEqualTypeOf<WidgetBarChartProps>();
expectTypeOf(Widget.SeriesChart)
  .parameter(0)
  .toEqualTypeOf<WidgetSeriesChartProps>();
expectTypeOf(Widget.List<{ id: string }>)
  .parameter(0)
  .toEqualTypeOf<WidgetListProps<{ id: string }>>();
expectTypeOf(Widget.Table<{ id: string }>)
  .parameter(0)
  .toEqualTypeOf<WidgetTableProps<{ id: string }>>();
// The dashboard refresh is a hook answering a function of nothing.
expectTypeOf(adminEntry.useRefreshDashboard).returns.toEqualTypeOf<
  () => void
>();
// The title count is a hook of a count, a short phrase or none, with a floor flag, and answers
// nothing.
expectTypeOf(Widget.useTitleCount)
  .parameter(0)
  .toEqualTypeOf<number | string | undefined>();
expectTypeOf(Widget.useTitleCount)
  .parameter(1)
  .toEqualTypeOf<boolean | undefined>();
expectTypeOf(Widget.useTitleCount).returns.toBeVoid();
// A chart's unit is part of both charts' props, as core's cards pass it.
expectTypeOf<WidgetBarChartProps>().toHaveProperty("unit");
expectTypeOf<WidgetSeriesChartProps>().toHaveProperty("unit");
// A table takes at most three columns beside its title, what a narrow card's row holds.
type Column = WidgetTableProps<{ id: string }>["columns"][number];
expectTypeOf<readonly [Column, Column, Column]>().toMatchTypeOf<
  WidgetTableProps<{ id: string }>["columns"]
>();
expectTypeOf<readonly [Column, Column, Column, Column]>().not.toMatchTypeOf<
  WidgetTableProps<{ id: string }>["columns"]
>();
// A client module cannot be called from a Server Component, so the formatters are not here.
expectTypeOf(adminEntry).not.toHaveProperty("formatWidgetNumber");
expectTypeOf(adminEntry).not.toHaveProperty("formatWidgetChange");
expectTypeOf(adminEntry).not.toHaveProperty("widgetChartColour");
// The names the kit replaced are gone, with no alias.
expectTypeOf(adminEntry).not.toHaveProperty("CardFigure");
expectTypeOf(adminEntry).not.toHaveProperty("cardNumber");
expectTypeOf(adminEntry).not.toHaveProperty("cardChange");
expectTypeOf(adminEntry).not.toHaveProperty("GroupsChart");
expectTypeOf(adminEntry).not.toHaveProperty("OverTimeChart");

// ---------------------------------------------------------------------------
// The shared field picker and the field-type description (@experimental).
//
// New names beside the field-UI kit, which `field-ui-compat.test-d.ts` keeps
// pinned as it was. The props are asserted EXACTLY against a consumer's view
// of them, so a prop renamed, dropped or widened to `any` fails here, and the
// description is asserted to be the catalog row plus its search words.
type PickerProps = Parameters<typeof adminEntry.FieldPicker>[0];
expectTypeOf<PickerProps>().toEqualTypeOf<adminEntry.FieldPickerProps>();
expectTypeOf<adminEntry.FieldPickerProps>().toEqualTypeOf<{
  open: boolean;
  config: adminEntry.FieldPickerConfig;
  title?: string;
  placement?: string;
  initialLabel?: string;
  offerAddAnother?: boolean;
  onCancel: () => void;
  onAdd: (
    choice: adminEntry.FieldPickerChoice,
    how: { addAnother: boolean }
  ) => void;
}>();
expectTypeOf<adminEntry.FieldPickerConfig>().toEqualTypeOf<{
  surface: "entries" | "users" | "forms" | "blocks";
  types: readonly adminEntry.FieldTypeDescription<string>[];
  exclude?: readonly string[];
  mostUsed?: readonly string[];
  deriveName: (label: string) => string;
  fieldGroups?: {
    type: string;
    options: readonly adminEntry.FieldGroupOption[];
    loading?: boolean;
  };
}>();
expectTypeOf<adminEntry.FieldPickerChoice>().toEqualTypeOf<{
  type: string;
  label: string;
  name: string;
  fieldGroup?: string;
}>();
expectTypeOf<adminEntry.FieldGroupOption>().toEqualTypeOf<{
  slug: string;
  label: string;
  text: string;
}>();
expectTypeOf<adminEntry.FieldTypeDescription<"rating">>().toEqualTypeOf<{
  type: "rating";
  label: string;
  category: "Basic" | "Advanced" | "Media" | "Relational" | "Structured";
  hint: string;
  icon: string;
  synonyms: readonly string[];
}>();
// One description function, generic over the surface's own type union.
expectTypeOf(adminEntry.describeFieldTypes<"rating">)
  .parameter(0)
  .toEqualTypeOf<readonly FieldTypeCatalogEntry<"rating">[]>();
expectTypeOf(adminEntry.describeFieldTypes<"rating">).returns.toEqualTypeOf<
  adminEntry.FieldTypeDescription<"rating">[]
>();

// ---------------------------------------------------------------------------
// The shared field settings panel and its surface configuration
// (@experimental). Asserted EXACTLY, as the picker is, so a prop renamed,
// dropped or widened to `any` fails here rather than in a plugin.
type PanelProps = Parameters<typeof adminEntry.FieldSettingsPanel>[0];
expectTypeOf<PanelProps>().toEqualTypeOf<adminEntry.FieldSettingsPanelProps>();
expectTypeOf<adminEntry.FieldSettingsPanelProps>().toEqualTypeOf<{
  surface: adminEntry.FieldSettingsSurface;
  field: adminEntry.FieldSettingsField;
  ancestors: readonly adminEntry.FieldSettingsField[];
  siblings: readonly adminEntry.FieldSettingsField[];
  saved: boolean;
  readOnly?: boolean;
  onChange: (next: adminEntry.FieldSettingsField) => void;
  onClose?: () => void;
  actions?: ReactNode;
}>();
expectTypeOf<adminEntry.FieldSettingsSurface>().toEqualTypeOf<{
  surface: "entries" | "users" | "forms" | "blocks";
  deriveName: (label: string) => string;
  fixed?: readonly adminEntry.FixedFieldSetting[];
  extraSettings?: Partial<
    Record<
      adminEntry.FieldSettingsTab,
      ComponentType<adminEntry.FieldSettingsSurfaceControlProps>
    >
  >;
  conditions:
    | "sibling"
    | "none"
    | ComponentType<adminEntry.FieldSettingsConditionsProps>;
  validationRules?: (
    type: string,
    allowed: readonly FieldValidationRule[]
  ) => readonly FieldValidationRule[];
  displaySwitches?: boolean;
  widthSetting?: boolean;
  pluginSettings?: boolean;
  typeSettings?: Readonly<
    Partial<Record<string, adminEntry.FieldTypeSettings>>
  >;
}>();
expectTypeOf<adminEntry.FixedFieldSetting>().toEqualTypeOf<{
  setting: "name" | "type";
  when: "always" | "saved";
  reason: string;
}>();
expectTypeOf<adminEntry.FieldSettingsTab>().toEqualTypeOf<
  "general" | "validation" | "display" | "conditions" | "advanced"
>();
expectTypeOf<adminEntry.FieldTypeSettings>().toEqualTypeOf<{
  defining?: ComponentType<adminEntry.FieldSettingsControlProps>;
  tabs?: Partial<
    Record<
      adminEntry.FieldSettingsTab,
      ComponentType<adminEntry.FieldSettingsControlProps>
    >
  >;
}>();
// The field it edits carries the definition's own keys, so a surface can map
// its storage to and from it.
expectTypeOf<adminEntry.FieldSettingsField>().toHaveProperty("id");
expectTypeOf<adminEntry.FieldSettingsField>().toHaveProperty("name");
expectTypeOf<adminEntry.FieldSettingsField>().toHaveProperty("type");

// A plugin's one-shot write to its own route: the caller names the answer's
// shape, and a refusal arrives as a rejection rather than as `undefined`.
expectTypeOf(
  adminEntry.writePluginRoute<{ message: string }>
).returns.toEqualTypeOf<Promise<{ message: string } | undefined>>();

// ---------------------------------------------------------------------------
// The admin's page building blocks (@experimental): the list surface, the
// top-bar trail, the segmented control, the checklist, the grouped settings
// row, the row layout of `FieldShell` and the status badge.
//
// Each component's first parameter is asserted EQUAL to its published props
// type, so a plugin typing a wrapper against `ListViewProps` is typing it
// against the component itself rather than a copy that agreed once; and the
// props a plugin page actually passes are pinned, so one going missing in the
// forwarding through two barrels fails here rather than in a plugin's build.
// ---------------------------------------------------------------------------

type Row = { id: string; title: string };
expectTypeOf(adminEntry.ListView<Row>)
  .parameter(0)
  .toEqualTypeOf<adminEntry.ListViewProps<Row>>();
expectTypeOf<adminEntry.ListViewProps<Row>>().toMatchTypeOf<
  adminEntry.DataTableViewProps<Row>
>();
expectTypeOf<adminEntry.ListViewProps<Row>>().toMatchTypeOf<{
  search?: adminEntry.ListSearch;
  filters?: React.ReactNode;
  inlineFilters?: React.ReactNode;
  columnsControl?: adminEntry.ListColumnsControl<Row>;
  empty?: adminEntry.ListEmpty;
  emptyFiltered?: adminEntry.ListEmpty;
  slots?: adminEntry.ListSlots;
}>();
expectTypeOf(adminEntry.useTableColumns<Row>)
  .parameter(0)
  .toEqualTypeOf<adminEntry.UseTableColumnsOptions<Row>>();
expectTypeOf(adminEntry.useTableColumns<Row>).returns.toEqualTypeOf<
  adminEntry.UseTableColumnsResult<Row>
>();
expectTypeOf(adminEntry.useListColumns<Row>).returns.toEqualTypeOf<
  adminEntry.ListColumnsControl<Row>
>();

expectTypeOf(adminEntry.Breadcrumbs)
  .parameter(0)
  .toEqualTypeOf<adminEntry.BreadcrumbsProps>();
expectTypeOf<adminEntry.BreadcrumbItem>().toMatchTypeOf<{
  label: React.ReactNode;
  href?: string;
}>();

expectTypeOf(adminEntry.SegmentedChoice)
  .parameter(0)
  .toEqualTypeOf<adminEntry.SegmentedChoiceProps>();
expectTypeOf<adminEntry.SegmentedChoiceSize>().toEqualTypeOf<
  "compact" | "bordered"
>();

expectTypeOf(adminEntry.Checklist)
  .parameter(0)
  .toEqualTypeOf<adminEntry.ChecklistProps>();
expectTypeOf(adminEntry.ChecklistItem)
  .parameter(0)
  .toEqualTypeOf<adminEntry.ChecklistItemProps>();
expectTypeOf<adminEntry.ChecklistStatus>().toEqualTypeOf<
  "open" | "done" | "skipped"
>();

expectTypeOf(adminEntry.SettingsRowGroup)
  .parameter(0)
  .toEqualTypeOf<adminEntry.SettingsRowGroupProps>();
expectTypeOf<FieldShellProps["layout"]>().toEqualTypeOf<
  adminEntry.FieldLayout | undefined
>();
expectTypeOf<adminEntry.FieldLayout>().toEqualTypeOf<"stacked" | "row">();

// The status variants a table cell draws are among the badge's variants.
expectTypeOf<"success" | "warning" | "destructive" | "info">().toMatchTypeOf<
  NonNullable<adminEntry.BadgeProps["variant"]>
>();

// ---------------------------------------------------------------------------
// Grouped rows, rows that open a region, the stepper and the save bar's own
// message (@experimental). The grouping and the region are props of the
// admin's table, so they are pinned on BOTH the table's and the list's props:
// a prop dropped in the forwarding through two barrels fails here rather than
// in a plugin's build.
// ---------------------------------------------------------------------------

expectTypeOf<adminEntry.DataTableViewProps<Row>["grouping"]>().toEqualTypeOf<
  adminEntry.DataTableGrouping<Row> | undefined
>();
expectTypeOf<adminEntry.ListViewProps<Row>["grouping"]>().toEqualTypeOf<
  adminEntry.DataTableGrouping<Row> | undefined
>();
expectTypeOf<adminEntry.DataTableViewProps<Row>["rowDetail"]>().toEqualTypeOf<
  adminEntry.DataTableRowDetail<Row> | undefined
>();
expectTypeOf<adminEntry.ListViewProps<Row>["rowDetail"]>().toEqualTypeOf<
  adminEntry.DataTableRowDetail<Row> | undefined
>();
expectTypeOf<adminEntry.DataTableGrouping<Row>>().toMatchTypeOf<{
  groups: readonly adminEntry.DataTableGroup[];
  groupOf: (row: Row) => string;
  collapsible?: boolean;
  collapsedIds?: readonly string[];
  onCollapsedChange?: (collapsedIds: string[]) => void;
}>();
expectTypeOf<adminEntry.DataTableGroup>().toMatchTypeOf<{
  id: string;
  title: React.ReactNode;
  badge?: React.ReactNode;
  count?: React.ReactNode;
  actions?: React.ReactNode;
}>();
expectTypeOf<adminEntry.DataTableRowDetail<Row>>().toMatchTypeOf<{
  render: (row: Row) => React.ReactNode;
  hasDetail?: (row: Row) => boolean;
  expandedIds?: readonly string[];
  onExpandedChange?: (expandedIds: string[]) => void;
}>();

expectTypeOf(adminEntry.Stepper)
  .parameter(0)
  .toEqualTypeOf<adminEntry.StepperProps>();
expectTypeOf<adminEntry.StepperStep>().toMatchTypeOf<{
  label: React.ReactNode;
  href?: string;
  onSelect?: () => void;
}>();
expectTypeOf<adminEntry.StepState>().toEqualTypeOf<
  "complete" | "current" | "upcoming"
>();

expectTypeOf<adminEntry.FormActionsProps["message"]>().toEqualTypeOf<
  React.ReactNode | undefined
>();
