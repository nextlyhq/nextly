import { z } from "zod";

import { EmailSchema, PasswordSchema } from "./validation";

export const UserIdSchema = z.union([z.string(), z.number()]);

export const MinimalUserSchema = z
  .object({
    id: UserIdSchema,
    email: z.string().email(),
    emailVerified: z.union([z.date(), z.string(), z.null()]).optional(),
    name: z.string().nullable(),
    image: z.string().nullable(),
    isActive: z.boolean().optional(),
    createdAt: z.union([z.date(), z.string()]).optional(),
    updatedAt: z.union([z.date(), z.string()]).optional(),
    roles: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  })
  .passthrough();

export const UserAccountSchema = z.object({
  id: UserIdSchema,
  userId: UserIdSchema,
  provider: z.string(),
  providerAccountId: z.string(),
  type: z.string(),
});

export const CreateLocalUserSchema = z.object({
  email: EmailSchema,
  name: z.string().min(1, "Name is required"),
  image: z.string().nullable().optional(),
  // Reuse shared PasswordSchema so admin-created accounts get the same
  // complexity rules as self-service setup/signup.
  password: PasswordSchema.optional(),
  // Optional list of role ids to assign on creation (multiple)
  roles: z.array(z.string().min(1)).optional(),
  isActive: z.boolean().optional(),
  sendWelcomeEmail: z.boolean().optional(),
});

export const CreateUserWithPasswordSchema = z.object({
  email: EmailSchema,
  name: z.string().min(1, "Name is required"),
  password: PasswordSchema,
});

export const UpdateUserSchema = z.object({
  email: EmailSchema.optional(),
  name: z.string().min(1, "Name cannot be empty").nullable().optional(),
  // Reuse shared PasswordSchema so updating a user can't downgrade to a
  // weak password through an endpoint that skipped complexity checks.
  password: PasswordSchema.optional(),
  image: z
    .string()
    .transform(val => (val === "" ? null : val))
    .refine(val => val === null || /^https?:\/\/.+\..+/.test(val), {
      message: "Image must be a valid URL",
    })
    .optional(),
  emailVerified: z.union([z.date(), z.string(), z.null()]).optional(),
  roles: z.array(z.string().min(1)).optional(),
  isActive: z.boolean().optional(),
  sendWelcomeEmail: z.boolean().optional(),
});

export const UpdatePasswordSchema = z.object({
  userId: UserIdSchema,
  password: PasswordSchema,
});

export const GetUserByIdSchema = z.object({
  userId: UserIdSchema,
});

export const DeleteUserSchema = z.object({
  userId: UserIdSchema,
});

export const ListUsersSchema = z.object({
  page: z.number().int().positive().optional().default(1),
  pageSize: z.number().int().positive().max(100).optional().default(10),
  search: z.string().optional(),
  emailVerified: z.boolean().optional(),
  hasPassword: z.boolean().optional(),
  createdAtFrom: z.date().optional(),
  createdAtTo: z.date().optional(),
  sortBy: z.enum(["createdAt", "name", "email"]).optional().default("email"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("asc"),
});

export const DeleteUserAccountSchema = z.object({
  userId: UserIdSchema,
  provider: z.string().min(1, "Provider is required"),
  providerAccountId: z.string().min(1, "Provider account ID is required"),
});

export const UnlinkAccountSchema = z.object({
  userId: UserIdSchema,
  provider: z.string().min(1, "Provider is required"),
  providerAccountId: z.string().min(1, "Provider account ID is required"),
});

export const UserListResponseSchema = z.array(MinimalUserSchema);

export const UserResponseSchema = MinimalUserSchema;

export const DeleteUserResponseSchema = z.object({
  deleted: z.boolean(),
});

export const UnlinkAccountResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    status: z.number(),
    error: z.string(),
  }),
]);

export type MinimalUser = z.infer<typeof MinimalUserSchema>;
export type UserAccount = z.infer<typeof UserAccountSchema>;
export type CreateLocalUser = z.infer<typeof CreateLocalUserSchema>;
export type CreateUserWithPassword = z.infer<
  typeof CreateUserWithPasswordSchema
>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
export type UpdatePassword = z.infer<typeof UpdatePasswordSchema>;
export type GetUserById = z.infer<typeof GetUserByIdSchema>;
export type DeleteUser = z.infer<typeof DeleteUserSchema>;
export type ListUsers = z.infer<typeof ListUsersSchema>;
export type DeleteUserAccount = z.infer<typeof DeleteUserAccountSchema>;
export type UnlinkAccount = z.infer<typeof UnlinkAccountSchema>;
export type UserListResponse = z.infer<typeof UserListResponseSchema>;
export type UserResponse = z.infer<typeof UserResponseSchema>;
export type DeleteUserResponse = z.infer<typeof DeleteUserResponseSchema>;
export type UnlinkAccountResponse = z.infer<typeof UnlinkAccountResponseSchema>;
