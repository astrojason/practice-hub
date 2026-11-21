import { test, expect } from "./base";

const mockUser = {
  id: 1, firebase_uid: "test-uid", email: "test@example.com", display_name: "Test User",
  daily_minutes_goal: 30, timezone: "America/New_York", time_practiced_today: 0,
  total_time_practiced: 0, max_days_no_review: 7, min_days_between_reviews: 1, num_songs_to_learn: 5,
};

const mockDashboard = {
  scale: null, key_signature: null, overdue: [], to_review: { songs: [] }, to_learn: { songs: [] },
  project: { songs: [] }, exercises: [], study_materials: [], chord: null, progression: null, interval: null,
};


const base = async (page: import("@playwright/test").Page, admin: boolean) => {
  await page.addInitScript((isAdmin) => {
    localStorage.setItem("ph:refreshToken", "fake-refresh-token");
    (window as unknown as Record<string, unknown>).__saved = [];
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke(cmd: string, args?: Record<string, unknown>) {
        if (cmd === "get_app_config") {
          return Promise.resolve({ config: { admin: isAdmin, gp_library_root: "/Songs", instrumenta_python: "~/py", cron_jobs_dir: "~/jobs" }, path: "/cfg/config.json" });
        }
        if (cmd === "save_app_config") {
          ((window as unknown as Record<string, unknown[]>).__saved).push(args as never);
          return Promise.resolve(null);
        }
        if (cmd === "plugin:store|load") return Promise.resolve(1);
        if (cmd === "plugin:store|get") return Promise.resolve([null, false]);
        if (cmd === "plugin:store|set" || cmd === "plugin:store|save") return Promise.resolve(null);
        if (cmd === "plugin:event|listen") return Promise.resolve(1);
        if (cmd === "plugin:event|unlisten") return Promise.resolve(null);
        if (cmd === "is_launchd_agent_installed") return Promise.resolve(false);
        return Promise.resolve(null);
      },
      transformCallback: () => Math.random(),
    };
  }, admin);
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) })
  );
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) }));
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
};

test("by default the admin features (GP Library, settings) are hidden", async ({ page }) => {
  await base(page, false);
  await expect(page.locator("button", { hasText: "Theory Training" }).first()).toBeVisible();
  await expect(page.locator("button", { hasText: "GP Library" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
});

test("without a desktop config file (a plain browser) the admin features are off too", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ph:refreshToken", "fake-refresh-token"));
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) })
  );
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) }));
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await expect(page.locator("button", { hasText: "GP Library" })).toHaveCount(0);
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("with admin on in the config file, the admin features show, and their paths come from and go to that file", async ({ page }) => {
  await base(page, true);
  await expect(page.locator("button", { hasText: "GP Library" })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByTestId("admin-paths")).toContainText("/cfg/config.json");
  await expect(page.locator('input[aria-label="Guitar Pro folder"]')).toHaveValue("/Songs");
  await expect(page.locator('input[aria-label="Instrumenta Python"]')).toHaveValue("~/py");
  await page.locator('input[aria-label="Guitar Pro folder"]').fill("/Music/GP");
  await page.getByRole("button", { name: "Save paths" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __saved: unknown[] }).__saved.length)).toBe(1);
  const saved = await page.evaluate(() => (window as unknown as { __saved: Record<string, string>[] }).__saved[0]);
  expect(saved).toEqual({ gpLibraryRoot: "/Music/GP", instrumentaPython: "~/py", cronJobsDir: "~/jobs" });
});
