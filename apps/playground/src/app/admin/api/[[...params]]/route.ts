/* eslint-disable @typescript-eslint/no-explicit-any -- framework adapter passes through Next.js App Router context */
/**
 * Admin API catch-all. Routes every /admin/api/* request through the
 * dynamic handler created from nextly.config.ts.
 *
 * The playground is code-first — Posts/Categories/Tags are defined in
 * nextly.config.ts. There are no dynamic (admin-UI-defined) schemas to
 * register. The previous version of this file used to import from
 * `@/db/schemas/dynamic` and register them at boot; that path is gone
 * with the playground rewrite.
 */
import { createDynamicHandlers } from "nextly/runtime";

import nextlyConfig from "../../../../../nextly.config";

const handlers = createDynamicHandlers({ config: nextlyConfig });

export const GET = (req: Request, context: any) => handlers.GET(req, context);
export const POST = (req: Request, context: any) => handlers.POST(req, context);
export const PUT = (req: Request, context: any) => handlers.PUT(req, context);
export const PATCH = (req: Request, context: any) =>
  handlers.PATCH(req, context);
export const DELETE = (req: Request, context: any) =>
  handlers.DELETE(req, context);
export const OPTIONS = (req: Request) => handlers.OPTIONS(req);
