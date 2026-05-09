/**
 * User-facing Messages Constants
 *
 * Centralized messages for toast notifications, alerts, and UI feedback.
 * Organized by feature for easy i18n migration in the future.
 */

/**
 * User Management Messages
 */
export const USER_MESSAGES = {
  // Create User
  CREATE_SUCCESS_TITLE: "User created successfully",
  CREATE_SUCCESS_DESC: (name: string) =>
    `${name} has been added to the system.`,
  CREATE_ERROR_TITLE: "User creation failed",
  CREATE_ERROR_DESC: "Failed to create user. Please try again.",

  // Update User
  UPDATE_SUCCESS_TITLE: "User updated successfully",
  UPDATE_SUCCESS_DESC: (name: string) => `${name} has been updated.`,
  UPDATE_ERROR_TITLE: "Update failed",
  UPDATE_ERROR_DESC: "Failed to update user. Please try again.",

  // Delete User
  DELETE_SUCCESS_TITLE: "User deleted successfully",
  DELETE_SUCCESS_DESC: (name: string) =>
    `${name} has been removed from the system.`,
  DELETE_ERROR_TITLE: "Delete failed",
  DELETE_ERROR_DESC: "Failed to delete user. Please try again.",

  // Validation & Errors
  MISSING_USER_ID: "User ID is missing. Cannot update user.",
  INVALID_USER_ID: "Invalid user ID. Please select a user from the users list.",
  USER_NOT_FOUND: "User not found. The user may have been deleted.",
  LOAD_USER_ERROR: "Failed to load user data. Please try again.",
  LOAD_ROLES_ERROR: "Failed to load roles. Please try again.",
  NO_ROLES_AVAILABLE: "No roles available. Please create roles first.",
  ROLES_FETCH_FAILED: "Failed to load roles. Cannot update user without roles.",

  // Form States
  UNSAVED_CHANGES_WARNING:
    "You have unsaved changes. Are you sure you want to leave?",
} as const;

/**
 * Role Management Messages
 */
export const ROLE_MESSAGES = {
  // Create Role
  CREATE_SUCCESS_TITLE: "Role created successfully",
  CREATE_SUCCESS_DESC: (name: string) => `${name} role has been added.`,
  CREATE_ERROR_TITLE: "Role creation failed",
  CREATE_ERROR_DESC: "Failed to create role. Please try again.",

  // Update Role
  UPDATE_SUCCESS_TITLE: "Role updated successfully",
  UPDATE_SUCCESS_DESC: (name: string) => `${name} role has been updated.`,
  UPDATE_ERROR_TITLE: "Update failed",
  UPDATE_ERROR_DESC: "Failed to update role. Please try again.",

  // Delete Role
  DELETE_SUCCESS_TITLE: "Role deleted successfully",
  DELETE_SUCCESS_DESC: (name: string) => `${name} role has been removed.`,
  DELETE_ERROR_TITLE: "Delete failed",
  DELETE_ERROR_DESC: "Failed to delete role. Please try again.",
} as const;

/**
 * Permission Management Messages
 */
export const PERMISSION_MESSAGES = {
  // Update Permission
  UPDATE_SUCCESS_TITLE: "Permission updated successfully",
  UPDATE_SUCCESS_DESC: "Permission settings have been saved.",
  UPDATE_ERROR_TITLE: "Update failed",
  UPDATE_ERROR_DESC: "Failed to update permission. Please try again.",

  // Delete Permission
  DELETE_SUCCESS_TITLE: "Permission deleted successfully",
  DELETE_SUCCESS_DESC: "Permission has been removed.",
  DELETE_ERROR_TITLE: "Delete failed",
  DELETE_ERROR_DESC: "Failed to delete permission. Please try again.",
} as const;

/**
 * Generic Messages
 */
export const GENERIC_MESSAGES = {
  ERROR_TITLE: "Error",
  SUCCESS_TITLE: "Success",
  LOADING: "Loading...",
  SAVING: "Saving...",
  DELETING: "Deleting...",
  CANCEL: "Cancel",
  SAVE: "Save",
  DELETE: "Delete",
  CONFIRM: "Confirm",
} as const;
