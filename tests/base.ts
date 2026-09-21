import { test as base, expect } from "@playwright/test";

export * from "@playwright/test";

// Default mocks for the streak-token and album-badge fetches (and the album
// list), so specs that don't care about them don't hit an unmocked network
// call and its error modal. Specs that do care register their own route,
// which takes priority.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route("**/user-streak-token", (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ uses: [] }) });
    });
    await page.route("**/user-album-badge", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ badges: [], in_progress: [], newly_awarded: [] }),
      })
    );
    await page.route("**/album**", (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ albums: [] }) });
    });
    await use(page);
  },
});
export { expect };
