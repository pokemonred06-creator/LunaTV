import * as OpenCC from 'opencc-js';

import { yellowWords } from './yellow';

export const converter = OpenCC.Converter({ from: 'hk', to: 'cn' });

/**
 * Normalizes a string by converting to lowercase and stripping
 * non-alphanumeric/non-Chinese characters.
 */
export const normalize = (s: string): string =>
  (s || '').toLowerCase().replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, '');

const NORMALIZED_BLOCKLIST = yellowWords
  .map((w) => normalize(String(w)))
  .filter((w) => w.length > 0);

/**
 * Checks if a string (query, title, or category) contains any blocked keywords.
 * Automatically handles Traditional-to-Simplified Chinese conversion before checking.
 */
export const isBlocked = (text: string): boolean => {
  if (!text) return false;
  // Convert Traditional to Simplified first for maximum coverage
  const converted = converter(text);
  const normalized = normalize(converted);

  return NORMALIZED_BLOCKLIST.some((word) => normalized.includes(word));
};

/**
 * Helper to check if a search item should be filtered out.
 */
export const shouldFilterItem = (item: {
  title?: string;
  name?: string;
  type_name?: string;
}): boolean => {
  const contentToSearch = [item.title, item.name, item.type_name].filter(
    Boolean,
  ) as string[];

  return contentToSearch.some(isBlocked);
};
