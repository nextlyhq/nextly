// In-process SSE subscriber registry for dev-mode browser auto-reload.
//
// globalThis storage survives Turbopack module re-evaluation so all
// require() / import() calls within one Node.js process share the same Set.
// Never imported in production paths — callers guard with NODE_ENV checks.

const g = globalThis as {
  __nextly_sseCtrl?: Set<ReadableStreamDefaultController<string>>;
};

function ctls(): Set<ReadableStreamDefaultController<string>> {
  if (!g.__nextly_sseCtrl) g.__nextly_sseCtrl = new Set();
  return g.__nextly_sseCtrl;
}

export function subscribeDevReload(
  ctrl: ReadableStreamDefaultController<string>
): () => void {
  ctls().add(ctrl);
  return () => ctls().delete(ctrl);
}

export function broadcastDevReload(): void {
  for (const ctrl of ctls()) {
    try {
      ctrl.enqueue("event: schema-reload\ndata: {}\n\n");
    } catch {
      ctls().delete(ctrl);
    }
  }
}
