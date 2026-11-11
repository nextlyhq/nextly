import type { JSX } from "react";

import type { BuilderPendingChanges } from "@admin/hooks/useBuilderEntityState";

type Props = {
  pending: BuilderPendingChanges;
  count: number;
  locked?: boolean;
};

export function PendingChangesControls(_props: Props): JSX.Element {
  return (
    <>
      <span data-testid="pending-changes-count" />
      <div role="status" />
    </>
  );
}
