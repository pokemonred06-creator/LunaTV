import { test } from '@playwright/test';

test('verify adult content filter', async ({ page }) => {
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
  await page.fill('input[type="search"]', '情色');
  await page.press('input[type="search"]', 'Enter');

  await page.waitForTimeout(2000);

  // Check results
  const resultCards = page.locator('.video-card');
  // Note: Class might differ, assuming generic card selector or checking "No results" text
  const noResults = (await page.textContent('body')) || '';
  if (!noResults.includes('暂无相关内容') && (await resultCards.count()) > 0) {
    // If we have results, verify they don't contain the keyword in title?
    // Actually we expect 0 results if filter works perfectly on this keyword
    // But strictly speaking, if there are safe movies with this title (unlikely), they might show.
    // But for '情色', it should be blocked.
    console.log(
      `WARNING: Search for '情色' returned ${await resultCards.count()} results.`,
    );
  } else {
    console.log('PASS: Search for "情色" returned no results or "No content".');
  }

  // 4. Test "色戒" (specific movie)
  await page.fill('input[type="search"]', '色戒');
  await page.press('input[type="search"]', 'Enter');
  await page.waitForTimeout(2000);

  // Should be filtered
  const seJieResults = await page.locator('text=色戒');
  if ((await seJieResults.count()) > 0 && (await seJieResults.isVisible())) {
    throw new Error('FAIL: "色戒" is visible in search results!');
  } else {
    console.log('PASS: "色戒" is filtered from search results.');
  }
});
