export function parseBool(val?: string): boolean {
  return val === 'true';
}

export function parseNumber(val?: string): number | undefined {
  if (val === undefined) return undefined;
  const n = Number(val);
  return Number.isNaN(n) ? undefined : n;
}
