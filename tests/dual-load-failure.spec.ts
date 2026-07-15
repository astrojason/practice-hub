import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ph:refreshToken", "fake-refresh-token");
  });

  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }),
    })
  );
  await page.route("**/user/me", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "user service down" }) })
  );
  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "dashboard service down" }) })
  );

  await page.goto("/");
});

test("when both dashboard and user-profile requests fail, both failures are shown instead of only the first", async ({ page }) => {
  await expect(page.locator(".load-error-title")).toBeVisible();

  await expect(page.getByText(/user service down/i)).toBeVisible();
  await expect(page.getByText(/dashboard service down/i)).toBeVisible();
});
