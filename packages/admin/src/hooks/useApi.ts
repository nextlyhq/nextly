import { protectedApi } from "../lib/api/protectedApi";
import { publicApi } from "../lib/api/publicApi";

// Stable singleton so consumers can safely include `api` in useEffect
// dependency arrays without triggering a re-run on every render.
const _api = {
  public: publicApi,
  protected: protectedApi,
} as const;

export function useApi() {
  return { api: _api };
}
