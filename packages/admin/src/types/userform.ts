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

export function getUserFormSchema(isEdit: boolean) {
  return z
    .object({
      fullName: z.string().trim().min(1, "Full name is required"),
      email: z.string().trim().email("Enter a valid email"),
      password: isEdit
        ? z
            .string()
            .optional()
            .refine(
              val => {
                // If password is provided, validate it
                if (val && val.length > 0) {
                  return (
                    val.length >= 8 &&
                    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#.])[A-Za-z\d@$!%*?&#.]+$/.test(
                      val
                    )
                  );
                }
                return true; // Empty/undefined is valid for edit
              },
              {
                message:
                  "Password must be at least 8 characters and contain one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&#.)",
              }
            )
            .refine(
              val => {
                if (val && val.length > 0) {
                  const commonPasswords = [
                    "password",
                    "12345678",
                    "qwerty",
                    "admin123",
                  ];
                  return !commonPasswords.includes(val.toLowerCase());
                }
                return true;
              },
              {
                message: "Password is too common",
              }
            )
        : z
            .string()
            .min(8, "Password must be at least 8 characters")
            .regex(
              /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#.])[A-Za-z\d@$!%*?&#.]+$/,
              "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&#.)"
            )
            .refine(
              val => {
                const commonPasswords = [
                  "password",
                  "12345678",
                  "qwerty",
                  "admin123",
                ];
                return !commonPasswords.includes(val.toLowerCase());
              },
              {
                message: "Password is too common",
              }
            ),
      avatarUrl: z
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
        .or(z.literal("")),
      active: z.boolean().optional(),
      sendWelcome: z.boolean().optional(),
      // Roles optional in schema, but validated below
      roles: rolesSchema.optional(),
    })
    .passthrough()
    .refine(data => data.roles && data.roles.length > 0, {
      message: "Select at least one role",
      path: ["roles"],
    });
}

export const createUserFormSchema = getUserFormSchema(false);
export const editUserFormSchema = getUserFormSchema(true);

export type CreateUserFormValues = z.infer<typeof createUserFormSchema>;
export type EditUserFormValues = z.infer<typeof editUserFormSchema>;
export type UserFormValues = CreateUserFormValues;
