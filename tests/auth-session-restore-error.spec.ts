import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ph:refreshToken", "fake-refresh-token");
  });

  // The stored refresh token no longer works (e.g. revoked, expired).
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "TOKEN_EXPIRED" } }),
    })
  );

  await page.goto("/");
});

test("a failed session restore surfaces the real error instead of silently dropping back to sign-in", async ({ page }) => {
  await expect(page.getByRole("button", { name: /Sign in with Google/i })).toBeVisible();

  await expect(page.locator(".error-modal")).toBeVisible();
  await expect(page.getByText(/restore your previous session/i)).toBeVisible();
  await expect(page.getByText(/TOKEN_EXPIRED/i)).toBeVisible();
});
