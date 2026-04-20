"use client";

import {
  Root as AvatarRoot,
  Image as AvatarImagePrimitive,
  Fallback as AvatarFallbackPrimitive,
} from "@radix-ui/react-avatar";
import { cva } from "class-variance-authority";
import { createContext, forwardRef, useContext } from "react";

import { cn } from "../lib/utils";
import type {
  AvatarFallbackProps,
  AvatarImageProps,
  AvatarProps,
} from "../types/avatar";

/**
 * Avatar Component - Design System Specification
 *
 * Displays user avatars with image and fallback support. Built on Radix UI
 * primitives for robust image loading and fallback handling.
 *
 * **Component Structure**:
 * - `Avatar`: Root container with size variants
 * - `AvatarImage`: Image element with src/alt attributes
 * - `AvatarFallback`: Fallback content (typically initials) when image fails
 *
 * **Sizes**:
 * - sm: 32px (h-8 w-8) - For compact layouts, table rows, lists
 * - md: 40px (h-10 w-10) - Default size, general use
 * - lg: 48px (h-12 w-12) - For prominent displays, profile pages
 * - xl: 64px (h-16 w-16) - For large profile displays, user panels
 * - 2xl: 80px (h-20 w-20) - For profile headers, large avatars
 *
 * **Design Specs**:
 * - Border radius: rounded-full (circular)
 * - Background: bg-accent (slate-100 light, slate-800 dark)
 * - Text color: text-accent-foreground (slate-900 light, slate-100 dark)
 * - Fallback text scales with avatar size (text-xs to text-2xl)
 *
 * **Accessibility**:
 * - Always provide `alt` text on AvatarImage for screen readers
 * - Use meaningful fallback text (user initials, not decorative)
 * - Built on Radix UI with WAI-ARIA compliance
 * - Image loading handled gracefully with fallback
 *
 * @example
 * // With image
 * <Avatar size="md">
 *   <AvatarImage src="/user.jpg" alt="John Doe" />
 *   <AvatarFallback>JD</AvatarFallback>
 * </Avatar>
 *
 * @example
 * // Fallback only (no image)
 * <Avatar size="lg">
 *   <AvatarFallback>AB</AvatarFallback>
 * </Avatar>
 *
 * @example
 * // Small size for lists
 * <Avatar size="sm">
 *   <AvatarImage src="/avatar.jpg" alt="User" />
 *   <AvatarFallback>U</AvatarFallback>
 * </Avatar>
 *
 * @example
 * // Extra large for profile headers
 * <Avatar size="2xl">
 *   <AvatarImage src="/profile.jpg" alt="User Name" />
 *   <AvatarFallback>UN</AvatarFallback>
 * </Avatar>
 *
 * @see {@link https://www.radix-ui.com/primitives/docs/components/avatar Radix UI Avatar}
 * @see {@link https://github.com/nextlyhq/nextly/blob/main/ui-revamp/04-design-system-specification.md Design System Specification}
 */
export const avatarVariants = cva(
  "relative inline-flex shrink-0 overflow-hidden rounded-none items-center justify-center bg-muted text-muted-foreground",
  {
    variants: {
      size: {
        sm: "h-8 w-8",
        md: "h-10 w-10",
        lg: "h-12 w-12",
        xl: "h-16 w-16",
        "2xl": "h-20 w-20",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
);

/**
 * Text size mapping for AvatarFallback based on Avatar size
 * Uses React Context to reliably pass size from Avatar to AvatarFallback
 */
const fallbackTextSizeMap = {
  sm: "text-xs", // 12px for 32px avatar
  md: "text-sm", // 14px for 40px avatar
  lg: "text-base", // 16px for 48px avatar
  xl: "text-lg", // 18px for 64px avatar
  "2xl": "text-2xl", // 24px for 80px avatar
} as const;

/**
 * Context to pass size from Avatar to AvatarFallback
 * This ensures text scaling works reliably regardless of className overrides
 */
const AvatarSizeContext = createContext<AvatarProps["size"]>("md");

/**
 * Avatar root component
 *
 * Container element for avatar image and fallback. Provides consistent sizing
 * and styling across the application. Uses React Context to pass size to
 * AvatarFallback for reliable text scaling.
 */
const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(
  ({ className, size = "md", ...props }, ref) => {
    return (
      <AvatarSizeContext.Provider value={size}>
        <AvatarRoot
          ref={ref}
          data-slot="avatar"
          className={cn(avatarVariants({ size }), className)}
          {...props}
        />
      </AvatarSizeContext.Provider>
    );
  }
);
Avatar.displayName = "Avatar";

/**
 * AvatarImage component
 *
 * Displays the user's profile image. Falls back to AvatarFallback if image
 * fails to load or src is not provided.
 *
 * **Best Practices**:
 * - Always provide meaningful `alt` text (user's name, not "avatar" or "profile picture")
 * - Use optimized images (WebP, AVIF) for better performance
 * - Consider lazy loading for images below the fold
 *
 * @example
 * <AvatarImage src="/users/john-doe.jpg" alt="John Doe" />
 */
const AvatarImage = forwardRef<HTMLImageElement, AvatarImageProps>(
  ({ className, ...props }, ref) => {
    return (
      <AvatarImagePrimitive
        ref={ref}
        data-slot="avatar-image"
        className={cn("aspect-square size-full", className)}
        {...props}
      />
    );
  }
);
AvatarImage.displayName = "AvatarImage";

/**
 * AvatarFallback component
 *
 * Displays fallback content when image is not available or fails to load.
 * Typically shows user initials (1-2 characters). Text size automatically
 * scales based on the Avatar size using React Context.
 *
 * **Best Practices**:
 * - Use 1-2 uppercase characters (user initials: "JD", "AB")
 * - Keep text concise and meaningful
 * - Don't use decorative text ("?", "NA") - use initials or icon instead
 *
 * **Text Sizing** (scales with avatar size via Context):
 * - sm (32px): text-xs (12px)
 * - md (40px): text-sm (14px)
 * - lg (48px): text-base (16px)
 * - xl (64px): text-lg (18px)
 * - 2xl (80px): text-2xl (24px)
 *
 * @example
 * // User initials
 * <AvatarFallback>JD</AvatarFallback>
 *
 * @example
 * // Single character for compact layouts
 * <AvatarFallback>J</AvatarFallback>
 *
 * @example
 * // Custom delay before showing fallback
 * <AvatarFallback delayMs={300}>AB</AvatarFallback>
 */
const AvatarFallback = forwardRef<HTMLSpanElement, AvatarFallbackProps>(
  ({ className, children, ...props }, ref) => {
    const size = useContext(AvatarSizeContext) || "md";
    const textSize = fallbackTextSizeMap[size];

    return (
      <AvatarFallbackPrimitive
        ref={ref}
        data-slot="avatar-fallback"
        className={cn(
          "bg-muted text-muted-foreground flex size-full items-center justify-center rounded-none font-medium",
          textSize,
          className
        )}
        {...props}
      >
        {children}
      </AvatarFallbackPrimitive>
    );
  }
);
AvatarFallback.displayName = "AvatarFallback";

export { Avatar, AvatarImage, AvatarFallback };
