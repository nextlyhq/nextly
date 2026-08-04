/**
 * Async server component for the Query Loop (spec §10). Fetches entries via the injected
 * dataProvider (bounded by the shared query budget), then delegates to the synchronous
 * QueryLoopView. Rendered only on the server (RenderNode intercepts `core/query-loop`);
 * never imports `getNextly`.
 */
import type { ReactNode } from "react";

import type { BlockRegistry } from "../../core/registry";
import type { BlockNode } from "../../core/types";
import type { RemotePatternInput } from "../../core/url-policy";
import type { DataProvider } from "../dataProvider";

import { QueryLoopView } from "./QueryLoopView";
import { runQuery, type QueryBudget } from "./runQuery";
import type { QueryLoopConfig } from "./types";

export interface QueryLoopProps {
  node: BlockNode;
  registry: BlockRegistry;
  dataProvider?: DataProvider;
  /** Hosts this page may load media from; forwarded to nested blocks. */
  remotePatterns?: readonly RemotePatternInput[];
  className: string;
  budget: QueryBudget;
}

export async function QueryLoop({
  node,
  registry,
  dataProvider,
  remotePatterns,
  className,
  budget,
}: QueryLoopProps): Promise<ReactNode> {
  const config = node.props as QueryLoopConfig;
  const result = await runQuery(dataProvider, config, budget);
  return (
    <QueryLoopView
      node={node}
      registry={registry}
      dataProvider={dataProvider}
      remotePatterns={remotePatterns}
      className={className}
      result={result}
      budget={budget}
    />
  );
}
