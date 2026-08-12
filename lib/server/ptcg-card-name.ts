/**
 * Canonical Pokemon TCG card-name handling.
 *
 * Shared by the decklist importer (app/api/ptcg/cards/import) and the AI match
 * analysis validator (lib/server/ai/battle-log-analysis). Both need to answer
 * "is this string the name of a real card?" the exact same way — if the two
 * diverge, the validator starts reporting real cards as hallucinations.
 */

/**
 * Fold a printed card name into a comparison key: case, accents, curly
 * apostrophes, Prism Star notation, and the `-GX`/`-ex`/`-V` hyphen variants
 * that PTCGL and third-party exports disagree about.
 */
export const normalizeCardName = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, "'")
    .replace(/\s+prism star\b/g, ' {*} ')
    .replace(/\bprism star\b/g, '{*}')
    .replace(/\s*-\s*(gx|ex|v|vmax|vstar)\b/g, ' $1')
    .replace(/\s+/g, ' ');

/** Strip leading zeros from a collector number, keeping any letter suffix. */
export const normalizeCardNumber = (value: string): string => {
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/^0*(\d+)([a-z]*)$/);
  return match ? `${match[1]}${match[2]}` : trimmed;
};

/** The catalog source serves HTML-escaped names; card text does too. */
export const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
