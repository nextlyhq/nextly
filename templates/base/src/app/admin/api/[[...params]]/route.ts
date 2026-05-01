import { createDynamicHandlers } from "@revnixhq/nextly/runtime";

import nextlyConfig from "../../../../../nextly.config";

const handlers = createDynamicHandlers({ config: nextlyConfig });

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PUT = handlers.PUT;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
export const OPTIONS = handlers.OPTIONS;
