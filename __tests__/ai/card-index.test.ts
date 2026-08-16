import type { DeckbuilderCatalogCard } from '../../lib/server/ptcg-card-catalog';
import {
  buildCardIndex,
  extractCardNamesFromLog,
  findNearestCardName,
} from '../../lib/server/ai/battle-log-analysis/card-index';
import { battleLogNewStructure } from '../../components/battle-logs/utils/testing-files/battleLogNewStructure';
import { battleLogGerman } from '../../components/battle-logs/utils/testing-files/battleLogGerman';

const card = (
  name: string,
  overrides: Partial<DeckbuilderCatalogCard['metadata']> = {}
): DeckbuilderCatalogCard => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  localId: '1',
  name,
  category: 'Trainer',
  metadata: {
    cardText: [],
    weakness: [],
    resistance: [],
    retreatCost: [],
    rulebox: [],
    ...overrides,
  },
});

// Names drawn from the real English fixture, plus decoys for the false-positive tests.
const CATALOG = [
  card('Superior Energy Retrieval'),
  card('Earthen Vessel'),
  card('Arven'),
  card("Professor Turo's Scenario"),
  card('Fighting Gong'),
  card('Solrock'),
  card('Lunatone'),
  card('Gimmighoul'),
  card('Buddy-Buddy Poffin'),
  card('Basic Fighting Energy'),
  card("Lana's Aid"),
  card('Premium Power Pro'),
  card('Pidgey'),
  card('Switch'),
  card('Turn'),
  card('Reshiram & Charizard-GX'),
  card('Reshiram'),
  card('Charizard'),
];

describe('buildCardIndex', () => {
  it('keys cards by normalized name', () => {
    const index = buildCardIndex(CATALOG);
    expect(index.get('earthen vessel')?.name).toBe('Earthen Vessel');
    expect(index.get("professor turo's scenario")?.name).toBe("Professor Turo's Scenario");
  });

  it('prefers the most recently released printing of a duplicated name', () => {
    const index = buildCardIndex([
      card('Nest Ball', { setReleaseDate: '2022-01-01', setCode: 'OLD' }),
      card('Nest Ball', { setReleaseDate: '2024-06-01', setCode: 'NEW' }),
    ]);

    expect(index.get('nest ball')?.metadata.setCode).toBe('NEW');
  });
});

describe('extractCardNamesFromLog', () => {
  const index = buildCardIndex(CATALOG);

  it('resolves cards named in the real English fixture', () => {
    const { resolved } = extractCardNamesFromLog(battleLogNewStructure, index);
    const names = Array.from(resolved.values()).map((c) => c.name);

    expect(names).toEqual(expect.arrayContaining([
      'Earthen Vessel',
      'Fighting Gong',
      'Solrock',
      'Lunatone',
      'Buddy-Buddy Poffin',
      'Basic Fighting Energy',
    ]));
  });

  it('resolves comma-separated cards on detail lines', () => {
    const { resolved } = extractCardNamesFromLog(
      '- Fighting Gong, Premium Power Pro, Gimmighoul',
      index
    );

    expect(Array.from(resolved.values()).map((c) => c.name).sort()).toEqual([
      'Fighting Gong',
      'Gimmighoul',
      'Premium Power Pro',
    ]);
  });

  it('matches the longest name rather than its constituent parts', () => {
    const { resolved } = extractCardNamesFromLog('Ash played Reshiram & Charizard-GX.', index);
    const names = Array.from(resolved.values()).map((c) => c.name);

    expect(names).toContain('Reshiram & Charizard-GX');
    expect(names).not.toContain('Reshiram');
    expect(names).not.toContain('Charizard');
  });

  it('does not resolve lowercase filler that shares a card name', () => {
    const { resolved } = extractCardNamesFromLog(
      'Bassoonboy135 ended their turn.\nPlayer2 chose to switch their active.',
      index
    );

    expect(Array.from(resolved.keys())).not.toContain('turn');
    expect(Array.from(resolved.keys())).not.toContain('switch');
  });

  it('does not mistake a capitalized turn header for a card', () => {
    const { resolved } = extractCardNamesFromLog("Bassoonboy135's Turn\nSetup", index);
    expect(Array.from(resolved.keys())).not.toContain('turn');
  });

  it('still resolves the capitalized card of the same name', () => {
    const { resolved } = extractCardNamesFromLog('Player2 played Switch.', index);
    expect(Array.from(resolved.values()).map((c) => c.name)).toContain('Switch');
  });

  it('resolves almost nothing from a non-English log, since the catalog is English', () => {
    const { resolved } = extractCardNamesFromLog(battleLogGerman, index);
    expect(resolved.size).toBeLessThan(3);
  });
});

describe('findNearestCardName', () => {
  const index = buildCardIndex(CATALOG);

  it('corrects a single-character typo on a long name', () => {
    expect(findNearestCardName('earthen vessl', index)?.name).toBe('Earthen Vessel');
  });

  it('refuses to guess on short names', () => {
    expect(findNearestCardName('arvn', index)).toBeNull();
  });

  it('returns null when nothing is close', () => {
    expect(findNearestCardName('completely unrelated card', index)).toBeNull();
  });

  /**
   * Pins the real bound, which is weaker than "never corrects one real card
   * into another": two real Pokemon that differ by two edits are indistinguish-
   * able to this function. Callers that present the result as advice must not
   * use it — see validate.ts, where only turningPoints does.
   */
  it('will correct one real card into a different real card', () => {
    const nearby = buildCardIndex([card('Pidgeot'), card('Rare Candy')]);
    expect(findNearestCardName('pidgey', nearby)?.name).toBe('Pidgeot');
  });
});
