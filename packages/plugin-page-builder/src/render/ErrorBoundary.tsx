"use client";

/**
 * Per-block error isolation (spec §10). The single intentional client island in
 * `render/`: a throwing block renders a small fallback instead of taking down the
 * whole page/canvas. `getDerivedStateFromError` also works under
 * `renderToStaticMarkup`, so server output is protected too.
 */
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}
interface State {
  failed: boolean;
}

export class BlockErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) {
      return this.props.fallback ?? <div data-nx-block-error="1" />;
    }
    return this.props.children;
  }
}
