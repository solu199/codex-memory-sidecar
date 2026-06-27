export interface SearchSurfaceSignals {
  phrase: number;
  proximity: number;
  typo: number;
  total: number;
  exactTermCount: number;
  fuzzyTermCount: number;
}

export function buildSearchSurfaceSignals(query: string, text: string): SearchSurfaceSignals {
  const normalizedQuery = normalizeSearchSurfaceText(query);
  const normalizedText = normalizeSearchSurfaceText(text);
  const queryTerms = tokenizeSearchSurface(normalizedQuery);
  const textTerms = tokenizeSearchSurface(normalizedText);
  const phrase = normalizedQuery && normalizedText.includes(normalizedQuery) ? 1 : 0;
  const proximity = computeProximityScore(queryTerms, normalizedText);
  const typoResult = computeTypoScore(queryTerms, textTerms);
  const total = clamp01(phrase * 0.48 + proximity * 0.32 + typoResult.score * 0.2);
  return {
    phrase,
    proximity,
    typo: typoResult.score,
    total,
    exactTermCount: typoResult.exactTermCount,
    fuzzyTermCount: typoResult.fuzzyTermCount,
  };
}

export function hasTypoRecoverySignal(signals: SearchSurfaceSignals): boolean {
  return signals.fuzzyTermCount > 0 && signals.typo >= 0.55;
}

export function hasTypoCandidateTerms(query: string): boolean {
  return tokenizeSearchSurface(normalizeSearchSurfaceText(query)).some(isTypoCandidateTerm);
}

function computeProximityScore(queryTerms: string[], normalizedText: string): number {
  if (!queryTerms.length) {
    return 0;
  }
  const orderedPositions = findOrderedTermPositions(queryTerms, normalizedText);
  if (!orderedPositions) {
    return 0;
  }
  const first = orderedPositions[0] ?? 0;
  const lastTerm = queryTerms[queryTerms.length - 1] ?? "";
  const last = (orderedPositions[orderedPositions.length - 1] ?? first) + lastTerm.length;
  const span = Math.max(1, last - first);
  const compactSpan = Math.max(queryTerms.join(" ").length, 1);
  return clamp01(compactSpan / span);
}

function computeTypoScore(queryTerms: string[], textTerms: string[]) {
  const typoTerms = queryTerms.filter(isTypoCandidateTerm);
  if (!typoTerms.length || !textTerms.length) {
    return {
      score: 0,
      exactTermCount: 0,
      fuzzyTermCount: 0,
    };
  }

  let similaritySum = 0;
  let exactTermCount = 0;
  let fuzzyTermCount = 0;

  for (const queryTerm of typoTerms) {
    if (textTerms.includes(queryTerm)) {
      similaritySum += 1;
      exactTermCount += 1;
      continue;
    }

    let bestSimilarity = 0;
    for (const textTerm of textTerms) {
      if (!isComparableTypoToken(queryTerm, textTerm)) {
        continue;
      }
      bestSimilarity = Math.max(bestSimilarity, typoSimilarity(queryTerm, textTerm));
    }

    if (bestSimilarity >= 0.72) {
      similaritySum += bestSimilarity;
      fuzzyTermCount += 1;
    }
  }

  if (!fuzzyTermCount) {
    return {
      score: 0,
      exactTermCount,
      fuzzyTermCount,
    };
  }

  return {
    score: similaritySum / typoTerms.length,
    exactTermCount,
    fuzzyTermCount,
  };
}

function findOrderedTermPositions(queryTerms: string[], normalizedText: string): number[] | null {
  const positions: number[] = [];
  let fromIndex = 0;

  for (const queryTerm of queryTerms) {
    const index = normalizedText.indexOf(queryTerm, fromIndex);
    if (index < 0) {
      return null;
    }
    positions.push(index);
    fromIndex = index + queryTerm.length;
  }

  return positions;
}

function normalizeSearchSurfaceText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenizeSearchSurface(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

function isTypoCandidateTerm(term: string): boolean {
  return term.length >= 4 && /[a-z0-9]/i.test(term);
}

function isComparableTypoToken(left: string, right: string): boolean {
  return Math.abs(left.length - right.length) <= 2 && left[0] === right[0];
}

function typoSimilarity(left: string, right: string): number {
  const editSimilarity =
    1 - damerauLevenshteinDistance(left, right) / Math.max(left.length, right.length, 1);
  const trigramSimilarity = diceCoefficient(trigrams(left), trigrams(right));
  return Math.max(editSimilarity, trigramSimilarity);
}

function damerauLevenshteinDistance(source: string, target: string): number {
  const rows = source.length + 1;
  const cols = target.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row]![0] = row;
  }
  for (let col = 0; col < cols; col += 1) {
    matrix[0]![col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = source[row - 1] === target[col - 1] ? 0 : 1;
      let value = Math.min(
        matrix[row - 1]![col]! + 1,
        matrix[row]![col - 1]! + 1,
        matrix[row - 1]![col - 1]! + cost,
      );

      if (
        row > 1 &&
        col > 1 &&
        source[row - 1] === target[col - 2] &&
        source[row - 2] === target[col - 1]
      ) {
        value = Math.min(value, matrix[row - 2]![col - 2]! + cost);
      }

      matrix[row]![col] = value;
    }
  }

  return matrix[rows - 1]![cols - 1]!;
}

function trigrams(value: string): string[] {
  if (value.length < 3) {
    return [value];
  }

  const items: string[] = [];
  for (let index = 0; index <= value.length - 3; index += 1) {
    items.push(value.slice(index, index + 3));
  }
  return items;
}

function diceCoefficient(left: string[], right: string[]): number {
  if (!left.length || !right.length) {
    return 0;
  }

  const rightCounts = new Map<string, number>();
  for (const item of right) {
    rightCounts.set(item, (rightCounts.get(item) ?? 0) + 1);
  }

  let overlap = 0;
  for (const item of left) {
    const remaining = rightCounts.get(item) ?? 0;
    if (remaining > 0) {
      overlap += 1;
      rightCounts.set(item, remaining - 1);
    }
  }

  return (2 * overlap) / (left.length + right.length);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
