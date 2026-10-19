import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldError } from "react-hook-form";
import { z } from "zod";

import { filterStringArray } from "@admin/lib/type-guards";
import { passwordSchema } from "@admin/lib/validation";

export type RoleKey = string;

export interface UserFormProps {
  isEdit?: boolean;
  initialData?: {
    fullName?: string;
    email?: string;
    avatarUrl?: string;
    active?: boolean;
    roles?: RoleKey[];
  };
}

export const rolesSchema = z.array(z.string().min(1)).default([]);

/**
 * How a newly created account first gets a password.
 * - `invite`: no password is set now; the admin shares a set-password link and
 *   the person chooses their own. This is the default and the recommended path.
 * - `password`: the admin sets a password directly and hands it over.
 */
export const SIGN_IN_METHODS = ["invite", "password"] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];

/** Both forms need at least one role, reported at `roles`. */
function requireRoles(roles: string[] | undefined, ctx: z.RefinementCtx): void {
  if (roles && roles.length > 0) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: "Select at least one role",
    path: ["roles"],
  });
}

/**
 * Adds an issue at `password` for each rule the password misses. Both forms
 * use the admin's copy of the server's rule, the one every other password
 * form uses, so an admin can set exactly the passwords the server accepts and
 * sees each unmet rule as its own message.
 */
function addPasswordIssues(password: string, ctx: z.RefinementCtx): void {
  const result = passwordSchema.safeParse(password);
  if (result.success) return;
  for (const issue of result.error.issues) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: issue.message,
      path: ["password"],
    });
  }
}

const avatarUrlSchema = z
  .string()
  .trim()
  // Accept either a fully-qualified URL (https://cdn.example.com/foo.png)
  // OR a server-relative path (/uploads/foo.png) returned by the local
  // media adapter. The previous `.url()` validator rejected relative
  // paths, which silently blocked submission whenever a user picked
  // an avatar from the local media library.
  .refine(
    val => val === "" || /^(https?:\/\/.+|\/.+)$/.test(val),
    "Enter a valid URL or media path"
  )
  .optional()
  .or(z.literal(""));

export function getUserFormSchema(isEdit: boolean) {
  const base = {
    fullName: z.string().trim().min(1, "Full name is required"),
    email: z.string().trim().email("Enter a valid email"),
    avatarUrl: avatarUrlSchema,
    active: z.boolean().optional(),
    // Roles optional in schema, but required by the refinement below.
    roles: rolesSchema.optional(),
  };

  if (isEdit) {
    return z
      .object({
        ...base,
        password: z.string().optional(),
      })
      .passthrough()
      .superRefine((data, ctx) => {
        requireRoles(data.roles, ctx);
        // Only validated when a value is supplied — an empty field means
        // "keep the current password".
        if (data.password) addPasswordIssues(data.password, ctx);
      });
  }

  // Create: the sign-in method decides whether a password is even collected.
  // In invite mode there is no password field, so password validation only
  // applies when the admin chooses to set one now.
  return z
    .object({
      ...base,
      signInMethod: z.enum(SIGN_IN_METHODS).default("invite"),
      password: z.string().optional(),
    })
    .passthrough()
    .superRefine((data, ctx) => {
      requireRoles(data.roles, ctx);

      if (data.signInMethod === "password") {
        addPasswordIssues(data.password ?? "", ctx);
      }
    });
}

export const createUserFormSchema = getUserFormSchema(false);
export const editUserFormSchema = getUserFormSchema(true);

/**
 * The react-hook-form settings the create and edit pages use. `criteriaMode:
 * "all"` keeps every issue the schema reports for a field rather than the
 * first, so the password field can list each rule a password misses.
 */
export const createUserFormSettings = {
  resolver: zodResolver(createUserFormSchema),
  criteriaMode: "all",
} as const;
export const editUserFormSettings = {
  resolver: zodResolver(editUserFormSchema),
  criteriaMode: "all",
} as const;

/**
 * Every message react-hook-form holds for one field, in order and once each.
 * Under `criteriaMode: "all"` they sit in `types`, keyed by issue code, each a
 * message or a list of them; `message` alone holds only the first.
 */
export function fieldErrorMessages(error: FieldError | undefined): string[] {
  if (!error) return [];
  const fromTypes = Object.values(error.types ?? {}).flatMap(value =>
    typeof value === "string"
      ? [value]
      : Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : []
  );
  const messages =
    fromTypes.length > 0 ? fromTypes : error.message ? [error.message] : [];
  return [...new Set(messages)];
}

export type CreateUserFormValues = z.infer<typeof createUserFormSchema>;
export type EditUserFormValues = z.infer<typeof editUserFormSchema>;
export type UserFormValues = CreateUserFormValues;

/**
 * What the edit page sends to update a user, from what its form holds.
 *
 * The password goes exactly as entered: a space at either end can be its
 * symbol, and the server hashes what it receives. An empty field sends no
 * password, so the current one is kept; whitespace alone fails the rule and
 * never reaches here. The server hashes the password before storing it, so
 * the request carries it in plain text only over the app's own connection.
 * Custom fields arrive under `customFields` and are sent at the top level.
 */
export function editUserUpdates(values: EditUserFormValues) {
  const customFields = (values as Record<string, unknown>).customFields as
    | Record<string, unknown>
    | undefined;
  return {
    name: values.fullName,
    email: values.email,
    password: values.password || undefined,
    // filterStringArray always returns string[], no fallback needed
    roles: filterStringArray(values.roles),
    image: values.avatarUrl,
    isActive: values.active,
    ...customFields,
  };
}
