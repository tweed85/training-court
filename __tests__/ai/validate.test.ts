import type { DeckbuilderCatalogCard } from '../../lib/server/ptcg-card-catalog';
import type { AnalysisContext } from '../../lib/server/ai/battle-log-analysis/build-context';
import type { BattleLogAnalysis } from '../../lib/server/ai/battle-log-analysis/schema';
import { validateAnalysis } from '../../lib/server/ai/battle-log-analysis/validate';
import { buildCardIndex } from '../../lib/server/ai/battle-log-analysis/card-index';

const card = (name: string): DeckbuilderCatalogCard => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  localId: '1',
  name,
  category: 'Trainer',
  metadata: { cardText: [], weakness: [], resistance: [], retreatCost: [], rulebox: [] },
});

const CATALOG = [
  card("Boss's Orders"),
  card('Iono'),
  card('Nest Ball'),
  card('Earthen Vessel'),
  // In the catalog but NOT in the player's deck or hand.
  card('Fezandipiti ex'),
  card('Dusknoir'),
  // Sits within edit distance 2 of "Pidgey", which is NOT in the catalog. The
  // fuzzy matcher will happily turn one into the other.
  card('Pidgeot'),
];

const context = (overrides: Partial<AnalysisContext> = {}): AnalysisContext => ({
  userPrompt: '',
  allowedCards: buildCardIndex(CATALOG),
  userAccessibleCards: new Set(["boss's orders", 'iono', 'nest ball', 'earthen vessel', 'pidgeot']),
  decklistCards: new Set(["boss's orders", 'iono', 'nest ball', 'earthen vessel', 'pidgeot']),
  grounding: {
    level: 'full',
    language: 'en',
    hasDecklist: true,
    turnsTotal: 20,
    turnsCompacted: 0,
    logCardsResolved: 6,
    approxChars: 100,
  },
  ...overrides,
});

const analysis = (overrides: Partial<BattleLogAnalysis> = {}): BattleLogAnalysis => ({
  matchSummary: {
    headline: 'Lost the prize race after an early Iono.',
    narrative: 'A narrative.',
    result: 'loss',
    turnOrder: 'first',
    decidingFactor: 'prize_race',
    confidence: 'medium',
  },
  turningPoints: [],
  tacticalSuggestions: [],
  deckSuggestions: [],
  notEnoughInformation: false,
  ...overrides,
});

const tactical = (cardsInvolved: string[], turnNumber = 7) => ({
  turnNumber,
  actualPlay: 'Played Iono.',
  suggestedPlay: 'Take the knockout instead.',
  cardsInvolved,
  requiresSearchOrDraw: false,
  rationale: 'Because.',
  expectedImpact: 'major' as const,
  confidence: 'high' as const,
});

describe('validateAnalysis — tactical suggestions', () => {
  it('keeps a suggestion whose cards the player demonstrably had', () => {
    const result = validateAnalysis(
      analysis({ tacticalSuggestions: [tactical(["Boss's Orders"])] }),
      context(),
      20
    );

    expect(result.analysis.tacticalSuggestions).toHaveLength(1);
    expect(result.analysis.tacticalSuggestions[0].cardsInvolved).toEqual(["Boss's Orders"]);
  });

  it('drops the whole suggestion when it names a card outside the catalog', () => {
    const result = validateAnalysis(
      analysis({ tacticalSuggestions: [tactical(['Totally Invented Card'])] }),
      context(),
      20
    );

    expect(result.analysis.tacticalSuggestions).toHaveLength(0);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'suggestion_dropped' })
    );
  });

  // The most important rule: real card, but not one this player could play.
  it('drops the whole suggestion when the card is real but was never available', () => {
    const result = validateAnalysis(
      analysis({ tacticalSuggestions: [tactical(['Fezandipiti ex'])] }),
      context(),
      20
    );

    expect(result.analysis.tacticalSuggestions).toHaveLength(0);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'card_not_available_to_player', name: 'Fezandipiti ex' })
    );
  });

  it('corrects casing and apostrophes to the canonical printed name', () => {
    const result = validateAnalysis(
      analysis({ tacticalSuggestions: [tactical(['boss’s orders'])] }),
      context(),
      20
    );

    expect(result.analysis.tacticalSuggestions[0].cardsInvolved).toEqual(["Boss's Orders"]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'card_corrected', to: "Boss's Orders" })
    );
  });

  /**
   * The bounds on findNearestCardName are not tight enough to keep one real
   * card from becoming another — "Pidgey" is two edits from "Pidgeot". Letting
   * that through here would hand the player advice about a card the model never
   * named, wearing the validator's stamp of approval.
   */
  it('drops a suggestion rather than fuzzy-correcting the card it names', () => {
    const result = validateAnalysis(
      analysis({ tacticalSuggestions: [tactical(['Pidgey'])] }),
      context(),
      20
    );

    expect(result.analysis.tacticalSuggestions).toHaveLength(0);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'card_not_in_catalog', name: 'Pidgey' })
    );
    expect(result.warnings).not.toContainEqual(
      expect.objectContaining({ code: 'card_corrected', to: 'Pidgeot' })
    );
  });

  it('drops a suggestion citing a turn that does not exist', () => {
    const result = validateAnalysis(
      analysis({ tacticalSuggestions: [tactical(["Boss's Orders"], 99)] }),
      context(),
      20
    );

    expect(result.analysis.tacticalSuggestions).toHaveLength(0);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'turn_out_of_range', turnNumber: 99 })
    );
  });
});

describe('validateAnalysis — turning points', () => {
  it('keeps the turning point but drops an unresolvable card name', () => {
    const result = validateAnalysis(
      analysis({
        turningPoints: [
          {
            turnNumber: 7,
            turnLabel: "Ash's Turn",
            whatHappened: 'Something.',
            whyItMattered: 'Because.',
            swing: 'favor_opponent',
            cardsInvolved: ['Iono', 'Totally Invented Card'],
          },
        ],
      }),
      context(),
      20
    );

    expect(result.analysis.turningPoints).toHaveLength(1);
    expect(result.analysis.turningPoints[0].cardsInvolved).toEqual(['Iono']);
  });

  // The other half of the asymmetry: descriptive text keeps the repair, because
  // the reader can check the name against the log printed beside it.
  it('fuzzy-corrects a near-miss card name', () => {
    const result = validateAnalysis(
      analysis({
        turningPoints: [
          {
            turnNumber: 7,
            turnLabel: "Ash's Turn",
            whatHappened: 'Something.',
            whyItMattered: 'Because.',
            swing: 'favor_opponent',
            cardsInvolved: ['Pidgey'],
          },
        ],
      }),
      context(),
      20
    );

    expect(result.analysis.turningPoints[0].cardsInvolved).toEqual(['Pidgeot']);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'card_corrected', from: 'Pidgey', to: 'Pidgeot' })
    );
  });

  it('never rewrites prose', () => {
    const narrative = 'You played Totally Invented Card on turn three.';
    const result = validateAnalysis(
      analysis({ matchSummary: { ...analysis().matchSummary, narrative } }),
      context(),
      20
    );

    expect(result.analysis.matchSummary.narrative).toBe(narrative);
  });
});

describe('validateAnalysis — deck suggestions', () => {
  const swap = (cardsIn: string[], cardsOut: string[]) => ({
    kind: 'swap' as const,
    cardsIn: cardsIn.map((name) => ({ name, count: 1 })),
    cardsOut: cardsOut.map((name) => ({ name, count: 1 })),
    rationale: 'Evidence from this match.',
    confidence: 'medium' as const,
  });

  it('keeps a swap whose cut card is genuinely in the decklist', () => {
    const result = validateAnalysis(
      analysis({ deckSuggestions: [swap(['Dusknoir'], ['Nest Ball'])] }),
      context(),
      20
    );

    expect(result.analysis.deckSuggestions).toHaveLength(1);
  });

  it('drops a swap whose cut card is not in the decklist', () => {
    const result = validateAnalysis(
      analysis({ deckSuggestions: [swap(['Dusknoir'], ['Fezandipiti ex'])] }),
      context(),
      20
    );

    expect(result.analysis.deckSuggestions).toHaveLength(0);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'card_not_in_decklist', name: 'Fezandipiti ex' })
    );
  });

  it('drops a swap rather than fuzzy-correcting the card it cuts', () => {
    const result = validateAnalysis(
      analysis({ deckSuggestions: [swap(['Dusknoir'], ['Pidgey'])] }),
      context(),
      20
    );

    expect(result.analysis.deckSuggestions).toHaveLength(0);
    expect(result.warnings).not.toContainEqual(
      expect.objectContaining({ code: 'card_corrected', to: 'Pidgeot' })
    );
  });

  it('drops an added card rather than fuzzy-correcting it', () => {
    const result = validateAnalysis(
      analysis({ deckSuggestions: [swap(['Pidgey'], ['Nest Ball'])] }),
      context(),
      20
    );

    expect(result.analysis.deckSuggestions[0]?.cardsIn ?? []).toHaveLength(0);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'card_not_in_catalog', name: 'Pidgey' })
    );
  });

  it('suppresses all deck suggestions when no decklist is linked', () => {
    const result = validateAnalysis(
      analysis({ deckSuggestions: [swap(['Dusknoir'], ['Nest Ball'])] }),
      context({ decklistCards: new Set() }),
      20
    );

    expect(result.analysis.deckSuggestions).toHaveLength(0);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'deck_suggestions_suppressed' })
    );
  });
});

describe('validateAnalysis — grounding', () => {
  it('flags low grounding when most named cards cannot be resolved', () => {
    const result = validateAnalysis(
      analysis({
        turningPoints: [
          {
            turnNumber: 1,
            turnLabel: 'T1',
            whatHappened: 'x',
            whyItMattered: 'y',
            swing: 'neutral',
            cardsInvolved: ['Made Up One', 'Made Up Two', 'Made Up Three', 'Iono'],
          },
        ],
      }),
      context(),
      20
    );

    expect(result.warnings).toContainEqual({ code: 'low_grounding' });
  });

  it('does not flag low grounding on a clean response', () => {
    const result = validateAnalysis(
      analysis({ tacticalSuggestions: [tactical(["Boss's Orders", 'Iono'])] }),
      context(),
      20
    );

    expect(result.warnings).not.toContainEqual({ code: 'low_grounding' });
  });
});
