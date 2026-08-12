/**
 * HTML number-like inputs still expose strings and Number() accepts values such as whitespace or exponents.
 * API integer fields use this stricter parser so invalid input is never replaced with a hidden default.
 */
export function parseBoundedInteger(value: string, min: number, max: number): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}
