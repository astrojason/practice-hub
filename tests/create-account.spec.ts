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


test.beforeEach(async ({ page }) => {
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) }));
  await page.goto("/");
});

const ok = { idToken: "new-id-token", refreshToken: "new-refresh-token", localId: "uid-1", email: "new@example.com" };

test("the sign-in screen offers Google, email sign-in and creating an account", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create an account" })).toBeVisible();
});

test("a new account is created with an email and password, then the app opens", async ({ page }) => {
  let body: Record<string, unknown> | null = null;
  await page.route("**/accounts:signUp**", (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ok) });
  });
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.locator('input[aria-label="Email"]').fill("new@example.com");
  await page.locator('input[aria-label="Password"]').fill("secret123");
  await page.locator('input[aria-label="Confirm password"]').fill("secret123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toHaveCount(0);
  expect(body).toEqual({ email: "new@example.com", password: "secret123", returnSecureToken: true });
  expect(await page.evaluate(() => localStorage.getItem("ph:refreshToken"))).toBe("new-refresh-token");
});

test("mismatched passwords are caught before anything is sent", async ({ page }) => {
  let called = false;
  await page.route("**/accounts:signUp**", (route) => {
    called = true;
    return route.abort();
  });
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.locator('input[aria-label="Email"]').fill("new@example.com");
  await page.locator('input[aria-label="Password"]').fill("secret123");
  await page.locator('input[aria-label="Confirm password"]').fill("different1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator(".error-modal")).toContainText("don't match");
  expect(called).toBe(false);
});

test("an account that already exists says so in plain words, with the real error too", async ({ page }) => {
  await page.route("**/accounts:signUp**", (route) =>
    route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: 400, message: "EMAIL_EXISTS" } }) })
  );
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.locator('input[aria-label="Email"]').fill("new@example.com");
  await page.locator('input[aria-label="Password"]').fill("secret123");
  await page.locator('input[aria-label="Confirm password"]').fill("secret123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator(".error-modal")).toContainText("already exists");
  await expect(page.locator(".error-modal")).toContainText("EMAIL_EXISTS");
});

test("signing in with an email and password works, and a wrong password is explained", async ({ page }) => {
  let n = 0;
  await page.route("**/accounts:signInWithPassword**", (route) => {
    n++;
    if (n === 1) return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { message: "INVALID_LOGIN_CREDENTIALS" } }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ok) });
  });
  await page.getByRole("button", { name: "Sign in with email" }).click();
  await page.locator('input[aria-label="Email"]').fill("new@example.com");
  await page.locator('input[aria-label="Password"]').fill("wrongpass");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".error-modal")).toContainText("email or password is wrong");
  await page.locator(".error-modal button", { hasText: "Dismiss" }).click();
  await page.locator('input[aria-label="Password"]').fill("rightpass");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toHaveCount(0);
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
});
