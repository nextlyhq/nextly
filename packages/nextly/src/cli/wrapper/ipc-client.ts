// What: HTTP client for wrapper -> child IPC over 127.0.0.1 with auth token
// and retry-with-backoff.
// Why: at wrapper startup the child may not have bound its port yet, so early
// pending events must be retried. During runtime a request may also fail
// transiently if the child is mid-restart. Exponential backoff up to
// maxRetryMs before surfacing the error to the caller.

import type {
  AppliedChangePayload,
  ApplyRequest,
  ApplyRequestResult,
  PendingChangePayload,
} from "../../domains/schema/types/ipc-types.js";

export interface IpcClientOptions {
  baseUrl: string;
  token: string;
  retryMs?: number;
  maxRetryMs?: number;
}

export class IpcClient {
  constructor(private opts: IpcClientOptions) {}

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.rawFetch("/__nextly/health", { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  }

  async postPending(payload: PendingChangePayload): Promise<void> {
    await this.fetchWithRetry("/__nextly/pending", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });
  }

  async postApplied(payload: AppliedChangePayload): Promise<void> {
    await this.fetchWithRetry("/__nextly/applied", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });
  }

  async getApplyRequests(): Promise<ApplyRequest[]> {
    try {
      const res = await this.rawFetch("/__nextly/apply-request", {
        method: "GET",
      });
      if (!res.ok) return [];
      return (await res.json()) as ApplyRequest[];
    } catch {
      return [];
    }
  }

  async postApplyResult(result: ApplyRequestResult): Promise<void> {
    await this.fetchWithRetry("/__nextly/apply-result", {
      method: "POST",
      body: JSON.stringify(result),
      headers: { "content-type": "application/json" },
    });
  }

  private async rawFetch(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("x-nextly-ipc-token", this.opts.token);
    return fetch(`${this.opts.baseUrl}${path}`, { ...init, headers });
  }

  // Retries on network errors and 5xx responses with exponential backoff.
  // 4xx responses (other than 408/429) are considered terminal because they
  // mean the request is semantically malformed or unauthorized - retrying
  // would not help.
  private async fetchWithRetry(
    path: string,
    init: RequestInit
  ): Promise<Response> {
    const baseDelay = this.opts.retryMs ?? 500;
    const maxDelay = this.opts.maxRetryMs ?? 10_000;
    let delay = baseDelay;
    const deadline = Date.now() + maxDelay;
    let lastError: unknown = null;

    while (Date.now() <= deadline) {
      try {
        const res = await this.rawFetch(path, init);
        if (res.ok) return res;
        if (
          res.status >= 400 &&
          res.status < 500 &&
          res.status !== 408 &&
          res.status !== 429
        ) {
          throw new Error(
            `IPC request ${path} failed: ${res.status} ${res.statusText}`
          );
        }
        lastError = new Error(`IPC request ${path}: ${res.status}`);
      } catch (err) {
        lastError = err;
      }
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 2, 2000);
    }

    const msg =
      lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`IPC request ${path} failed after retries: ${msg}`);
  }
}
