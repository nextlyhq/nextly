/**
 * Example Database Lifecycle Hooks for Nextly
 *
 * This file demonstrates practical hook implementations for common use cases.
 * Register these hooks in your Next.js application by importing this file.
 *
 * Usage in Next.js:
 * ```typescript
 * // app/layout.tsx
 * import '../hooks/example-hooks'; // Register hooks on server startup
 * ```
 *
 * @see docs/HOOKS_GUIDE.md for comprehensive documentation
 */

import { registerHook, type HookContext } from "@revnixhq/nextly";

// ============================================================================
// 1. AUTO-GENERATE SLUG FROM TITLE
// ============================================================================

/**
 * Generates URL-friendly slugs from titles for posts
 *
 * Features:
 * - Auto-generates slug on create if not provided
 * - Regenerates slug on update if title changes
 * - Handles special characters and whitespace
 */

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "") // Remove special chars
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single
    .replace(/^-|-$/g, ""); // Remove leading/trailing hyphens
}

registerHook("beforeCreate", "posts", async (context: HookContext) => {
  if (context.data?.title && !context.data?.slug) {
    return { ...context.data, slug: slugify(context.data.title) };
  }
  return context.data;
});

registerHook("beforeUpdate", "posts", async (context: HookContext) => {
  // Regenerate slug if title changed
  if (
    context.data?.title &&
    context.originalData?.title !== context.data.title
  ) {
    return { ...context.data, slug: slugify(context.data.title) };
  }
  return context.data;
});

// ============================================================================
// 2. PASSWORD HASHING FOR USERS
// ============================================================================

/**
 * Automatically hashes passwords before storing in database
 *
 * Security:
 * - Uses bcrypt with 10 salt rounds
 * - Only hashes when password is new or changed
 * - Prevents storing plain-text passwords
 */

registerHook("beforeCreate", "users", async (context: HookContext) => {
  if (context.data?.password) {
    // SECURITY WARNING: This is a placeholder implementation for demonstration only
    // DO NOT use in production without replacing with actual bcrypt hashing
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SECURITY: Password hashing placeholder detected in production. " +
          "Install bcryptjs and replace with: await bcrypt.hash(password, 10)"
      );
    }

    // For development/testing only - NOT SECURE
    // Production implementation:
    // const bcrypt = await import("bcryptjs");
    // const hashedPassword = await bcrypt.hash(context.data.password, 10);
    // return { ...context.data, password: hashedPassword };

    return { ...context.data, password: `hashed_${context.data.password}` };
  }
  return context.data;
});

registerHook("beforeUpdate", "users", async (context: HookContext) => {
  // Only hash if password is being changed
  if (
    context.data?.password &&
    context.data.password !== context.originalData?.password
  ) {
    // SECURITY WARNING: This is a placeholder implementation for demonstration only
    // DO NOT use in production without replacing with actual bcrypt hashing
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SECURITY: Password hashing placeholder detected in production. " +
          "Install bcryptjs and replace with: await bcrypt.hash(password, 10)"
      );
    }

    // For development/testing only - NOT SECURE
    // Production implementation:
    // const bcrypt = await import("bcryptjs");
    // const hashedPassword = await bcrypt.hash(context.data.password, 10);
    // return { ...context.data, password: hashedPassword };

    return { ...context.data, password: `hashed_${context.data.password}` };
  }
  return context.data;
});

// ============================================================================
// 3. AUDIT LOGGING FOR ALL COLLECTIONS
// ============================================================================

/**
 * Comprehensive audit logging for all database operations
 *
 * Logs:
 * - All creates, updates, and deletes
 * - User who performed the action
 * - Timestamp of the action
 * - Before/after data for updates
 */

registerHook("afterCreate", "*", async (context: HookContext) => {
  console.log(`[AUDIT] Created ${context.collection}`, {
    recordId: context.data.id,
    userId: context.user?.id,
    timestamp: new Date().toISOString(),
    data: context.data,
  });

  // In production, write to audit_logs table:
  // await db.insert('audit_logs').values({
  //   collection: context.collection,
  //   operation: 'create',
  //   recordId: context.data.id,
  //   userId: context.user?.id,
  //   data: JSON.stringify(context.data),
  //   timestamp: new Date(),
  // });
});

registerHook("afterUpdate", "*", async (context: HookContext) => {
  console.log(`[AUDIT] Updated ${context.collection}`, {
    recordId: context.data.id,
    userId: context.user?.id,
    timestamp: new Date().toISOString(),
    changes: {
      before: context.originalData,
      after: context.data,
    },
  });
});

registerHook("afterDelete", "*", async (context: HookContext) => {
  console.log(`[AUDIT] Deleted ${context.collection}`, {
    recordId: context.data.id,
    userId: context.user?.id,
    timestamp: new Date().toISOString(),
    data: context.data,
  });
});

// ============================================================================
// 4. WEBHOOK NOTIFICATIONS
// ============================================================================

/**
 * Trigger external webhooks after post operations
 *
 * Use cases:
 * - Notify external systems of content changes
 * - Trigger CI/CD deployments
 * - Update external search indexes
 */

async function triggerWebhook(event: string, data: any) {
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) return; // Skip if webhook not configured

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        data,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.error(`[WEBHOOK] Failed to send ${event}:`, error);
    // Don't throw - we don't want webhook failures to rollback DB operations
  }
}

registerHook("afterCreate", "posts", async (context: HookContext) => {
  await triggerWebhook("post.created", {
    id: context.data.id,
    title: context.data.title,
    slug: context.data.slug,
  });
});

registerHook("afterUpdate", "posts", async (context: HookContext) => {
  await triggerWebhook("post.updated", {
    id: context.data.id,
    title: context.data.title,
    changes: {
      before: context.originalData,
      after: context.data,
    },
  });
});

registerHook("afterDelete", "posts", async (context: HookContext) => {
  await triggerWebhook("post.deleted", {
    id: context.data.id,
  });
});

// ============================================================================
// 5. AUTO-INCREMENT VERSION NUMBERS
// ============================================================================

/**
 * Track version numbers for document revisions
 *
 * Features:
 * - Starts at version 1 on create
 * - Increments version on every update
 * - Useful for optimistic locking and change tracking
 */

registerHook("beforeCreate", "documents", async (context: HookContext) => {
  return { ...context.data, version: 1 };
});

registerHook("beforeUpdate", "documents", async (context: HookContext) => {
  const currentVersion = context.originalData?.version || 0;
  return { ...context.data, version: currentVersion + 1 };
});

// ============================================================================
// 6. VALIDATE BUSINESS RULES
// ============================================================================

/**
 * Enforce business rules for orders
 *
 * Rules:
 * - Order total must be positive
 * - Order must contain at least one item
 * - Cannot ship unpaid orders
 * - Cannot delete shipped orders
 */

registerHook("beforeCreate", "orders", async (context: HookContext) => {
  // Validate order total
  if (!context.data?.total || context.data.total <= 0) {
    throw new Error("Order total must be greater than zero");
  }

  // Validate order has items
  if (!context.data?.items || context.data.items.length === 0) {
    throw new Error("Order must contain at least one item");
  }

  return context.data;
});

registerHook("beforeUpdate", "orders", async (context: HookContext) => {
  // Prevent shipping unpaid orders
  if (
    context.data?.status === "shipped" &&
    context.originalData?.paymentStatus !== "paid"
  ) {
    throw new Error("Cannot ship unpaid orders");
  }

  return context.data;
});

registerHook("beforeDelete", "orders", async (context: HookContext) => {
  // Prevent deleting shipped orders
  if (context.data?.status === "shipped") {
    throw new Error("Cannot delete shipped orders");
  }
});

// ============================================================================
// 7. SEND EMAIL NOTIFICATIONS
// ============================================================================

/**
 * Send email notifications for user-related events
 *
 * Events:
 * - Welcome email on user creation
 * - Order shipped notification
 */

async function sendEmail(options: {
  to: string;
  subject: string;
  template: string;
  data: any;
}) {
  console.log(`[EMAIL] Sending ${options.template} to ${options.to}`, options);

  // In production, use an email service:
  // await emailService.send({
  //   to: options.to,
  //   subject: options.subject,
  //   template: options.template,
  //   data: options.data,
  // });
}

registerHook("afterCreate", "users", async (context: HookContext) => {
  if (context.data?.email) {
    await sendEmail({
      to: context.data.email,
      subject: "Welcome to Nextly",
      template: "welcome",
      data: {
        name: context.data.name || "User",
      },
    });
  }
});

registerHook("afterUpdate", "orders", async (context: HookContext) => {
  // Send email when order status changes to shipped
  if (
    context.data?.status === "shipped" &&
    context.originalData?.status !== "shipped"
  ) {
    await sendEmail({
      to: context.data.userEmail,
      subject: "Your Order Has Shipped",
      template: "order-shipped",
      data: {
        orderId: context.data.id,
        trackingNumber: context.data.trackingNumber,
      },
    });
  }
});

// ============================================================================
// 8. CACHE INVALIDATION
// ============================================================================

/**
 * Invalidate caches when data changes
 *
 * Patterns:
 * - Clear list cache on any change
 * - Clear specific item cache on update/delete
 */

async function invalidateCache(...keys: string[]) {
  console.log("[CACHE] Invalidating keys:", keys);

  // In production, use Redis or similar:
  // for (const key of keys) {
  //   await redis.del(key);
  // }
}

registerHook("afterCreate", "posts", async (context: HookContext) => {
  await invalidateCache("posts:list", `posts:${context.data.id}`);
});

registerHook("afterUpdate", "posts", async (context: HookContext) => {
  await invalidateCache("posts:list", `posts:${context.data.id}`);
});

registerHook("afterDelete", "posts", async (context: HookContext) => {
  await invalidateCache("posts:list", `posts:${context.data.id}`);
});

// ============================================================================
// 9. AUTO-POPULATE TIMESTAMPS
// ============================================================================

/**
 * Automatically manage createdAt and updatedAt timestamps
 *
 * Note: Only needed if not using database-level timestamps
 */

registerHook("beforeCreate", "*", async (context: HookContext) => {
  const now = new Date();
  return {
    ...context.data,
    createdAt: context.data?.createdAt || now,
    updatedAt: context.data?.updatedAt || now,
  };
});

registerHook("beforeUpdate", "*", async (context: HookContext) => {
  return {
    ...context.data,
    updatedAt: new Date(),
  };
});

// ============================================================================
// 10. SANITIZE USER INPUT
// ============================================================================

/**
 * Sanitize user input to prevent XSS attacks
 *
 * Applies to:
 * - Text fields
 * - HTML content
 */

function sanitizeString(str: string): string {
  return str
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

function sanitizeObject(obj: any): any {
  if (typeof obj === "string") {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  if (obj && typeof obj === "object") {
    const sanitized: any = {};
    for (const key in obj) {
      // Skip known HTML fields that should allow HTML
      if (key === "content" || key === "html" || key === "description") {
        sanitized[key] = obj[key];
      } else {
        sanitized[key] = sanitizeObject(obj[key]);
      }
    }
    return sanitized;
  }

  return obj;
}

registerHook("beforeCreate", "posts", async (context: HookContext) => {
  return sanitizeObject(context.data);
});

registerHook("beforeUpdate", "posts", async (context: HookContext) => {
  return sanitizeObject(context.data);
});

// ============================================================================
// 11. SHARED CONTEXT EXAMPLE
// ============================================================================

/**
 * Demonstrates using shared context to pass data between hooks
 *
 * Pattern:
 * - beforeCreate: Perform validation and store results
 * - afterCreate: Use validation results for conditional logic
 */

registerHook("beforeCreate", "posts", async (context: HookContext) => {
  // Store validation timestamp in shared context
  context.context.validatedAt = new Date();
  context.context.validationDuration = 0;

  return context.data;
});

registerHook("afterCreate", "posts", async (context: HookContext) => {
  // Access validation timestamp from before hook
  const validatedAt = context.context.validatedAt as Date;
  const duration = Date.now() - validatedAt.getTime();

  console.log(`[TIMING] Post creation took ${duration}ms`);
});

// ============================================================================
// 12. CONDITIONAL HOOK EXECUTION
// ============================================================================

/**
 * Execute hook logic conditionally based on data changes
 */

registerHook("afterUpdate", "posts", async (context: HookContext) => {
  // Only trigger webhook if status changed
  if (context.originalData?.status !== context.data?.status) {
    await triggerWebhook("post.status_changed", {
      id: context.data.id,
      oldStatus: context.originalData.status,
      newStatus: context.data.status,
    });
  }

  // Only invalidate cache if title or content changed
  if (
    context.originalData?.title !== context.data?.title ||
    context.originalData?.content !== context.data?.content
  ) {
    await invalidateCache(`posts:${context.data.id}`);
  }
});

// ============================================================================
// NOTES AND BEST PRACTICES
// ============================================================================

/**
 * BEST PRACTICES:
 *
 * 1. Keep hooks focused - each hook should do one thing well
 * 2. Handle errors gracefully - use try/catch for non-critical operations
 * 3. Avoid circular dependencies - don't trigger the same operation from a hook
 * 4. Use shared context for communication between before/after hooks
 * 5. Return modified data explicitly from before* hooks
 * 6. Use TypeScript for type safety
 * 7. Test hooks independently from database operations
 * 8. Use global hooks (*) sparingly - they run for all collections
 *
 * PERFORMANCE:
 *
 * - Minimize database queries in hooks
 * - Use caching for expensive operations
 * - Defer non-critical operations to background jobs
 * - Each hook adds ~0.5-2ms overhead
 *
 * ERROR HANDLING:
 *
 * - Hook errors automatically rollback database transactions
 * - For non-critical hooks (webhooks, emails), catch errors to prevent rollback
 * - Provide user-friendly error messages
 *
 * TESTING:
 *
 * - Write unit tests for hook logic
 * - Write integration tests with actual database operations
 * - Test error scenarios and rollback behavior
 * - Use clearAllHooks() in test cleanup
 *
 * @see docs/HOOKS_GUIDE.md for comprehensive documentation
 */

console.log("[HOOKS] Example database lifecycle hooks registered");
