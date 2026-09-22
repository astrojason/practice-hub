import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort safety net for the whole app. Without this, an uncaught
 * render error anywhere unmounts the entire tree, leaving a blank page
 * until a hard reload — a silent failure with no indication anything went
 * wrong. This surfaces the actual error and offers a reload instead.
 *
 * Must be a class component: componentDidCatch/getDerivedStateFromError
 * have no hook equivalent.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught render error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-modal-overlay">
        <div className="error-modal" role="alertdialog" aria-modal="true">
          <div className="error-modal-header">
            <h3 className="error-modal-title">Something went wrong</h3>
          </div>
          <p className="error-modal-message">{error.message}</p>
          <div className="error-modal-footer">
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
