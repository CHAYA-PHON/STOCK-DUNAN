export function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let j = 1; j <= n; j++) {
    for (let i = 1; i <= m; i++) {
      const substitutionCost = s1[i - 1].toLowerCase() === s2[j - 1].toLowerCase() ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // Deletion
        d[i][j - 1] + 1, // Insertion
        d[i - 1][j - 1] + substitutionCost // Substitution
      );
    }
  }

  return d[m][n];
}

export function fuzzySearch<T>(
  list: T[],
  query: string,
  keySelector: (item: T) => string,
  threshold: number = 3
): T[] {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return list;

  // Exact or prefix matches first
  const exactMatches = list.filter((item) => {
    const val = keySelector(item).toLowerCase();
    return val.includes(cleanQuery);
  });
  if (exactMatches.length > 0) return exactMatches;

  // Otherwise calculate Levenshtein distance
  const scored = list.map((item) => {
    const val = keySelector(item);
    const dist = levenshteinDistance(cleanQuery, val);
    return { item, dist };
  });

  // Sort by distance and filter those within the threshold
  return scored
    .filter((entry) => entry.dist <= Math.max(threshold, Math.ceil(keySelector(entry.item).length / 2)))
    .sort((a, b) => a.dist - b.dist)
    .map((entry) => entry.item);
}
