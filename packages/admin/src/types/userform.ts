import { z } from "zod";

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

// Shared password rules so create and edit validate identically.
const STRONG_PASSWORD =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#.])[A-Za-z\d@$!%*?&#.]+$/;
const STRONG_PASSWORD_MESSAGE =
  "Password must be at least 8 characters and contain one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&#.)";
const COMMON_PASSWORDS = ["password", "12345678", "qwerty", "admin123"];

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
        // Only validated when a value is supplied — an empty field means
        // "keep the current password".
        password: z
          .string()
          .optional()
          .refine(
            val => !val || (val.length >= 8 && STRONG_PASSWORD.test(val)),
            { message: STRONG_PASSWORD_MESSAGE }
          )
          .refine(
            val => !val || !COMMON_PASSWORDS.includes(val.toLowerCase()),
            { message: "Password is too common" }
          ),
      })
      .passthrough()
      .refine(data => data.roles && data.roles.length > 0, {
        message: "Select at least one role",
        path: ["roles"],
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
      if (!data.roles || data.roles.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Select at least one role",
          path: ["roles"],
        });
      }

      if (data.signInMethod === "password") {
        const password = data.password ?? "";
        if (password.length < 8 || !STRONG_PASSWORD.test(password)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: STRONG_PASSWORD_MESSAGE,
            path: ["password"],
          });
        } else if (COMMON_PASSWORDS.includes(password.toLowerCase())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Password is too common",
            path: ["password"],
          });
        }
      }
    });
}

export const createUserFormSchema = getUserFormSchema(false);
export const editUserFormSchema = getUserFormSchema(true);

export type CreateUserFormValues = z.infer<typeof createUserFormSchema>;
export type EditUserFormValues = z.infer<typeof editUserFormSchema>;
export type UserFormValues = CreateUserFormValues;
