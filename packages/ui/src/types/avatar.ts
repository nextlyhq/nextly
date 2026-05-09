import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import type { avatarVariants } from "../components/avatar";

/**
 * Avatar component props
 *
 * Root container for displaying user avatars with image and fallback support.
 * Extends Radix UI Avatar.Root props with size variants.
 */
export type AvatarProps = ComponentPropsWithoutRef<"span"> &
  VariantProps<typeof avatarVariants> & {
    /**
     * Size variant
     * - sm: 32px (h-8 w-8) - For compact layouts, lists
     * - md: 40px (h-10 w-10) - Default size, general use
     * - lg: 48px (h-12 w-12) - For prominent displays, profiles
     * - xl: 64px (h-16 w-16) - For large profile displays, user panels
     * - 2xl: 80px (h-20 w-20) - For profile headers, large avatars
     * @default "md"
     */
    size?: "sm" | "md" | "lg" | "xl" | "2xl";
  };

/**
 * AvatarImage component props
 *
 * Displays the avatar image with proper fallback handling.
 * Extends standard img element props.
 *
 * Note: Both src and alt are optional to support dynamic loading scenarios.
 * When src is undefined/empty, the AvatarFallback will be displayed instead.
 */
export type AvatarImageProps = ComponentPropsWithoutRef<"img">;

/**
 * AvatarFallback component props
 *
 * Displays fallback content (typically user initials) when image fails to load.
 * Extends Radix UI Avatar.Fallback props.
 */
export type AvatarFallbackProps = ComponentPropsWithoutRef<"span"> & {
  /**
   * Delay in milliseconds before showing fallback
   * @default 600
   */
  delayMs?: number;
};
