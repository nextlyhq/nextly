"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@revnixhq/ui";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Database, Link, Search } from "@admin/components/icons";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@admin/components/ui/form";
import { authFetch } from "@admin/lib/api/refreshInterceptor";
import { createSlugSchema } from "@admin/lib/validation";
import type { RelationFieldConfig} from "@admin/types/field-types";
import { FieldType } from "@admin/types/field-types";

const relationFieldSchema = z.object({
  name: createSlugSchema(),
  label: z.string().min(1, "Display Name is required"),
  content_type: z.string().optional(),
  display_field: z.string().optional(),
  multiselect: z.boolean().default(false),
  searchable: z.boolean().default(true),
  validation: z
    .object({
      required: z.boolean().default(false),
      min_items: z.number().int().min(0).default(0),
      max_items: z.number().int().min(1).default(1),
    })
    .default({ required: false, min_items: 0, max_items: 1 }),
});

type RelationFieldFormValues = z.infer<typeof relationFieldSchema>;

interface ContentType {
  id: string;
  name: string;
  slug: string;
  description?: string;
}

interface ContentField {
  name: string;
  label: string;
}

interface RelationFieldEditorProps {
  initialData?: Partial<RelationFieldConfig>;
  onSubmit: (data: Omit<RelationFieldConfig, "id">) => void;
  formRef?: React.RefObject<HTMLFormElement | null>;
}

export function RelationFieldEditor({
  initialData,
  onSubmit,
  formRef,
}: RelationFieldEditorProps) {
  const [contentTypes, setContentTypes] = useState<ContentType[]>([]);
  const [contentFields, setContentFields] = useState<ContentField[]>([]);
  const [isLoadingContentTypes, setIsLoadingContentTypes] = useState(false);

  const defaultValues = {
    name: initialData?.name || "",
    label: initialData?.label || "",
    content_type: initialData?.content_type || "",
    display_field: initialData?.display_field || "title",
    multiselect: initialData?.multiselect || false,
    searchable: initialData?.searchable !== false,
    validation: {
      required: initialData?.validation?.required || false,
      min_items: initialData?.validation?.min_items || 0,
      max_items: initialData?.validation?.max_items || 1,
    },
  };

  const form = useForm({
    resolver: zodResolver(relationFieldSchema),
    defaultValues,
  });

  const selectedContentType = form.watch("content_type");
  const multiselect = form.watch("multiselect");

  // Fetch content types on component mount
  useEffect(() => {
    void fetchContentTypes();
  }, []);

  // Update content fields when content type changes
  useEffect(() => {
    if (selectedContentType) {
      updateContentFields(selectedContentType);
    }
  }, [selectedContentType]);

  const fetchContentTypes = async () => {
    setIsLoadingContentTypes(true);
    const newContentTypes: ContentType[] = [];

    // 1. Add Users (System Collection) - Always available
    newContentTypes.push({
      id: "users",
      name: "Users",
      slug: "users",
      description: "System Users Collection",
    });

    try {
      // Phase 4 (post-merge follow-up): both /admin/api/collections and
      // /admin/api/singles emit `respondList({ items, meta })` (spec
      // section 5.1). Pre-Phase-4 the legacy wire was `{ data: [...] }`;
      // after the rename we read `.items` for the array. Same regression
      // class as the role-create infinite-loop bug fixed in the
      // companion useRoleForm.ts edit; centralizing the comment here
      // would dilute it, so each call site documents its own migration.

      // 2. Fetch Collections
      try {
        const collectionsRes = await authFetch(
          "/admin/api/collections?limit=100&sortBy=name&sortOrder=asc",
          { credentials: "include" }
        );
        if (collectionsRes.ok) {
          const collectionsData = await collectionsRes.json();
          if (Array.isArray(collectionsData?.items)) {
            const mappedCollections = collectionsData.items.map(
              (c: { name: string; label?: string; description?: string }) => ({
                id: c.name,
                name: c.label || c.name,
                slug: c.name,
                description: c.description,
              })
            );
            newContentTypes.push(...mappedCollections);
          }
        } else {
          console.error(
            "Failed to fetch collections:",
            collectionsRes.status,
            collectionsRes.statusText
          );
        }
      } catch (err) {
        console.error("Error fetching collections:", err);
      }

      // 3. Fetch Singles
      try {
        const singlesRes = await authFetch("/admin/api/singles", {
          credentials: "include",
        });
        if (singlesRes.ok) {
          const singlesData = await singlesRes.json();
          if (Array.isArray(singlesData?.items)) {
            const mappedSingles = singlesData.items.map(
              (s: { slug: string; label?: string; description?: string }) => ({
                id: s.slug,
                name: s.label || s.slug,
                slug: s.slug,
                description: s.description,
              })
            );
            newContentTypes.push(...mappedSingles);
          }
        } else {
          console.warn(
            "Failed to fetch singles (might not be implemented yet):",
            singlesRes.status
          );
        }
      } catch (err) {
        console.warn("Error fetching singles:", err);
      }

      console.log("Setting content types:", newContentTypes);
      setContentTypes(newContentTypes);
    } catch (error) {
      console.error("Critical error in fetchContentTypes:", error);
    } finally {
      setIsLoadingContentTypes(false);
    }
  };

  const updateContentFields = (contentTypeSlug: string) => {
    // Determine the type of content to provide appropriate display fields
    let fields = [{ name: "id", label: "ID" }];

    if (contentTypeSlug === "users") {
      fields = [
        ...fields,
        { name: "email", label: "Email" },
        { name: "firstName", label: "First Name" },
        { name: "lastName", label: "Last Name" },
        { name: "username", label: "Username" },
      ];
    } else {
      // Default fields for collections and singles
      fields = [
        ...fields,
        { name: "title", label: "Title" },
        { name: "name", label: "Name" },
        { name: "slug", label: "Slug" },
        { name: "label", label: "Label" },
      ];
    }

    setContentFields(fields);
  };

  const handleSubmit = form.handleSubmit((data: RelationFieldFormValues) => {
    const fieldConfig: Omit<RelationFieldConfig, "id"> = {
      ...data,
      type: FieldType.RELATION,
    };
    onSubmit(fieldConfig);
  });

  const getSelectedContentTypeName = () => {
    const contentType = contentTypes.find(
      ct => ct.slug === selectedContentType
    );
    return contentType?.name || selectedContentType || "";
  };

  const isMultipleSelection = multiselect;

  return (
    <Form {...form}>
      <form
        ref={formRef}
        id="field-form"
        onSubmit={(e) => { void handleSubmit(e); }}
        className="space-y-3"
      >
        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="w-full rounded-none">
            <TabsTrigger value="basic" className="flex-1">
              Basic Settings
            </TabsTrigger>
            <TabsTrigger value="reference" className="flex-1">
              Reference Options
            </TabsTrigger>
            <TabsTrigger value="validation" className="flex-1">
              Validation
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4 pt-3">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Related Content" />
                    </FormControl>
                    <FormDescription>
                      Shown in the content editor interface
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Field ID</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="related_content" />
                    </FormControl>
                    <FormDescription>
                      System identifier (lowercase with underscores)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="multiselect"
              render={({ field }) => (
                <FormItem className="flex items-center space-x-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <div className="space-y-0.5">
                    <FormLabel className="text-sm">Multiselect</FormLabel>
                    <FormDescription className="text-xs">
                      Enable multiple selection
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
          </TabsContent>

          <TabsContent value="reference" className="space-y-4 pt-3">
            {/* Content Type Selection */}
            <FormField
              control={form.control}
              name="content_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Content Type</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={isLoadingContentTypes}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            isLoadingContentTypes
                              ? "Loading..."
                              : "Select a content type"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {contentTypes.map(type => (
                          <SelectItem key={type.id} value={type.slug}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormDescription>Content type to reference</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Display Field Selection */}
            <FormField
              control={form.control}
              name="display_field"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Field</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={!selectedContentType}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a display field" />
                      </SelectTrigger>
                      <SelectContent>
                        {contentFields.map(contentField => (
                          <SelectItem
                            key={contentField.name}
                            value={contentField.name}
                          >
                            {contentField.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormDescription>
                    Field to display in the relationship UI
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Searchable Option */}
            <FormField
              control={form.control}
              name="searchable"
              render={({ field }) => (
                <FormItem className="flex items-center space-x-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <div className="space-y-0.5">
                    <FormLabel className="text-sm">Searchable</FormLabel>
                    <FormDescription className="text-xs">
                      Enable search functionality for finding references
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            {/* Relationship Preview */}
            {selectedContentType && (
              <Card className="mt-4 border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    Relationship Preview
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex flex-col gap-2">
                      <div className="text-xs text-muted-foreground">
                        Will reference{" "}
                        <span className="font-semibold">
                          {getSelectedContentTypeName()}
                        </span>{" "}
                        using{" "}
                        <span className="font-semibold">
                          {contentFields.find(
                            f => f.name === form.watch("display_field")
                          )?.label || "Title"}
                        </span>{" "}
                        as display field
                      </div>

                      <div className="mt-2 p-3 border rounded-none flex items-center justify-between bg-primary/5">
                        <div className="flex items-center gap-2">
                          <Database className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">
                            Example {getSelectedContentTypeName().slice(0, -1)}
                          </span>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7"
                        >
                          <Link className="h-3.5 w-3.5 mr-1" />
                          Select
                        </Button>
                      </div>

                      {form.watch("searchable") && (
                        <div className="flex items-center gap-2 border rounded-none px-3 py-2 mt-2">
                          <Search className="h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder={`Search ${getSelectedContentTypeName()}...`}
                            className="border-0 h-7 p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                            disabled
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="validation" className="space-y-4 pt-3">
            <FormField
              control={form.control}
              name="validation.required"
              render={({ field }) => (
                <FormItem className="flex items-center space-x-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <div className="space-y-0.5">
                    <FormLabel className="text-sm">Required Field</FormLabel>
                    <FormDescription className="text-xs">
                      This field must have a value
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            {isMultipleSelection && (
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="validation.min_items"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minimum Items</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          min={0}
                          value={field.value?.toString() || "0"}
                          onChange={e =>
                            field.onChange(parseInt(e.target.value) || 0)
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        Minimum number of items required
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="validation.max_items"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Maximum Items</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          min={1}
                          value={field.value?.toString() || "1"}
                          onChange={e =>
                            field.onChange(parseInt(e.target.value) || 1)
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        Maximum number of items allowed
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* Validation Summary */}
            {selectedContentType && (
              <Card className="mt-4 border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    Validation Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 text-sm">
                    {isMultipleSelection ? (
                      <p>
                        <span className="font-medium">Multiple selection:</span>{" "}
                        Users can select between{" "}
                        {form.watch("validation.min_items")} and{" "}
                        {form.watch("validation.max_items")} items from{" "}
                        <span className="italic">
                          {getSelectedContentTypeName()}
                        </span>
                        .
                      </p>
                    ) : (
                      <p>
                        <span className="font-medium">Single selection:</span>{" "}
                        Users can select exactly one item from{" "}
                        <span className="italic">
                          {getSelectedContentTypeName()}
                        </span>
                        .
                      </p>
                    )}

                    {form.watch("validation.required") && (
                      <p className="text-muted-foreground">
                        At least{" "}
                        {isMultipleSelection &&
                        (form.watch("validation.min_items") || 0) > 0
                          ? form.watch("validation.min_items") || 0
                          : 1}{" "}
                        reference must be selected.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </form>
    </Form>
  );
}
