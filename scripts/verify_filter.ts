import * as OpenCC from 'opencc-js';

import { yellowWords } from '../src/lib/yellow';

// --- Replicate Logic from src/app/api/search/ws/route.ts ---

const normalize = (s: string) =>
  (s || '').toLowerCase().replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, '');

const NORMALIZED_BLOCKLIST = yellowWords
  .map((w) => normalize(String(w)))
  .filter((w) => w.length > 0);

const converter = OpenCC.Converter({ from: 'hk', to: 'cn' });

function testFilter(queryOrTitle: string, type: 'query' | 'result') {
  const converted = converter(queryOrTitle);
  const normalized = normalize(converted);

  // Check if it hits any blocklist word (substring match)
  const hit = NORMALIZED_BLOCKLIST.find((w) => normalized.includes(w));

  console.log(`Testing [${type}]: "${queryOrTitle}"`);
  console.log(`  -> Converted: "${converted}"`);
  console.log(`  -> Normalized: "${normalized}"`);
  if (hit) {
    console.log(`  -> 🔴 BLOCKED by keyword: "${hit}"`);
    return true;
  } else {
    console.log(`  -> 🟢 PASSED`);
    return false;
  }
}

// --- Test Cases ---

console.log('--- Loading Blocklist ---');
console.log(`Blocklist size: ${NORMALIZED_BLOCKLIST.length}`);
const target = normalize('电影解说');
console.log(
  `Does blocklist contain normalized '电影解说' (${target})? ${NORMALIZED_BLOCKLIST.includes(target)}`,
);

console.log('\n--- Running Tests ---');

const cases = [
  '电影解说', // Exact blocked term
  '阿凡达 电影解说', // Term included in title
  'Ordinary Movie', // Safe
  '電影解說', // Traditional Chinese
  'Some 18禁 Content', // Other blocked term
];

let failCount = 0;

// Test 1: Direct "电影解说" should be blocked
if (!testFilter('电影解说', 'query')) failCount++;

// Test 2: "阿凡达 电影解说" should be blocked
if (!testFilter('阿凡达 电影解说', 'result')) failCount++;

// Test 3: "Ordinary Movie" should pass
if (testFilter('Ordinary Movie', 'result')) failCount++;

// Test 4: "電影解說" (Traditional) should be blocked (via OpenCC or normalization)
if (!testFilter('電影解說', 'query')) failCount++;

console.log('\n--- Summary ---');
if (failCount === 0) {
  console.log('✅ All tests passed. Filter logic is CORRECT.');
  process.exit(0);
} else {
  console.log(`❌ ${failCount} tests failed. Logic is BROKEN.`);
  process.exit(1);
}
