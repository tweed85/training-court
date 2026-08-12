
import type { BattleLog, BattleLogTurn } from '../../components/battle-logs/utils/battle-log.types';
import { deriveBoardStates } from '../../components/battle-logs/utils/board-state';

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
