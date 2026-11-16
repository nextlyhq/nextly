/**
 * The id of the request being served, for what runs while serving it.
 *
 * A refusal's reason is logged by the gate that refused, which may be deep in
 * a service with no request in hand. It reads the id here, so an operator can
 * join the log line to the response the caller reports. The request is the
 * one the boundary pinned (`hooks/request-scope`), and its id the one it is
 * answered with (`readOrGenerateRequestId`). A job a request starts runs on
 * nobody's request, and so has no id here.
 *
 * @module api/serving-request
 */
import { currentRequest } from "../hooks/request-scope";

import { readOrGenerateRequestId } from "./request-id";

/** The id of the request the running operation serves, where it serves one. */
export function servingRequestId(): string | undefined {
  const request = currentRequest();
  return request ? readOrGenerateRequestId(request) : undefined;
}
