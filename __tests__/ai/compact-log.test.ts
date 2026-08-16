import type { BattleLog, BattleLogTurn } from '../../components/battle-logs/utils/battle-log.types';
import {
  compactBattleLog,
  COMPACTION_BUDGET,
} from '../../lib/server/ai/battle-log-analysis/compact-log';
import { parseBattleLog } from '../../components/battle-logs/utils/battle-log.utils';
import { battleLogNewStructure } from '../../components/battle-logs/utils/testing-files/battleLogNewStructure';

const turn = (
  index: number,
  prizes: Record<string, number>,
  actionCount = 4
): BattleLogTurn => ({
  turnTitle: `Player${(index % 2) + 1}'s Turn`,
  body: '',
  player: `Player${(index % 2) + 1}`,
  prizesAfterTurn: prizes,
  actions: Array.from({ length: actionCount }, (_, i) => ({
    title: `Player${(index % 2) + 1} played Card ${i} on turn ${index}.`,
    details: [
      `- drew a long detail line number ${i} padded out to take up real space in the budget`,
      `- another detail ${i} that is also reasonably long so the turn is not tiny`,
      `- a third detail ${i}`,
      `- a fourth detail ${i}`,
      `- a fifth detail ${i} that should be dropped by the per-action cap`,
    ],
  })),
});

/** A long game where prizes only move at the very end. */
const syntheticLog = (turns: number): BattleLog => ({
  language: 'en',
  id: 'synthetic',
  players: [
    { name: 'Player1', deck: 'a', oppDeck: 'b', result: 'W' },
    { name: 'Player2', deck: 'b', oppDeck: 'a', result: 'L' },
  ],
  date: '2026-01-01',
  winner: 'Player1',
  sections: Array.from({ length: turns }, (_, i) =>
    turn(i, { Player1: i > turns - 4 ? 6 - (i - (turns - 4)) : 6, Player2: 6 })
  ),
});

describe('compactBattleLog', () => {
  it('keeps a real parsed log well inside the budget', () => {
    const parsed = parseBattleLog(
      battleLogNewStructure,
      'log-1',
      '2026-01-01',
      null,
      null,
      'Bassoonboy135',
      'SVI-DRI'
    );

    const compacted = compactBattleLog(parsed);

    expect(compacted.text.length).toBeLessThanOrEqual(COMPACTION_BUDGET.turnsChars);
    expect(compacted.turnsTotal).toBe(parsed.sections.length);
    expect(compacted.turnsCompacted).toBe(0);
  });

  it('emits contiguous T<n> headers matching the section indices', () => {
    const parsed = parseBattleLog(
      battleLogNewStructure,
      'log-1',
      '2026-01-01',
      null,
      null,
      'Bassoonboy135',
      'SVI-DRI'
    );

    const compacted = compactBattleLog(parsed);
    const headers = Array.from(compacted.text.matchAll(/^## T(\d+) /gm)).map((m) => Number(m[1]));

    expect(headers).toEqual(parsed.sections.map((_, index) => index));
  });

  it('strips noise lines that carry no analytical signal', () => {
    const parsed = parseBattleLog(
      battleLogNewStructure,
      'log-1',
      '2026-01-01',
      null,
      null,
      'Bassoonboy135',
      'SVI-DRI'
    );

    expect(compactBattleLog(parsed).text).not.toContain('shuffled their deck');
  });

  it('stays within budget on a 60-turn game by compacting the quiet middle', () => {
    const compacted = compactBattleLog(syntheticLog(60));

    expect(compacted.text.length).toBeLessThanOrEqual(COMPACTION_BUDGET.turnsChars);
    expect(compacted.turnsCompacted).toBeGreaterThan(0);
  });

  it('never compacts the opening, the closing, or a turn where prizes moved', () => {
    const log = syntheticLog(60);
    const compacted = compactBattleLog(log);

    // Full turns render their indented detail lines; headline turns do not.
    const blocks = compacted.text.split('\n\n');
    const detailed = new Set(
      blocks
        .filter((block) => block.includes('\n  '))
        .map((block) => Number(block.match(/^## T(\d+) /)?.[1]))
    );

    expect(detailed.has(0)).toBe(true);
    expect(detailed.has(59)).toBe(true);

    // Prizes move on the last few turns of the synthetic game.
    const prizeTurns = log.sections
      .map((section, index) => ({ section, index }))
      .filter(({ section, index }) => {
        const previous = log.sections[index - 1];
        if (!previous) return false;
        return Object.keys(section.prizesAfterTurn).some(
          (name) => previous.prizesAfterTurn[name] !== section.prizesAfterTurn[name]
        );
      })
      .map(({ index }) => index);

    expect(prizeTurns.length).toBeGreaterThan(0);
    prizeTurns.forEach((index) => expect(detailed.has(index)).toBe(true));
  });

  it('renders a prize delta line when a prize count changes', () => {
    const compacted = compactBattleLog(syntheticLog(20));
    expect(compacted.text).toMatch(/PRIZES: Player1 \d+->\d+/);
  });

  it('caps the number of detail lines kept per action', () => {
    const compacted = compactBattleLog(syntheticLog(12));
    expect(compacted.text).toContain('(+1 more)');
  });
});
