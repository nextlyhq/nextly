/* eslint-disable @typescript-eslint/no-explicit-any -- framework adapter passes through Next.js App Router context */
/**
 * Admin API catch-all. Routes every /admin/api/* request (incl. your plugin's
 * /api/plugins/<name>/… routes) through the handler built from nextly.config.ts.
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
