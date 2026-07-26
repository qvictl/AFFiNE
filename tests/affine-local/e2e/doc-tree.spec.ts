import { test } from '@affine-test/kit/playwright';
import { openHomePage } from '@affine-test/kit/utils/load-page';
import { waitForEditorLoad } from '@affine-test/kit/utils/page-logic';
import { expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
});

test('click doc-tree section add button creates exactly one root doc', async ({
  page,
}) => {
  const section = page.getByTestId('navigation-panel-doc-tree');
  await expect(section).toBeVisible();

  // expand the section if collapsed
  const addButton = page.getByTestId('navigation-panel-doc-tree-add-button');
  await expect(addButton).toBeVisible();
  if ((await section.locator('a').count()) === 0) {
    await section.getByRole('switch').click();
    await page.waitForTimeout(500);
  }

  const treeDocs = section.locator('a');
  const before = await treeDocs.count();

  await addButton.click();
  await page.waitForTimeout(1000);

  const after = await treeDocs.count();
  expect(after, 'exactly one doc should be created').toBe(before + 1);

  // after reload, the tree should be unchanged (persistence check)
  await page.reload();
  await waitForEditorLoad(page);
  await page.waitForTimeout(1000);
  expect(await section.locator('a').count()).toBe(before + 1);
});
