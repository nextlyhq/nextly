---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
"nextly": patch
---

The admin downloads about 150 KB (gzipped) less before its first screen draws: 331 KB of shared code is now 179 KB. `@nextlyhq/admin` now exports only what an application mounts and reads the admin with: `RootLayout`, `QueryProvider`, `ThemeProvider`, `ThemePaintScript`, `useTheme`, `BrandingProvider`, `useBranding`, `ErrorBoundary`, `QueryErrorBoundary`, `CommandPalette`, `registerComponent`, `registerComponents`, `registerComponentMap`, `useCan`, `Can`, the data hooks and UI primitives its README lists, and `Toaster` and `toast`. The parts plugin pages are built from (the media library, the field-UI kit, the document surfaces, the data table, the widget kit, the plugin-page parts) now load with the pages that use them.

Plugins change nothing: they import these parts from `@nextlyhq/plugin-sdk/admin`, as before, and every name there is unchanged. A component path in a site's or plugin's config that names one of them on `@nextlyhq/admin` (`@nextlyhq/admin#MediaLibrary`) keeps working: `nextly generate:types` now imports it from where it lives. Code that imported any of them from `@nextlyhq/admin` directly, which plugins were never meant to do, must change its import: import from `@nextlyhq/plugin-sdk/admin` (or from `@nextlyhq/admin/kit`, only for application code that must). The documented ones are `Breadcrumbs`, `Checklist`, `ChecklistItem`, `ChecklistMark`, `ChecklistProgress`, `ConditionRow`, `DataTableView`, `DocumentPrimaryAction`, `DocumentSaveIndicator`, `EDITABLE_VALIDATION_RULES`, `FieldDefaultValueInput`, `FieldOptionsEditor`, `FieldPicker`, `FieldSettingsPanel`, `FieldTypePicker`, `FileDropArea`, `FormLabelWithTooltip`, `FrameState`, `ListColumnsMenu`, `ListEmptyState`, `ListToolbar`, `ListView`, `PlaceTabs`, `SegmentedChoice`, `SettingsRowGroup`, `Stepper`, `TargetSlot`, `TopBarPlace`, `ValidationNumberField`, `ValidationRulesEditor`, `Widget`, `apiErrorMessage`, `describeFieldTypes`, `drawsAnyValidationRule`, `formatWidgetTime`, `humanizeFieldName`, `isApiError`, `operatorTakesValue`, `operatorsForType`, `readPluginRoute`, `registerKnownPlugin`, `toastMutationResult`, `useBeforeDocumentAction`, `useCurrentUserId`, `useDocumentActions`, `useDocumentField`, `useDocumentLocale`, `useDocumentValues`, `useFieldAddress`, `useFoldedPanel`, `useListColumns`, `usePluginClientConfig`, `usePluginFieldTypeEntries`, `usePluginRoute`, `usePluginRouteMutation`, `usePluginTranslate`, `useRefreshDashboard`, `useReportUnsavedWork`, `useSingleDocument`, `useSuppressAdminChrome`, `useTableColumns`, `useTrackedWrite`, `useUpdateSingleDocument`, `useUploadMedia`, `useWidgetClock`, `validationIssues`, `withOptionIds`, `writePluginRoute`, and the types `ActionGroup`, `ActionPlacement`, `AdminChromeLayer`, `ApiError`, `BeforeDocumentAction`, `BreadcrumbItem`, `BreadcrumbsProps`, `CardEmptyContent`, `CardState`, `ChallengeResolveResult`, `ChallengeViewProps`, `ChecklistDoneStyle`, `ChecklistItemProps`, `ChecklistMarkProps`, `ChecklistProgressProps`, `ChecklistProps`, `ChecklistStatus`, `ConditionOperatorName`, `ConditionRange`, `ConditionRowProps`, `ConditionSource`, `ConditionSourceOption`, `ConditionValue`, `CustomEditViewProps`, `DataTableGroup`, `DataTableGrouping`, `DataTableRowDetail`, `DataTableViewProps`, `DocumentAction`, `DocumentActionOutcome`, `DocumentActionReplacementProps`, `DocumentActions`, `DocumentChangeResult`, `DocumentField`, `DocumentPanelSectionProps`, `DocumentSaveState`, `DocumentTabProps`, `DocumentViewProps`, `FieldAddress`, `FieldDefaultOption`, `FieldDefaultValueInputProps`, `FieldGroupOption`, `FieldOption`, `FieldOptionsEditorProps`, `FieldPickerChoice`, `FieldPickerConfig`, `FieldPickerProps`, `FieldSettingsConditionsProps`, `FieldSettingsControlProps`, `FieldSettingsField`, `FieldSettingsPanelProps`, `FieldSettingsSurface`, `FieldSettingsSurfaceControlProps`, `FieldSettingsTab`, `FieldTypeDescription`, `FieldTypePickerProps`, `FieldTypeSettings`, `FileDropAreaProps`, `FixedFieldSetting`, `ListColumnsControl`, `ListEmpty`, `ListSearch`, `ListSlots`, `ListToolbarProps`, `ListViewProps`, `NextlyColumn`, `PlaceContributionProps`, `PlaceProps`, `PlaceTabBadge`, `PlaceTabProps`, `PlaceTabsProps`, `PluginRouteInvalidation`, `PluginRouteMethod`, `PluginRouteRead`, `PluginRouteRequest`, `PluginRouteWrite`, `PluginRouteWriter`, `SegmentedChoiceProps`, `SegmentedChoiceSize`, `SegmentedOption`, `SettingsRowGroupProps`, `SidebarSectionProps`, `SkeletonShape`, `StepState`, `StepperProps`, `StepperStep`, `SubmitRefusal`, `TargetSlotProps`, `TopBarPlaceName`, `TopBarPlaceProps`, `UseListColumnsOptions`, `UseTableColumnsOptions`, `UseTableColumnsResult`, `ValidationIssue`, `ValidationNumberFieldProps`, `ValidationRuleValues`, `ValidationRulesEditorProps`, `WidgetBarChartGroup`, `WidgetBarChartProps`, `WidgetChartUnit`, `WidgetFigureProps`, `WidgetListProps`, `WidgetListTotal`, `WidgetRenderSize`, `WidgetRowAction`, `WidgetSeries`, `WidgetSeriesChartProps`, `WidgetSeriesInterval`, `WidgetSeriesPoint`, `WidgetTableColumn`, `WidgetTableProps`. The SDK takes them from `@nextlyhq/admin/kit`, which is internal and may change in any release: import the SDK, never the kit.
