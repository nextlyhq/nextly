/* eslint-disable @typescript-eslint/no-explicit-any -- framework adapter passes through Next.js App Router context */
import { getNextly } from "@revnixhq/nextly";
import {
  createDynamicHandlers,
  getCollectionsHandler,
} from "@revnixhq/nextly/runtime";

import * as dynamicSchemas from "@/db/schemas/dynamic";

import nextlyConfig from "../../../../../nextly.config";

const handlers = createDynamicHandlers({ config: nextlyConfig });

// Initialize Nextly and register dynamic schemas
let schemasRegistered = false;

async function ensureSchemasRegistered() {
  if (!schemasRegistered) {
    // First ensure Nextly is initialized with config (this sets up the DI container)
    await getNextly({ config: nextlyConfig });

    // Get the CollectionsHandler from the DI container
    // This is the same handler that the dispatcher uses for API requests
    const collectionsHandler = getCollectionsHandler();
    if (collectionsHandler && "registerDynamicSchemas" in collectionsHandler) {
      collectionsHandler.registerDynamicSchemas(dynamicSchemas);
    }
    schemasRegistered = true;
  }
}

// Wrap handlers to ensure schemas are registered
export const GET = async (req: Request, context: any) => {
  await ensureSchemasRegistered();
  return handlers.GET(req, context);
};

export const POST = async (req: Request, context: any) => {
  await ensureSchemasRegistered();
  return handlers.POST(req, context);
};

export const PUT = async (req: Request, context: any) => {
  await ensureSchemasRegistered();
  return handlers.PUT(req, context);
};

export const PATCH = async (req: Request, context: any) => {
  await ensureSchemasRegistered();
  return handlers.PATCH(req, context);
};

export const DELETE = async (req: Request, context: any) => {
  await ensureSchemasRegistered();
  return handlers.DELETE(req, context);
};

export const OPTIONS = async (req: Request) => {
  await ensureSchemasRegistered();
  return handlers.OPTIONS(req);
};
