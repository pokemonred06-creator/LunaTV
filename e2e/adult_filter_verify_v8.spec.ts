import { expect, test } from '@playwright/test';

test('verify adult content filter', async ({ page }) => {
  // Set bypass header to simulate visitor mode in test env without password redirect
  await page.setExtraHTTPHeaders({
    'x-e2e-bypass': 'true',
  });

  const TEST_URL = process.env.TEST_URL || 'http://localhost:3000';
  // 1. Visit Home Page (Visitor Mode)
  await page.goto(TEST_URL);

  // 2. Check Movie Category Filter
  await page.click('text=电影');
  await page.waitForTimeout(1000);

  // Find the 'Type' filter section (usually the first row of filters or click "筛选" if mobile)
  // In PC view, filters are visible.
  // We check if '情色' is present in the text content of the page context, specifically in filter buttons.
  const content = await page.content();
  if (content.includes('情色')) {
    console.log(
      'WARNING: "情色" found in page content. Checking visibility...',
    );
    // It might be in the source code but hidden? Or present in a button?
    const eroticaOption = page.locator('button', { hasText: '情色' });
    if (
      (await eroticaOption.count()) > 0 &&
      (await eroticaOption.isVisible())
    ) {
      throw new Error('FAIL: "情色" category option is visible to visitor!');
    }
  } else {
    console.log('PASS: "情色" keyword not found in page content.');
  }

  // 3. Search Test
  await page.goto(TEST_URL + '/search');
  await page.fill('#searchInput', '情色');
  await page.press('#searchInput', 'Enter');

  await page.waitForTimeout(2000);

  await expect(page.getByText('搜索结果已隐藏')).toBeVisible();

  // 4. Test "色戒" (specific movie)
  await page.fill('#searchInput', '色戒');
  await page.press('#searchInput', 'Enter');
  await expect(page.getByText('搜索结果已隐藏')).toBeVisible();
});
