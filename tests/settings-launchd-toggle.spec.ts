import { test, expect, type Page } from "@playwright/test";

const mockUser = {
  id: 1,
  firebase_uid: "test-uid",
  email: "test@example.com",
  display_name: "Test User",
  daily_minutes_goal: 30,
  timezone: "America/Los_Angeles",
  time_practiced_today: 0,
  total_time_practiced: 0,
  max_days_no_review: 7,
  min_days_between_reviews: 1,
  num_songs_to_learn: 5,
};

const mockDashboard = {
  scale: null, key_signature: null, overdue: [],
  to_review: { songs: [] }, to_learn: { songs: [] }, project: { songs: [] },
  exercises: [], study_materials: [], chord: null, progression: null, interval: null,
};

interface SetupOptions {
  installed?: boolean;
  cachedIntent?: boolean;
  installError?: string;
  uninstallError?: string;
}

async function setupPage(page: Page, options: SetupOptions = {}) {
  await page.addInitScript((opts) => {
    const storeData: Record<string, unknown> = {
      launchdEnabled: opts.cachedIntent ?? false,
    };
    const calls: string[] = [];
    (window as unknown as { __launchdCalls: string[] }).__launchdCalls = calls;

    window.__TAURI_INTERNALS__ = {
      invoke(cmd: string, args?: Record<string, unknown>) {
        if (cmd === "plugin:store|load") return Promise.resolve(1);
        if (cmd === "plugin:store|get") {
          const key = args?.key as string;
          const exists = Object.prototype.hasOwnProperty.call(storeData, key);
          return Promise.resolve([exists ? storeData[key] : null, exists]);
        }
        if (cmd === "plugin:store|set") {
          storeData[args?.key as string] = args?.value;
          return Promise.resolve(null);
        }
        if (cmd === "plugin:store|save") return Promise.resolve(null);
        if (cmd === "plugin:store|has") {
          return Promise.resolve(Object.prototype.hasOwnProperty.call(storeData, args?.key as string));
        }
        if (cmd === "plugin:store|get_store") return Promise.resolve(null);
        if (cmd === "plugin:event|listen") return Promise.resolve(1);
        if (cmd === "plugin:event|unlisten") return Promise.resolve(null);
        if (cmd === "is_launchd_agent_installed") {
          calls.push(cmd);
          return Promise.resolve(opts.installed ?? false);
        }
        if (cmd === "install_launchd_agent") {
          calls.push(cmd);
          return opts.installError ? Promise.reject(opts.installError) : Promise.resolve(null);
        }
        if (cmd === "uninstall_launchd_agent") {
          calls.push(cmd);
          return opts.uninstallError ? Promise.reject(opts.uninstallError) : Promise.resolve(null);
        }
        return Promise.resolve(null);
      },
      transformCallback() { return Math.random(); },
    } as unknown as typeof window.__TAURI_INTERNALS__;
  }, options);

  await page.addInitScript(() => localStorage.setItem("ph:refreshToken", "fake-refresh-token"));
  await page.route("**/securetoken.googleapis.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }),
  }));
  await page.route("**/user/me", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(mockUser),
  }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard),
  }));
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

function launchdToggle(page: Page) {
  return page.getByRole("checkbox", { name: "Run nightly scan automatically (launchd)" });
}

test("enabling and disabling nightly scan invokes the launchd commands", async ({ page }) => {
  await setupPage(page);
  const toggle = launchdToggle(page);
  await expect(toggle).not.toBeChecked();

  await toggle.check();
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();

  const calls = await page.evaluate(() => (
    window as unknown as { __launchdCalls: string[] }
  ).__launchdCalls);
  expect(calls.filter((command) => command !== "is_launchd_agent_installed")).toEqual([
    "install_launchd_agent",
    "uninstall_launchd_agent",
  ]);
});

test("a failed install shows its actual error and leaves the toggle off", async ({ page }) => {
  await setupPage(page, { installError: "launchctl load failed: permission denied" });
  const toggle = launchdToggle(page);

  await toggle.click();

  await expect(page.getByRole("alertdialog")).toContainText("launchctl load failed: permission denied");
  await expect(toggle).not.toBeChecked();
});

test("a failed uninstall shows its actual error and leaves the toggle on", async ({ page }) => {
  await setupPage(page, { installed: true, uninstallError: "launchctl unload failed: busy" });
  const toggle = launchdToggle(page);
  await expect(toggle).toBeChecked();

  await toggle.click();

  await expect(page.getByRole("alertdialog")).toContainText("launchctl unload failed: busy");
  await expect(toggle).toBeChecked();
});

test("initial toggle state follows launchd ground truth instead of cached intent", async ({ page }) => {
  await setupPage(page, { installed: true, cachedIntent: false });

  await expect(launchdToggle(page)).toBeChecked();
});
