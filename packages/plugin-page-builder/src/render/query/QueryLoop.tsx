/**
 * Async server component for the Query Loop (spec §10). Fetches entries via the injected
 * dataProvider (bounded by the shared query budget), then delegates to the synchronous
 * QueryLoopView. Rendered only on the server (RenderNode intercepts `core/query-loop`);
 * never imports `getNextly`.
 */
import type { ReactNode } from "react";

import type { BlockRegistry } from "../../core/registry";
import type { BlockNode } from "../../core/types";
import type { DataProvider } from "../dataProvider";

import { QueryLoopView } from "./QueryLoopView";
import { runQuery, type QueryBudget } from "./runQuery";
import type { QueryLoopConfig } from "./types";

export interface QueryLoopProps {
  node: BlockNode;
  registry: BlockRegistry;
  dataProvider?: DataProvider;
  className: string;
  budget: QueryBudget;
}

export async function QueryLoop({
  node,
  registry,
  dataProvider,
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
      className={className}
      result={result}
      budget={budget}
    />
  );
}
