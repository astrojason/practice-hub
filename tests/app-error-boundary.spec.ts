import { test, expect } from "@playwright/test";

// Standalone: mounts a tiny host page that reuses the real AppErrorBoundary
// component against a component that throws on render, so this doesn't
// depend on finding a real crash path elsewhere in the app.
test("an uncaught render error is caught and shown instead of leaving the app blank", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/tests/fixtures/error-boundary-harness.html");

  await expect(page.locator(".error-modal-title")).toHaveText("Something went wrong");
  await expect(page.locator(".error-modal-message")).toHaveText("boom from test");
  await expect(page.locator("button", { hasText: "Reload" })).toBeVisible();
});
