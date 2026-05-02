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
import type React from "react";
import { useState, useEffect } from "react";
import { type Control, type FieldValues, useForm } from "react-hook-form";
import { z } from "zod";

import { User, Users } from "@admin/components/icons";
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
import type { UserFieldConfig} from "@admin/types/field-types";
import { FieldType } from "@admin/types/field-types";

// Define schema for user field form
const userFieldSchema = z.object({
  name: createSlugSchema(),
  label: z.string().min(1, "Display Name is required"),
  display_field: z.string().optional(),
  multiselect: z.boolean().default(false),
  searchable: z.boolean().default(true),
  validation: z.object({
    required: z.boolean().default(false),
    min_items: z.number().int().min(0).default(0),
    max_items: z.number().int().min(1).default(1),
  }),
  user_role: z.string().optional(),
});

type UserFieldFormValues = z.infer<typeof userFieldSchema>;

interface UserFieldEditorProps {
  initialData?: Partial<UserFieldConfig>;
  onSubmit: (data: Omit<UserFieldConfig, "id">) => void;
  formRef?: React.RefObject<HTMLFormElement | null>;
}

interface UserRole {
  id: string;
  name: string;
  slug: string;
  description?: string;
}

/**
 * User Field Editor Component
 * Used for configuring user field properties
 */
export function UserFieldEditor({
  initialData,
  onSubmit,
  formRef,
}: UserFieldEditorProps) {
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [isLoadingRoles, setIsLoadingRoles] = useState(false);

  const defaultValues = {
    name: initialData?.name || "",
    label: initialData?.label || "",
    display_field: initialData?.display_field || "displayName",
    multiselect: initialData?.multiselect || false,
    searchable: initialData?.searchable !== false,
    validation: {
      required: initialData?.validation?.required || false,
      min_items: initialData?.validation?.min_items || 0,
      max_items: initialData?.validation?.max_items || 1,
    },
    user_role: initialData?.user_role || "all",
  };

  const form = useForm({
    resolver: zodResolver(userFieldSchema),
    defaultValues,
  });

  const multiselect = form.watch("multiselect");

  // Fetch user roles on component mount
  useEffect(() => {
    void fetchUserRoles();
  }, []);

  const fetchUserRoles = async () => {
    setIsLoadingRoles(true);
    try {
      const response = await authFetch(
        "/admin/api/roles?limit=100&sortBy=name&sortOrder=asc",
        { credentials: "include" }
      );
      const data = await response.json();

      // Phase 4 (post-merge follow-up): /admin/api/roles emits
      // `respondList({ items, meta })` (spec section 5.1). Pre-Phase-4
      // the legacy wire was `{ success, data }`; the canonical envelope
      // dropped `success` (HTTP status carries it) and renamed the
      // payload field from `data` to `items`. Read `items` and gate on
      // response.ok instead of an in-body success flag.
      if (response.ok && Array.isArray(data?.items)) {
        setUserRoles(data.items);
      }
    } catch (error) {
      console.error("Error fetching user roles:", error);
      // Fallback to mock data for development
      setUserRoles([
        {
          id: "1",
          name: "Administrator",
          slug: "administrator",
          description: "Full system access",
        },
        {
          id: "2",
          name: "Editor",
          slug: "editor",
          description: "Content editing access",
        },
        {
          id: "3",
          name: "Author",
          slug: "author",
          description: "Content creation access",
        },
        {
          id: "4",
          name: "User",
          slug: "user",
          description: "Basic user access",
        },
      ]);
    } finally {
      setIsLoadingRoles(false);
    }
  };

  const handleSubmit = form.handleSubmit((data: UserFieldFormValues) => {
    const fieldConfig: Omit<UserFieldConfig, "id"> = {
      ...data,
      type: FieldType.USER,
    };
    onSubmit(fieldConfig);
  });

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
            <TabsTrigger value="options" className="flex-1">
              User Options
            </TabsTrigger>
            <TabsTrigger value="validation" className="flex-1">
              Validation
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4 pt-3">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control as unknown as Control<FieldValues>}
                name="label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Assigned User" />
                    </FormControl>
                    <FormDescription>
                      Shown in the content editor interface
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control as unknown as Control<FieldValues>}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Field ID</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="assigned_user" />
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
              control={form.control as unknown as Control<FieldValues>}
              name="display_field"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Field</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select display field" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="displayName">
                          Display Name
                        </SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="id">User ID</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormDescription>
                    Field to display when showing selected users
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </TabsContent>

          <TabsContent value="options" className="space-y-4 pt-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Selection Options
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control as unknown as Control<FieldValues>}
                  name="multiselect"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Allow Multiple Selection</FormLabel>
                        <FormDescription>
                          Enable users to select multiple users
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control as unknown as Control<FieldValues>}
                  name="searchable"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Searchable</FormLabel>
                        <FormDescription>
                          Allow searching through users
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control as unknown as Control<FieldValues>}
                  name="user_role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Filter by Role (Optional)</FormLabel>
                      <FormControl>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={isLoadingRoles}
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={
                                isLoadingRoles ? "Loading..." : "Select a role"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Roles</SelectItem>
                            {userRoles.map(role => (
                              <SelectItem key={role.id} value={role.slug}>
                                {role.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormDescription>
                        Limit user selection to specific role
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="validation" className="space-y-4 pt-3">
            <Card>
              <CardHeader>
                <CardTitle>Validation Rules</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control as unknown as Control<FieldValues>}
                  name="validation.required"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Required Field</FormLabel>
                        <FormDescription>
                          User must select at least one user
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />

                {isMultipleSelection && (
                  <>
                    <FormField
                      control={form.control as unknown as Control<FieldValues>}
                      name="validation.min_items"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Minimum Users</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              onChange={e =>
                                field.onChange(parseInt(e.target.value) || 0)
                              }
                              min="0"
                            />
                          </FormControl>
                          <FormDescription>
                            Minimum number of users to select
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control as unknown as Control<FieldValues>}
                      name="validation.max_items"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Maximum Users</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              onChange={e =>
                                field.onChange(parseInt(e.target.value) || 1)
                              }
                              min="1"
                            />
                          </FormControl>
                          <FormDescription>
                            Maximum number of users to select
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end space-x-2 pt-4">
          <Button type="submit" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Save User Field
          </Button>
        </div>
      </form>
    </Form>
  );
}
