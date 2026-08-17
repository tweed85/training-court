import type { BattleLog, BattleLogTurn } from '../../components/battle-logs/utils/battle-log.types';
import { deriveBoardStates } from '../../components/battle-logs/utils/board-state';

/**
 * PTCG Live itemises the log owner's cards on a bullet line beneath the counted
 * event that moved them. These tests pin that reading: the identities come off
 * the list, and a list that does not agree with the count is refused rather
 * than guessed at.
 *
 * Two-player effects, where a second counted line belongs to the opponent
 * rather than repeating the first, are covered in
 * board-state-both-player-effects.test.ts.
 */
const action = (title: string, details: string[] = []) => ({ title, details });

const turn = (actions: { title: string; details: string[] }[]): BattleLogTurn => ({
  turnTitle: 'A Turn',
  body: '',
  player: 'ash',
  prizesAfterTurn: { ash: 6, misty: 6 },
  actions,
});

const log = (turns: BattleLogTurn[]): BattleLog =>
  ({
    language: 'en',
    id: 'l1',
    players: [
      { name: 'ash', deck: 'a', oppDeck: 'b', result: 'W' },
      { name: 'misty', deck: 'b', oppDeck: 'a', result: 'L' },
    ],
    date: '2026-01-01',
    winner: 'ash',
    sections: turns,
  }) as BattleLog;

const boardOf = (actions: { title: string; details: string[] }[], player = 'ash') =>
  deriveBoardStates(log([turn(actions)]))[0][player];

describe('itemised draws name the cards', () => {
  it('reads the drawn cards off the bullet list', () => {
    const hand = boardOf([
      action('ash played Professor.', [
        '- ash drew 4 cards.',
        '   • Fan Rotom, Hoothoot, Basic Fire Energy, Dawn',
      ]),
    ]).hand;
    expect(hand.size).toBe(4);
    expect(hand.known).toEqual(['Fan Rotom', 'Hoothoot', 'Basic Fire Energy', 'Dawn']);
  });

  it('does not fold a second counted line back into the same hand', () => {
    const hand = boardOf([
      action('ash played Professor.', [
        '- ash drew 4 cards.',
        '   • Fan Rotom, Hoothoot, Basic Fire Energy, Dawn',
        '- ash drew 4 cards.',
      ]),
    ]).hand;
    expect(hand.size).toBe(4);
    expect(hand.known).toHaveLength(4);
  });

  it('falls back to unknown cards when no list follows', () => {
    const hand = boardOf([action('ash played Professor.', ['- ash drew 3 cards.'])]).hand;
    expect(hand.size).toBe(3);
    expect(hand.known).toEqual([]);
  });

  it('ignores a list whose length disagrees with the count', () => {
    const hand = boardOf([
      action('ash played Professor.', ['- ash drew 4 cards.', '   • Fan Rotom, Hoothoot']),
    ]).hand;
    expect(hand.size).toBe(4);
    expect(hand.known).toEqual([]);
  });

  it('keeps a drawn card that is never played, discarded or shuffled back', () => {
    const hand = boardOf([
      action('ash played Professor.', ['- ash drew 3 cards.', '   • Iono, Arven, Nest Ball']),
      action('ash played Iono.', []),
    ]).hand;
    expect(hand.size).toBe(2);
    expect(hand.known).toEqual(['Arven', 'Nest Ball']);
  });
});

describe('itemised removals name the cards that left', () => {
  it('removes exactly the shuffled-back cards rather than the oldest', () => {
    const hand = boardOf([
      action('ash played Professor.', [
        '- ash drew 4 cards.',
        '   • Judge, Iono, Arven, Nest Ball',
      ]),
      action('ash played Judge.', [
        '- ash shuffled 2 cards into their deck.',
        '   • Iono, Nest Ball',
        '- ash shuffled 2 cards into their deck.',
      ]),
    ]).hand;
    expect(hand.size).toBe(1);
    expect(hand.known).toEqual(['Arven']);
  });

  it('moves named discards into the discard pile', () => {
    const board = boardOf([
      action('ash played Professor.', ['- ash drew 2 cards.', '   • Iono, Arven']),
      action("ash's Pikipek used Peck.", ['- ash discarded 2 cards.', '   • Iono, Arven']),
    ]);
    expect(board.hand.size).toBe(0);
    expect(board.discard.known).toEqual(['Iono', 'Arven']);
    expect(board.discard.size).toBe(2);
  });

  it('names cards put on the bottom of the deck', () => {
    const hand = boardOf([
      action('ash played Professor.', [
        '- ash drew 4 cards.',
        '   • Pokegear, Iono, Arven, Nest Ball',
      ]),
      action('ash played Pokegear.', [
        '- ash put 2 cards on the bottom of their deck.',
        '   • Iono, Nest Ball',
      ]),
    ]).hand;
    expect(hand.known).toEqual(['Arven']);
    expect(hand.size).toBe(1);
  });

  it('reads the opponent cards a bulk discard reveals', () => {
    const board = boardOf(
      [
        action('misty played Trash.', [
          '- misty discarded 2 cards.',
          "   • Team Rocket's Factory, Basic Grass Energy",
        ]),
      ],
      'misty'
    );
    expect(board.discard.known).toEqual(["Team Rocket's Factory", 'Basic Grass Energy']);
  });
});

describe('itemised bench placement names the Pokemon', () => {
  it('replaces the face-down bench placeholders with real names', () => {
    const bench = boardOf(
      [
        action('misty played Poffin.', [
          '- misty drew 2 cards and played them to the Bench.',
          "   • Team Rocket's Tarountula, Dunsparce",
        ]),
      ],
      'misty'
    ).bench;
    expect(bench.map((p) => p.name)).toEqual(["Team Rocket's Tarountula", 'Dunsparce']);
    expect(bench.some((p) => p.unknown)).toBe(false);
  });

  it('still falls back to placeholders with no list', () => {
    const bench = boardOf(
      [action('misty played Poffin.', ['- misty drew 2 cards and played them to the Bench.'])],
      'misty'
    ).bench;
    expect(bench).toHaveLength(2);
    expect(bench.every((p) => p.unknown)).toBe(true);
  });
});
