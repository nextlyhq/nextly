import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Extracts the first character from a name to use as an avatar initial.
 * Falls back to "U" (User) if name is empty or invalid.
 */
export function getInitial(name?: string | null): string {
  const trimmed = name?.trim();

  if (!trimmed || trimmed.length === 0) {
    return "U";
  }

  return trimmed[0].toUpperCase();
}

/**
 * Generates a full set of initials from a name (up to 2 characters).
 * Useful for larger avatars where two initials look better.
 */
export function getInitials(name?: string | null): string {
  const trimmed = name?.trim();

  if (!trimmed || trimmed.length === 0) {
    return "U";
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "U";
  }

  if (parts.length === 1) {
    return parts[0][0].toUpperCase();
  }

  // First name initial + Last name initial
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Generates a URL-friendly slug from a string.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove special characters
    .replace(/[\s_-]+/g, "-") // Replace spaces, underscores, and multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens
}
