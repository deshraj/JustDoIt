import { API_BASE_URL, expect, test, waitForApiReady } from './fixtures';

test.beforeAll(async () => {
  await waitForApiReady(API_BASE_URL);
});

test('quick-add creates a task, then it drags from the board into Done and persists', async ({
  page,
}) => {
  // 1) Open the list view.
  await page.goto('/tasks');

  // 2) Quick-add a natural-language task.
  const quickAdd = page.getByLabel('Quick add a task');
  await quickAdd.click();
  await quickAdd.fill('ship the e2e test tomorrow #dev p1');
  await quickAdd.press('Enter');

  // 3) It appears as a row with the parsed title (the #tag/priority/date
  // tokens are stripped from the title by the API's quick-add parser).
  const row = page.locator('[data-testid^="task-row-"]').filter({ hasText: 'ship the e2e test' });
  await expect(row).toBeVisible();
  const rowTestId = await row.getAttribute('data-testid');
  const taskId = rowTestId!.replace('task-row-', '');

  // 4) Navigate to the board.
  await page.goto('/board');
  const card = page.getByTestId(`task-card-${taskId}`);
  await expect(card).toBeVisible();

  const doneColumn = page.getByTestId('board-column-done');

  // 5) Drag the card into the Done column (real pointer drag via CDP-level
  // mouse events — much more reliable than DOM-level synthetic drag).
  // dnd-kit's PointerSensor needs several intermediate pointermove events
  // (past its 8px activation distance) to register the drag and re-run
  // collision detection, so step the movement gradually rather than jumping.
  const cardBox = (await card.boundingBox())!;
  const doneBox = (await doneColumn.boundingBox())!;
  expect(cardBox).not.toBeNull();
  expect(doneBox).not.toBeNull();

  const start = { x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 };
  const end = { x: doneBox.x + doneBox.width / 2, y: doneBox.y + doneBox.height / 2 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.waitForTimeout(100);
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      start.x + ((end.x - start.x) * i) / steps,
      start.y + ((end.y - start.y) * i) / steps,
    );
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();

  const movedByPointer = await doneColumn
    .getByTestId(`task-card-${taskId}`)
    .isVisible()
    .catch(() => false);

  if (!movedByPointer) {
    // Fallback: dnd-kit's KeyboardSensor. Space picks the card up, arrow
    // keys move it (including across columns, since collision detection
    // runs against the virtual drag position), Space drops — used only if
    // the pointer drag above didn't land, per the plan's documented fallback.
    await card.first().focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    for (let i = 0; i < 5; i++) {
      const landed = await doneColumn
        .getByTestId(`task-card-${taskId}`)
        .isVisible()
        .catch(() => false);
      if (landed) break;
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
    }
    await page.keyboard.press('Space');
  }

  // 6) Assert it now lives in the Done column.
  await expect(doneColumn.getByTestId(`task-card-${taskId}`)).toBeVisible();

  // 7) Reload — persistence proves the REST write, not just optimistic UI.
  await page.reload();
  await expect(
    page.getByTestId('board-column-done').getByTestId(`task-card-${taskId}`),
  ).toBeVisible();
});
