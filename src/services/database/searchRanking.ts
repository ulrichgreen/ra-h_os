import type { Node } from '@/types/database';

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getQueryTerms(query: string): string[] {
  return normalizeSearchText(query).split(' ').filter(term => term.length > 0);
}

function countOccurrences(text: string, term: string): number {
  if (!text || !term) return 0;
  const matches = text.match(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'));
  return matches ? matches.length : 0;
}

function orderedTermMatches(text: string, terms: string[]): boolean {
  let position = 0;
  for (const term of terms) {
    const index = text.indexOf(term, position);
    if (index === -1) return false;
    position = index + term.length;
  }
  return terms.length > 0;
}

export function scoreNodeSearchMatch(node: Pick<Node, 'title' | 'description' | 'source' | 'updated_at'>, query: string): number {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTitle = normalizeSearchText(node.title || '');
  const normalizedDescription = normalizeSearchText(node.description || '');
  const normalizedSource = normalizeSearchText(node.source || '');
  const terms = getQueryTerms(query);

  let score = 0;

  if (normalizedTitle === normalizedQuery) score += 2000;
  if (normalizedTitle.startsWith(normalizedQuery)) score += 1200;
  if (normalizedTitle.includes(normalizedQuery)) score += 700;
  if (orderedTermMatches(normalizedTitle, terms)) score += 500;
  if (terms.length > 0 && terms.every(term => normalizedTitle.includes(term))) score += 350;

  if (normalizedDescription.includes(normalizedQuery)) score += 180;
  if (orderedTermMatches(normalizedDescription, terms)) score += 120;
  if (normalizedSource.includes(normalizedQuery)) score += 90;

  for (const term of terms) {
    score += countOccurrences(normalizedTitle, term) * 40;
    score += countOccurrences(normalizedDescription, term) * 8;
    score += countOccurrences(normalizedSource, term) * 3;
  }

  if (node.updated_at) {
    score += new Date(node.updated_at).getTime() / 1e13;
  }

  return score;
}
