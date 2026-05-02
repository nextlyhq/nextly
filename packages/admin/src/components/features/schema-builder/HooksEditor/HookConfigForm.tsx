/**
 * HookConfigForm Component
 *
 * Renders a configuration form based on the hook's Zod schema.
 * Dynamically generates form fields by introspecting Zod types.
 *
 * @module components/features/schema-builder/HooksEditor/HookConfigForm
 */

import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@revnixhq/ui";

import { cn } from "@admin/lib/utils";

import type { HookConfigFormProps } from "../types";

import { getPrebuiltHook } from "./utils/prebuiltHooks";
import {
  getZodTypeName,
  isZodType,
  unwrapZodType,
  getObjectShape,
  hasUrlCheck,
  getEnumValues,
  getArrayInnerType,
} from "./utils/zodIntrospection";

/**
 * Renders a configuration form based on the hook's Zod schema
 */
export function HookConfigForm({
  hookId,
  config,
  onConfigChange,
  fieldNames,
}: HookConfigFormProps) {
  const hookConfig = getPrebuiltHook(hookId);

  if (!hookConfig) {
    return <div className="text-sm text-muted-foreground">Hook not found</div>;
  }

  const schema = hookConfig.configSchema;

  // Only handle object schemas
  if (!isZodType(schema, "object")) {
    return (
      <div className="text-sm text-muted-foreground">
        No configuration options
      </div>
    );
  }

  const shape = getObjectShape(schema);
  const fields = Object.entries(shape);

  if (fields.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No configuration options
      </div>
    );
  }

  const handleFieldChange = (key: string, value: unknown) => {
    onConfigChange({ ...config, [key]: value });
  };

  return (
    <div className="space-y-3">
      {fields.map(([key, fieldSchema]) => {
        const zodField = fieldSchema;
        const description = zodField.description || key;
        const value = config[key];

        // Unwrap defaults and optionals to get the base type
        const {
          innerSchema: baseSchema,
          hasDefault,
          isOptional,
        } = unwrapZodType(zodField);
        const baseTypeName = getZodTypeName(baseSchema);

        // Check if this is a field reference (sourceField, targetField, field, etc.)
        const isFieldReference =
          key.toLowerCase().includes("field") && baseTypeName === "string";

        // Render based on type
        if (baseTypeName === "boolean") {
          return (
            <div key={key} className="flex items-center justify-between py-1">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium capitalize">
                  {key.replace(/([A-Z])/g, " $1").trim()}
                </Label>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
              <Switch
                checked={Boolean(value)}
                onCheckedChange={checked => handleFieldChange(key, checked)}
              />
            </div>
          );
        }

        if (baseTypeName === "string") {
          // Check if it's a URL field
          const isUrl =
            hasUrlCheck(baseSchema) || key.toLowerCase().includes("url");

          // Field reference - show dropdown
          if (isFieldReference && fieldNames.length > 0) {
            return (
              <div key={key} className="space-y-1.5">
                <Label
                  htmlFor={`hook-${hookId}-${key}`}
                  className="text-xs font-medium capitalize"
                >
                  {key.replace(/([A-Z])/g, " $1").trim()}
                  {!isOptional && !hasDefault && (
                    <span className="text-destructive ml-1">*</span>
                  )}
                </Label>
                <Select
                  value={
                    // eslint-disable-next-line @typescript-eslint/no-base-to-string
                    String(value ?? "")
                  }
                  onValueChange={val =>
                    handleFieldChange(key, val === "__none__" ? "" : val)
                  }
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select field..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">
                        Select a field...
                      </span>
                    </SelectItem>
                    {fieldNames.map(fieldName => (
                      <SelectItem key={fieldName} value={fieldName}>
                        {fieldName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
            );
          }

          // Regular string input
          return (
            <div key={key} className="space-y-1.5">
              <Label
                htmlFor={`hook-${hookId}-${key}`}
                className="text-xs font-medium capitalize"
              >
                {key.replace(/([A-Z])/g, " $1").trim()}
                {!isOptional && !hasDefault && (
                  <span className="text-destructive ml-1">*</span>
                )}
              </Label>
              <Input
                id={`hook-${hookId}-${key}`}
                value={
                    // eslint-disable-next-line @typescript-eslint/no-base-to-string
                    String(value ?? "")
                  }
                onChange={e => handleFieldChange(key, e.target.value)}
                placeholder={description}
                type={isUrl ? "url" : "text"}
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          );
        }

        if (baseTypeName === "array") {
          const innerType = getArrayInnerType(baseSchema);
          const innerTypeName = innerType ? getZodTypeName(innerType) : "";

          // Array of enums (checkboxes)
          if (innerTypeName === "enum") {
            const options = innerType ? getEnumValues(innerType) : [];
            const currentValues = Array.isArray(value) ? value : [];

            return (
              <div key={key} className="space-y-2">
                <Label className="text-xs font-medium capitalize">
                  {key.replace(/([A-Z])/g, " $1").trim()}
                </Label>
                <div className="flex flex-wrap gap-2">
                  {options.map((option: string) => {
                    const isChecked = currentValues.includes(option);
                    return (
                      <label
                        key={option}
                        className={cn(
                          "flex items-center gap-1.5 px-2 py-1 rounded-none text-xs cursor-pointer border",
                          isChecked
                            ? "bg-primary/10 border-primary text-primary"
                            : "bg-primary/5 border-transparent text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={e => {
                            const newValues = e.target.checked
                              ? [...currentValues, option]
                              : currentValues.filter(
                                  (v: string) => v !== option
                                );
                            handleFieldChange(key, newValues);
                          }}
                          className="sr-only"
                        />
                        {option}
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
            );
          }
        }

        // Fallback for unknown types
        return (
          <div key={key} className="space-y-1.5">
            <Label className="text-xs font-medium capitalize">
              {key.replace(/([A-Z])/g, " $1").trim()}
            </Label>
            <Input
              value={
                    // eslint-disable-next-line @typescript-eslint/no-base-to-string
                    String(value ?? "")
                  }
              onChange={e => handleFieldChange(key, e.target.value)}
              placeholder={description}
              className="h-8 text-sm"
            />
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        );
      })}
    </div>
  );
}
