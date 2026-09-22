// Test-only harness (see app-error-boundary.spec.ts) — mounts the real
// AppErrorBoundary against a component that always throws, so the boundary
// itself is exercised directly rather than via a specific bug's crash path.
import React from "react";
import ReactDOM from "react-dom/client";
import { AppErrorBoundary } from "../../src/components/AppErrorBoundary";

function AlwaysThrows(): React.ReactElement {
  throw new Error("boom from test");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AlwaysThrows />
    </AppErrorBoundary>
  </React.StrictMode>
);
