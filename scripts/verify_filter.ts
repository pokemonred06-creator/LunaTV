import { converter, isBlocked } from '../src/lib/yellow-filter';

function testFilter(queryOrTitle: string, type: 'query' | 'result') {
  const converted = converter(queryOrTitle);
  const hit = isBlocked(queryOrTitle);

  console.log(`Testing [${type}]: "${queryOrTitle}"`);
  console.log(`  -> Converted: "${converted}"`);
  if (hit) {
    console.log(`  -> 🔴 BLOCKED`);
    return true;
  } else {
    console.log(`  -> 🟢 PASSED`);
    return false;
  }
}

console.log('\n--- Running Tests ---');

const cases = [
  { text: '电影解说', type: 'query', expected: true },
  { text: '阿凡达 电影解说', type: 'result', expected: true },
  { text: 'Ordinary Movie', type: 'result', expected: false },
  { text: '電影解說', type: 'query', expected: true },
  { text: 'Some 18禁 Content', type: 'result', expected: true },
  { text: '極品', type: 'query', expected: false },
  { text: '极品', type: 'query', expected: false },
  { text: '極品影視', type: 'result', expected: false },
  { text: '口交', type: 'query', expected: true },
  { text: '口交video', type: 'result', expected: true },
];

let failCount = 0;

for (const c of cases) {
  const hit = testFilter(c.text, c.type as 'query' | 'result');
  if (hit !== c.expected) {
    console.log(`   ❌ FAILED: Expected ${c.expected}, got ${hit}`);
    failCount++;
  }
}

console.log('\n--- Summary ---');
if (failCount === 0) {
  console.log('✅ All tests passed. Filter logic is CORRECT.');
  process.exit(0);
} else {
  console.log(`❌ ${failCount} tests failed. Logic is BROKEN.`);
  process.exit(1);
}
