/**
 * Health Check Endpoint - Example Usage
 *
 * This file demonstrates how end users would integrate Nextly's health check
 * endpoint into their Next.js applications after installing the nextly package.
 *
 * The route handlers are imported from nextly and re-exported here,
 * creating a /api/health endpoint in the application.
 *
 * @example Installation
 * ```bash
 * npm install nextly
 * ```
 *
 * @example Usage
 * ```typescript
 * // In your Next.js app: app/api/health/route.ts
 * export { GET, HEAD } from '@revnixhq/nextly/api/health';
 * ```
 *
 * @see {@link https://nextjs.org/docs/app/building-your-application/routing/route-handlers | Next.js Route Handlers}
 */

// Re-export health check route handlers from nextly package
// This is the pattern end users will use in their applications
export { GET, HEAD } from "@revnixhq/nextly/api/health";
