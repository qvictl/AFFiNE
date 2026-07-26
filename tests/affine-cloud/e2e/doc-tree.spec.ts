import { test } from '@affine-test/kit/playwright';
import {
  createRandomUser,
  deleteUser,
  enableCloudWorkspace,
  loginUser,
} from '@affine-test/kit/utils/cloud';
import { waitForEditorLoad } from '@affine-test/kit/utils/page-logic';
import { createLocalWorkspace } from '@affine-test/kit/utils/workspace';
import { expect, type Page } from '@playwright/test';

let user: {
  id: string;
  name: string;
  email: string;
  password: string;
};

test.beforeEach(async ({ page }) => {
  user = await createRandomUser();
  await loginUser(page, user);
});

test.afterEach(async () => {
  await deleteUser(user.email);
});

const dumpTree = async (page: Page) => {
  return page.evaluate(() => {
    const section = document.querySelector(
      '[data-testid="navigation-panel-doc-tree"]'
    );
    if (!section) return [];
    const links = [...section.querySelectorAll('a')];
    return links.map(a => {
      let depth = -1;
      let el: HTMLElement | null = a.parentElement;
      while (el && el !== section) {
        if (el.dataset.testid?.startsWith('navigation-panel-doc-tree-')) {
          depth++;
        }
        el = el.parentElement;
      }
      return { href: a.getAttribute('href'), depth };
    });
  });
};

const setupCloudWorkspace = async (page: Page) => {
  await page.reload();
  await waitForEditorLoad(page);
  await createLocalWorkspace({ name: 'tree-test' }, page);
  await enableCloudWorkspace(page);
  await waitForEditorLoad(page);

  const section = page.getByTestId('navigation-panel-doc-tree');
  await expect(section).toBeVisible({ timeout: 15000 });
  if ((await section.locator('a').count()) === 0) {
    await section.getByRole('switch').click();
    await page.waitForTimeout(500);
  }
  return section;
};

test('clicking + twice creates two root docs, both stay root after reload', async ({
  page,
}) => {
  await setupCloudWorkspace(page);
  const before = (await dumpTree(page)).length;

  // first doc
  await page.getByTestId('navigation-panel-doc-tree-add-button').click();
  await page.waitForTimeout(2000);
  // the new doc is now OPEN in the editor; click + again with it open
  await page.getByTestId('navigation-panel-doc-tree-add-button').click();
  await page.waitForTimeout(2000);

  const tree = await dumpTree(page);
  console.log('TREE AFTER 2 CLICKS:', JSON.stringify(tree));
  expect(tree.length, 'two docs created').toBe(before + 2);
  const roots = tree.filter(n => n.depth === 0);
  expect(roots.length, 'all docs are root nodes').toBe(tree.length);

  await page.reload();
  await waitForEditorLoad(page);
  await page.waitForTimeout(3000);
  const tree2 = await dumpTree(page);
  expect(tree2.length).toBe(before + 2);
  expect(tree2.filter(n => n.depth === 0).length).toBe(tree2.length);
});
