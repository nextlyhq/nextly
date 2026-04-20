/**
 * Examples of how to use the Zod schemas for validation
 * This file demonstrates common patterns and usage scenarios
 */

import {
  CreateLocalUserSchema,
  CreateUserWithPasswordSchema,
  UpdateUserSchema,
  MinimalUserSchema,
  UserAccountSchema,
  CreateRoleSchema,
  CreatePermissionSchema,
  AssignRoleToUserSchema,
  AssignPermissionToRoleSchema,
  PaginationSchema,
  SearchSchema,
  EmailSchema,
  PasswordSchema,
  SuccessResponseSchema,
  ErrorResponseSchema,
} from "./index";

export function validateUserCreation(data: unknown) {
  try {
    const validatedData = CreateLocalUserSchema.parse(data);
    return { success: true, data: validatedData };
  } catch (error) {
    return {
      success: false,
      error: "Validation failed",
      details: error,
    };
  }
}

export function safeParseUserUpdate(data: unknown) {
  const result = UpdateUserSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return {
      success: false,
      errors: result.error.issues.map(issue => ({
        field: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      })),
    };
  }
}

export function validateUserListRequest(query: unknown) {
  const paginationResult = PaginationSchema.safeParse(query);
  const searchResult = SearchSchema.safeParse(query);

  return {
    pagination: paginationResult.success ? paginationResult.data : undefined,
    search: searchResult.success ? searchResult.data : undefined,
    hasErrors: !paginationResult.success || !searchResult.success,
  };
}

export function createUserWithPassword(userData: {
  email: string;
  name?: string;
  password: string;
}) {
  const validationResult = CreateUserWithPasswordSchema.safeParse(userData);

  if (!validationResult.success) {
    return {
      success: false,
      error: "Invalid user data",
      details: validationResult.error.issues,
    };
  }

  const validatedData = validationResult.data;

  return {
    success: true,
    data: {
      email: validatedData.email,
      name: validatedData.name,
      passwordHash: "hashed_password_here",
    },
  };
}

export function validateRoleAssignment(data: {
  userId: string;
  roleId: string;
  expiresAt?: Date;
}) {
  const result = AssignRoleToUserSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return {
      success: false,
      error: "Invalid role assignment data",
      details: result.error.issues,
    };
  }
}

export function validatePermissionCreation(data: {
  action: string;
  resource: string;
  description?: string;
}) {
  const result = CreatePermissionSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return {
      success: false,
      error: "Invalid permission data",
      details: result.error.issues,
    };
  }
}

export function validateEmail(email: string): boolean {
  return EmailSchema.safeParse(email).success;
}

export function validatePasswordStrength(password: string): {
  isValid: boolean;
  errors: string[];
} {
  const result = PasswordSchema.safeParse(password);

  if (result.success) {
    return { isValid: true, errors: [] };
  } else {
    return {
      isValid: false,
      errors: result.error.issues.map(issue => issue.message),
    };
  }
}

export function createSuccessResponse<T>(
  data: T,
  message?: string
): { success: true; message?: string; data?: T } {
  return SuccessResponseSchema.parse({
    success: true,
    message,
    data,
  });
}

export function createErrorResponse(
  error: string,
  code?: string,
  details?: unknown
) {
  return ErrorResponseSchema.parse({
    success: false,
    error,
    code,
    details,
  });
}

export function validateBulkUserCreation(users: unknown[]) {
  const results = users.map((user, index) => {
    const result = CreateLocalUserSchema.safeParse(user);
    return {
      index,
      success: result.success,
      data: result.success ? result.data : undefined,
      errors: result.success ? undefined : result.error.issues,
    };
  });

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  return {
    total: users.length,
    successful: successful.length,
    failed: failed.length,
    results,
  };
}
