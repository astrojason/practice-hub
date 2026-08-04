import { test, expect } from "@playwright/test";

const mockUser = {
  id: 1,
  firebase_uid: "test-uid",
  email: "test@example.com",
  display_name: "Test User",
  daily_minutes_goal: 30,
  timezone: "America/New_York",
  time_practiced_today: 0,
  total_time_practiced: 0,
  max_days_no_review: 7,
  min_days_between_reviews: 1,
  num_songs_to_learn: 5,
};

const song = {
  id: 100,
  name: "Nutshell",
  artist_id: 1,
  artist_name: "Alice In Chains",
  tuning_id: 1,
  tuning_name: "Standard",
  bpm: null,
  active: true,
  resources: null,
  tags: [],
  seconds: null,
  session_type: "song",
  created_timestamp: 0,
  updated_timestamp: 0,
  meta: { sessions: [] },
};

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: { songs: [] },
  to_learn: { songs: [] },
  project: { id: 1, songs: [song] },
  exercises: [],
  study_materials: [],
  chord: null,
  progression: null,
  interval: null,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__TAURI_INTERNALS__ = {
      invoke: function (cmd: string) {
        if (cmd === "plugin:store|load") return Promise.resolve(1);
        // The stored-key lookup itself fails (e.g. corrupted store file).
        if (cmd === "plugin:store|get") return Promise.reject(new Error("failed to parse practice-hub.json"));
        if (cmd === "plugin:store|set") return Promise.resolve(null);
        if (cmd === "plugin:store|save") return Promise.resolve(null);
        if (cmd === "plugin:event|listen") return Promise.resolve(1);
        if (cmd === "plugin:event|unlisten") return Promise.resolve(null);
        return Promise.resolve(null);
      },
      transformCallback: function () {
        return Math.random();
      },
    } as unknown as typeof window.__TAURI_INTERNALS__;
  });

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
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) })
  );
  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) })
  );
  await page.route("**/exercise/user-catalog", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
  );

  await page.goto("/");
});

test("a failed OpenAI key lookup surfaces an error instead of silently treating it as 'no key configured'", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  await page.locator(".item-group", { hasText: "Project" }).locator(".item-group-header").click();
  await page.locator(".item-card", { hasText: "Nutshell" }).locator(".btn-chat").click();

  await expect(page.locator(".error-modal")).toBeVisible();
  await expect(page.getByText(/failed to parse practice-hub\.json/i)).toBeVisible();
});
