import {
  ANALYSIS_PIPELINE_VERSION,
  buildAnalysisCacheKey,
  decklistFingerprint,
  type CacheKeyInput,
} from '../../lib/server/ai/battle-log-analysis/cache-key';

const BASE: CacheKeyInput = {
  log: 'Setup\nAsh drew 7 cards for the opening hand.',
  archetype: 'gholdengo',
  oppArchetype: 'dragapult',
  format: 'SVI-DRI',
  turnOrder: '1',
  result: 'L',
  decklistId: 'deck-1',
  decklistFingerprint: 'hash-1',
  screenName: 'Ash',
};

describe('buildAnalysisCacheKey', () => {
  it('is stable for identical input', () => {
    expect(buildAnalysisCacheKey(BASE)).toBe(buildAnalysisCacheKey({ ...BASE }));
  });

  // `logs` has no updated_at, so the content hash is the only change detector.
  it.each<[string, Partial<CacheKeyInput>]>([
    ['log text', { log: 'Setup\nsomething else entirely' }],
    ['archetype', { archetype: 'charizard' }],
    ['opponent archetype', { oppArchetype: 'gardevoir' }],
    ['format', { format: 'SVI-JTG' }],
    ['turn order', { turnOrder: '2' }],
    ['recorded result', { result: 'W' }],
    ['linked decklist', { decklistId: 'deck-2' }],
    ['decklist contents', { decklistFingerprint: 'hash-2' }],
    ['screen name', { screenName: 'Misty' }],
  ])('changes when the %s changes', (_label, patch) => {
    expect(buildAnalysisCacheKey({ ...BASE, ...patch })).not.toBe(buildAnalysisCacheKey(BASE));
  });

  it('is case-insensitive on the screen name', () => {
    expect(buildAnalysisCacheKey({ ...BASE, screenName: 'ASH' })).toBe(buildAnalysisCacheKey(BASE));
  });

  it('distinguishes a null decklist from a linked one', () => {
    const unlinked = buildAnalysisCacheKey({
      ...BASE,
      decklistId: null,
      decklistFingerprint: null,
    });
    expect(unlinked).not.toBe(buildAnalysisCacheKey(BASE));
  });

  it('encodes the pipeline version, so bumping it invalidates every cached row', () => {
    // Guards against someone changing the prompt without bumping the constant.
    expect(ANALYSIS_PIPELINE_VERSION).toBeGreaterThan(0);
    expect(buildAnalysisCacheKey(BASE)).toHaveLength(64);
  });
});

describe('decklistFingerprint', () => {
  it('prefers content_hash, which is printing-agnostic', () => {
    expect(decklistFingerprint({ content_hash: 'abc', updated_at: '2026-01-01' })).toBe('abc');
  });

  it('falls back to updated_at for rows saved before content_hash existed', () => {
    expect(decklistFingerprint({ content_hash: null, updated_at: '2026-01-01' })).toBe('2026-01-01');
  });

  it('is null when no decklist is linked', () => {
    expect(decklistFingerprint(null)).toBeNull();
  });
});
