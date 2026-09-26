export function errorTagsOf(input: { code: string; category: string | null }[]): string[] {
  return [...new Set(input.map((x) => x.category).filter((c): c is string => Boolean(c)))];
}
