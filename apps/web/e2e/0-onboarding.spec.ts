import { API_BASE_URL, expect, test, waitForApiReady } from './fixtures';

// Named `0-onboarding` (not `onboarding`) so it sorts — and therefore runs —
// before `critical-flow.spec.ts` under this project's single shared e2e DB
// (see playwright.config.ts: one `webServer` pair for the whole run, no
// per-file reset). First-run onboarding is only observable while the
// workspace still has zero tasks and zero projects, so this must be the
// first spec to touch the API.
test.beforeAll(async () => {
  await waitForApiReady(API_BASE_URL);
});

test('first run shows onboarding and quick-add creates the first task', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /welcome to justdoit/i })).toBeVisible();

  await page.getByRole('button', { name: /add your first task/i }).click();
  const quickAdd = page.getByLabel('Quick add a task');
  await expect(quickAdd).toBeFocused();
  await quickAdd.fill('Write the launch post tomorrow #launch p1');
  await quickAdd.press('Enter');

  // Onboarding → populated transition: the new task now renders as a row,
  // proving the workspace is no longer considered "empty". (Scoped to the
  // task-row link, not `getByText`, which also matches the success toast.)
  await expect(page.getByRole('link', { name: /write the launch post/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /welcome to justdoit/i })).not.toBeVisible();
});
