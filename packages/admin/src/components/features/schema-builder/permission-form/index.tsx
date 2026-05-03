"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Label, Switch } from "@revnixhq/ui";
import type { ReactElement } from "react";
import { useForm, type Resolver } from "react-hook-form";

import type {
  PermissionFormProps,
  PermissionFormValues} from "@admin/types/permissionform";
import {
  createPermissionFormSchema,
  editPermissionFormSchema
} from "@admin/types/permissionform";

export function PermissionForm({
  isEdit = false,
  initialData,
}: PermissionFormProps): ReactElement {
  const schema = isEdit ? editPermissionFormSchema : createPermissionFormSchema;

  const {
    register,
    _control,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<PermissionFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<PermissionFormValues>,
    defaultValues: {
      name: initialData?.name || "",
      slug: initialData?.slug || "",
      description: initialData?.description || "",
      systemPermission: initialData?.systemPermission ?? false,
    },
  });

  const watchedName = watch("name");
  const _watchedSlug = watch("slug");
  const _watchedDescription = watch("description");
  const _initial = (watchedName?.trim()?.[0] || "U").toUpperCase();

  function handleCancel() {
    reset({
      name: "",
      slug: "",
      description: "",
      systemPermission: false,
    });
  }

  function onValid(values: PermissionFormValues) {
    console.log(values);
  }

  return (
    <div className="w-full">
      <div className="admin-card flex flex-col">
        {/* Form */}
        <form
          id="permission-form"
          onSubmit={(e) => { void handleSubmit(onValid)(e); }}
          className="grid gap-2 flex-1"
        >
          <div className="form-field-wrapper">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="Enter Permission Name"
              aria-invalid={!!errors.name}
              className={
                errors.name
                  ? `mt-2 border-[hsl(var(--ring))] ring-2 ring-[hsl(var(--ring))] ring-offset-2`
                  : `mt-2`
              }
              {...register("name")}
            />
            {errors.name && (
              <p className="form-error">{errors.name.message as string}</p>
            )}
          </div>

          <div className="form-field-wrapper">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              type="text"
              placeholder="Enter Permission Slug"
              aria-invalid={!!errors.slug}
              className={
                errors.slug
                  ? `mt-2 border-[hsl(var(--ring))] ring-2 ring-[hsl(var(--ring))] ring-offset-2`
                  : `mt-2`
              }
              {...register("slug")}
            />
            {errors.slug && (
              <p className="form-error">{errors.slug.message as string}</p>
            )}
          </div>

          <div className="form-field-wrapper">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              type="text"
              placeholder="Enter Permission Description"
              aria-invalid={!!errors.description}
              className={
                errors.description
                  ? `mt-2 border-[hsl(var(--ring))] ring-2 ring-[hsl(var(--ring))] ring-offset-2`
                  : `mt-2`
              }
              {...register("description")}
            />
            {errors.description && (
              <p className="form-error">
                {errors.description.message as string}
              </p>
            )}
          </div>

          <div className="mb-4 rounded-none  border border-primary/5 p-4 flex justify-between items-center">
            <label>
              <div className="text-sm font-medium">System Permission</div>
              <p className="admin-text">
                System permission cannot be modified or deleted.
              </p>
            </label>
            <Switch />
          </div>
        </form>

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            className="w-auto"
          >
            Cancel
          </Button>
          <Button type="submit" form="permission-form" className="w-auto">
            {isEdit ? "Update Permission" : "Create Permission"}
          </Button>
        </div>
      </div>
    </div>
  );
}
