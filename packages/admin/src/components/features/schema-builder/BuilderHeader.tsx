/**
 * BuilderHeader Component
 *
 * Header for the Collection/Single/Component Builder with:
 * - Singular Name input (all entity types)
 * - Plural Name input (collections only)
 * - Save/Cancel buttons
 *
 * The slug is auto-generated from the singular name and hidden from the UI.
 */

import { Button, Input, Spinner } from "@revnixhq/ui";
import { useFormContext } from "react-hook-form";

import { ArrowLeft, Save, X } from "@admin/components/icons";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { simplePluralize } from "@admin/lib/fields";

import type { BuilderHeaderProps } from "./types";

export function BuilderHeader({
  isEditing,
  isSaving,
  onSave,
  onCancel,
  entityType = "collection",
  backRoute,
}: BuilderHeaderProps) {
  const form = useFormContext();

  // Determine entity label (capitalized)
  const entityLabel =
    entityType === "single"
      ? "Single"
      : entityType === "component"
        ? "Component"
        : "Collection";

  // Determine back route
  const resolvedBackRoute =
    backRoute ??
    (entityType === "single"
      ? ROUTES.SINGLES
      : entityType === "component"
        ? ROUTES.COMPONENTS
        : ROUTES.COLLECTIONS);

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
    <div className="shrink-0 z-50 bg-background  border-b border-primary/5">
      <div className="flex items-center justify-between px-6 py-4">
        {/* Left section: Back button and title */}
        <div className="flex items-center gap-4">
          <Link href={resolvedBackRoute}>
            <Button variant="ghost" size="icon" type="button">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              {isEditing ? `Edit ${entityLabel}` : `Create ${entityLabel}`}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isEditing
                ? `Modify your ${entityType} schema`
                : `Design your ${entityType} with drag-and-drop fields`}
            </p>
          </div>
        </div>

        {/* Right section: Actions */}
        <div className="flex items-center gap-3">
          {/* Cancel button */}
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onCancel}
            disabled={isSaving}
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>

          {/* Save button */}
          <Button
            type="button"
            size="md"
            onClick={onSave}
            disabled={isSaving}
            className="flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <Spinner size="md" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                <span>{isEditing ? "Update" : "Create"}</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Form inputs row */}
      <div className="px-6 pb-4">
        <div className="flex gap-4">
          {/* Singular Name input */}
          <FormField
            control={form.control}
            name="singularName"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel className="text-sm font-medium">
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
                    className="max-w-md"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>
    </div>
  );
}
