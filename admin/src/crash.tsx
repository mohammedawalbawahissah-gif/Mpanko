import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "./report";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, info.componentStack ?? "");
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" style={{ padding: "2rem" }}>
        <h1>Something went wrong</h1>
        <p>The error has been reported. Reload the page to carry on.</p>
        <button className="btn" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
