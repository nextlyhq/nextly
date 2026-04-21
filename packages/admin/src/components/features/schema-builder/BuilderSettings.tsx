import { Input } from "@revnixhq/ui";
import React from "react";
import { useFormContext } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";
import { simplePluralize } from "@admin/lib/fields";

interface BuilderSettingsProps {
  entityType?: "collection" | "single" | "component";
  isSaving: boolean;
  children?: React.ReactNode;
}

export function BuilderSettings({
  entityType = "collection",
  isSaving,
  children,
}: BuilderSettingsProps) {
  const form = useFormContext();

  const entityLabel =
    entityType === "single"
      ? "Single"
      : entityType === "component"
        ? "Component"
        : "Collection";

  // Handle singular name change
  const handleSingularNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    const previousName = form.getValues("singularName");
    form.setValue("singularName", name, { shouldValidate: true });

    const values = form.getValues();
    if (values && Object.prototype.hasOwnProperty.call(values, "pluralName")) {
      const currentPlural = form.getValues("pluralName");
      const previousAutoPlural = simplePluralize(previousName);

      if (!currentPlural || currentPlural === previousAutoPlural) {
        form.setValue("pluralName", simplePluralize(name), {
          shouldValidate: true,
        });
      }
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="space-y-5">
        {/* Singular Name input */}
        <FormField
          control={form.control}
          name="singularName"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {entityType === "collection"
                  ? "Singular Name"
                  : `${entityLabel} Name`}
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  onChange={handleSingularNameChange}
                  placeholder={
                    entityType === "single"
                      ? "e.g., Site Settings"
                      : entityType === "component"
                        ? "e.g., SEO Metadata"
                        : "e.g., Blog Post"
                  }
                  disabled={isSaving}
                  className="bg-muted/30 border-border/50 focus:bg-background transition-all"
                />
              </FormControl>
              <FormMessage className="text-[11px]" />
            </FormItem>
          )}
        />

        {/* Plural Name input (collections only) */}
        {entityType === "collection" && (
          <FormField
            control={form.control}
            name="pluralName"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Plural Name
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="e.g., Blog Posts"
                    disabled={isSaving}
                    className="bg-muted/30 border-border/50 focus:bg-background transition-all"
                  />
                </FormControl>
                <FormMessage className="text-[11px]" />
              </FormItem>
            )}
          />
        )}
      </div>

      {/* Main Settings Content */}
      <div className="space-y-6">
        {React.Children.map(children, child => {
          if (React.isValidElement(child)) {
            // Pass the advanced state to children if they support it
            return React.cloneElement(
              child as React.ReactElement<{ isAdvancedOpen?: boolean }>,
              {
                isAdvancedOpen: true,
              }
            );
          }
          return child;
        })}
      </div>
    </div>
  );
}
