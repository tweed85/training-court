
import type { BattleLog, BattleLogTurn } from '../../components/battle-logs/utils/battle-log.types';
import { deriveBoardStates } from '../../components/battle-logs/utils/board-state';
import { parseBattleLog } from '../../components/battle-logs/utils/battle-log.utils';
import { battleLogNewStructure } from '../../components/battle-logs/utils/testing-files/battleLogNewStructure';
import { battleLogGerman } from '../../components/battle-logs/utils/testing-files/battleLogGerman';

const turn = (lines: string[]): BattleLogTurn => ({
  turnTitle: 'A Turn',
  body: '',
  player: 'ash',
  prizesAfterTurn: { ash: 6, misty: 6 },
  actions: lines.map((title) => ({ title, details: [] })),
});

const log = (turns: BattleLogTurn[], language = 'en'): BattleLog =>
  ({
    language,
    id: 'l1',
    players: [
      { name: 'ash', deck: 'a', oppDeck: 'b', result: 'W' },
      { name: 'misty', deck: 'b', oppDeck: 'a', result: 'L' },
    ],
    date: '2026-01-01',
    winner: 'ash',
    sections: turns,
  }) as BattleLog;

describe('deriveBoardStates — placement', () => {
  it('returns one board per turn', () => {
    const boards = deriveBoardStates(log([turn([]), turn([])]));
    expect(boards).toHaveLength(2);
  });

  it('places a Pokemon in the Active Spot', () => {
    const boards = deriveBoardStates(log([turn(['ash played Pikipek to the Active Spot.'])]));
    expect(boards[0].ash.active?.name).toBe('Pikipek');
  });

  it('places Pokemon on the Bench', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Hoothoot to the Bench.', 'ash played Fan Rotom to the Bench.'])])
    );
    expect(boards[0].ash.bench.map((p) => p.name)).toEqual(['Hoothoot', 'Fan Rotom']);
  });

  it('keeps card names containing apostrophes intact', () => {
    const boards = deriveBoardStates(
      log([turn(["misty played Team Rocket's Tarountula to the Active Spot."])])
    );
    expect(boards[0].misty.active?.name).toBe("Team Rocket's Tarountula");
  });

  it('promotes a benched Pokemon to active', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Hoothoot to the Bench.', "ash's Hoothoot is now in the Active Spot."])])
    );
    expect(boards[0].ash.active?.name).toBe('Hoothoot');
    expect(boards[0].ash.bench).toHaveLength(0);
  });

  it('accepts a curly apostrophe in the possessive', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Hoothoot to the Bench.', 'ash’s Hoothoot is now in the Active Spot.'])])
    );
    expect(boards[0].ash.active?.name).toBe('Hoothoot');
  });

  it('moves the active Pokemon to the bench on retreat', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Pikipek to the Active Spot.', 'ash retreated Pikipek to the Bench.'])])
    );
    expect(boards[0].ash.active).toBeNull();
    expect(boards[0].ash.bench.map((p) => p.name)).toEqual(['Pikipek']);
  });

  it('removes a Knocked Out Pokemon from play', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Pikipek to the Active Spot.', "ash's Pikipek was Knocked Out!"])])
    );
    expect(boards[0].ash.active).toBeNull();
  });

  it('carries state forward into later turns', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Pikipek to the Active Spot.']), turn([])])
    );
    expect(boards[1].ash.active?.name).toBe('Pikipek');
  });

  it('returns an empty array for a non-English log', () => {
    expect(deriveBoardStates(log([turn([])], 'de'))).toEqual([]);
  });

  it('reads board events from action details as well as titles', () => {
    const withDetail = log([turn([])]);
    withDetail.sections[0].actions = [
      { title: 'ash played Nest Ball.', details: ['ash played Hoothoot to the Bench.'] },
    ];
    expect(deriveBoardStates(withDetail)[0].ash.bench.map((p) => p.name)).toEqual(['Hoothoot']);
  });
});

describe('deriveBoardStates — evolution, attachments, damage', () => {
  it('evolves in place on the bench and records the pre-evolution', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Dreepy to the Bench.', 'ash evolved Dreepy to Drakloak on the Bench.'])])
    );
    expect(boards[0].ash.bench[0].name).toBe('Drakloak');
    expect(boards[0].ash.bench[0].evolvedFrom).toEqual(['Dreepy']);
  });

  it('evolves in the Active Spot', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Dreepy to the Active Spot.', 'ash evolved Dreepy to Drakloak in the Active Spot.'])])
    );
    expect(boards[0].ash.active?.name).toBe('Drakloak');
  });

  it('keeps damage across an evolution', () => {
    const boards = deriveBoardStates(
      log([
        turn([
          'ash played Dreepy to the Active Spot.',
          "misty's Spidops used Rocket Rush on ash's Dreepy for 60 damage.",
          'ash evolved Dreepy to Drakloak in the Active Spot.',
        ]),
      ])
    );
    expect(boards[0].ash.active?.damage).toBe(60);
    expect(boards[0].ash.active?.name).toBe('Drakloak');
  });

  it('accumulates damage across turns', () => {
    const boards = deriveBoardStates(
      log([
        turn(['ash played Pikipek to the Active Spot.', "misty's Spidops used Rocket Rush on ash's Pikipek for 70 damage."]),
        turn(["misty's Spidops used Rocket Rush on ash's Pikipek for 50 damage."]),
      ])
    );
    expect(boards[0].ash.active?.damage).toBe(70);
    expect(boards[1].ash.active?.damage).toBe(120);
  });

  it('damages a benched Pokemon by name', () => {
    const boards = deriveBoardStates(
      log([
        turn([
          'ash played Hoothoot to the Bench.',
          "misty's Spidops used Rocket Rush on ash's Hoothoot for 150 damage.",
        ]),
      ])
    );
    expect(boards[0].ash.bench[0].damage).toBe(150);
  });

  it('discards damage when a Pokemon is Knocked Out', () => {
    const boards = deriveBoardStates(
      log([
        turn([
          'ash played Pikipek to the Active Spot.',
          "misty's Spidops used Rocket Rush on ash's Pikipek for 150 damage.",
          "ash's Pikipek was Knocked Out!",
          'ash played Pikipek to the Active Spot.',
        ]),
      ])
    );
    expect(boards[0].ash.active?.damage).toBe(0);
  });

  it('records attachments', () => {
    const boards = deriveBoardStates(
      log([
        turn([
          'ash played Pikipek to the Active Spot.',
          'ash attached Basic Psychic Energy to Pikipek in the Active Spot.',
        ]),
      ])
    );
    expect(boards[0].ash.active?.attachments).toEqual(['Basic Psychic Energy']);
  });

  it('records a status condition', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Pikipek to the Active Spot.', "ash's Pikipek is now Poisoned."])])
    );
    expect(boards[0].ash.active?.status).toBe('Poisoned');
  });
});

describe('deriveBoardStates — real fixtures', () => {
  it('produces one board per section and never exceeds five benched', () => {
    const parsed = parseBattleLog(battleLogNewStructure, 'l', '2026-01-01', null, null, 'Bassoonboy135', 'SVI-DRI');
    const boards = deriveBoardStates(parsed);

    expect(boards).toHaveLength(parsed.sections.length);
    for (const board of boards) {
      for (const player of Object.keys(board)) {
        expect(board[player].bench.length).toBeLessThanOrEqual(5);
      }
    }
  });

  it('puts a Pokemon in play for both players by the end of setup', () => {
    const parsed = parseBattleLog(battleLogNewStructure, 'l', '2026-01-01', null, null, 'Bassoonboy135', 'SVI-DRI');
    const boards = deriveBoardStates(parsed);
    const setup = boards[0];
    expect(Object.values(setup).some((b) => b.active !== null)).toBe(true);
  });

  it('yields no board for a German log', () => {
    const parsed = parseBattleLog(battleLogGerman, 'l', '2026-01-01', null, null, null, 'SVI-DRI');
    expect(deriveBoardStates(parsed)).toEqual([]);
  });
});
