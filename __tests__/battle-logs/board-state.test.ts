
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

  it('benches a Pokemon drawn and played by a search card', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Nest Ball.', 'ash drew Genesect ex and played it to the Bench.'])])
    );
    expect(boards[0].ash.bench.map((p) => p.name)).toEqual(['Genesect ex']);
  });

  it('retreats into a full bench without losing the retreating Pokemon', () => {
    const boards = deriveBoardStates(
      log([
        turn([
          'ash played Pikipek to the Active Spot.',
          'ash played Hoothoot to the Bench.',
          'ash played Hoothoot to the Bench.',
          'ash played Hoothoot to the Bench.',
          'ash played Hoothoot to the Bench.',
          'ash played Fan Rotom to the Bench.',
          'ash retreated Pikipek to the Bench.',
          "ash's Fan Rotom is now in the Active Spot.",
        ]),
      ])
    );
    expect(boards[0].ash.active?.name).toBe('Fan Rotom');
    expect(boards[0].ash.bench.map((p) => p.name)).toEqual([
      'Hoothoot',
      'Hoothoot',
      'Hoothoot',
      'Hoothoot',
      'Pikipek',
    ]);
  });
});

describe('deriveBoardStates — switches, bounces, and resync', () => {
  it('swaps the active Pokemon when one is switched in', () => {
    const boards = deriveBoardStates(
      log([
        turn([
          'misty played Pidgey to the Active Spot.',
          'misty played Duskull to the Bench.',
          "ash played Boss's Orders.",
          "misty's Duskull was switched with misty's Pidgey to become the Active Pokemon.",
        ]),
      ])
    );
    expect(boards[0].misty.active?.name).toBe('Duskull');
    expect(boards[0].misty.bench.map((p) => p.name)).toEqual(['Pidgey']);
  });

  it('accepts a curly apostrophe in a switch line', () => {
    const boards = deriveBoardStates(
      log([
        turn([
          'misty played Pidgey to the Active Spot.',
          'misty played Duskull to the Bench.',
          'misty’s Duskull was switched with misty’s Pidgey to become the Active Pokemon.',
        ]),
      ])
    );
    expect(boards[0].misty.active?.name).toBe('Duskull');
  });

  it('removes a Pokemon bounced back to the hand', () => {
    const boards = deriveBoardStates(
      log([
        turn([
          'ash played Genesect ex to the Active Spot.',
          'ash played Hoothoot to the Bench.',
          "ash played Professor Turo's Scenario.",
          "ash moved ash's Genesect ex to their hand.",
        ]),
      ])
    );
    expect(boards[0].ash.active).toBeNull();
    expect(boards[0].ash.bench.map((p) => p.name)).toEqual(['Hoothoot']);
  });

  it('does not treat "moved N cards to their deck" as a bounce', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Pikipek to the Active Spot.', "ash moved ash's 9 cards to their deck."])])
    );
    expect(boards[0].ash.active?.name).toBe('Pikipek');
  });

  it('leaves a Pokemon alone when the bounced card is not in play', () => {
    const boards = deriveBoardStates(
      log([
        turn([
          'ash played Pikipek to the Active Spot.',
          'ash played Night Stretcher.',
          "ash moved ash's Froakie to their hand.",
        ]),
      ])
    );
    expect(boards[0].ash.active?.name).toBe('Pikipek');
    expect(boards[0].ash.bench).toHaveLength(0);
  });

  it('promotes authoritatively: an untracked name still becomes active', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Pikipek to the Active Spot.', "ash's Greninja ex is now in the Active Spot."])])
    );
    expect(boards[0].ash.active?.name).toBe('Greninja ex');
    expect(boards[0].ash.bench.map((p) => p.name)).toEqual(['Pikipek']);
  });

  it('treats a promote of the current active as a no-op', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Pikipek to the Active Spot.', "ash's Pikipek is now in the Active Spot."])])
    );
    expect(boards[0].ash.active?.name).toBe('Pikipek');
    expect(boards[0].ash.bench).toHaveLength(0);
  });
});

describe('deriveBoardStates — unnamed bench placements', () => {
  it('names placeholders from the reveal line that follows', () => {
    const withDetail = log([turn([])]);
    withDetail.sections[0].actions = [
      {
        title: 'misty played Buddy-Buddy Poffin.',
        details: [
          'misty drew 2 cards and played them to the Bench.',
          'Froakie, Fezandipiti ex',
          'misty shuffled their deck.',
        ],
      },
    ];
    const boards = deriveBoardStates(withDetail);
    expect(boards[0].misty.bench.map((p) => p.name)).toEqual(['Froakie', 'Fezandipiti ex']);
    expect(boards[0].misty.bench.every((p) => !p.unknown)).toBe(true);
  });

  it('falls back to placeholders when no reveal line follows', () => {
    const boards = deriveBoardStates(
      log([turn(['misty drew 2 cards and played them to the Bench.', 'misty ended their turn.'])])
    );
    expect(boards[0].misty.bench).toHaveLength(2);
    expect(boards[0].misty.bench.every((p) => p.unknown)).toBe(true);
  });

  it('adopts a placeholder rather than duplicating a Pokemon the log names later', () => {
    const boards = deriveBoardStates(
      log([
        turn([
          'misty played Pidgey to the Active Spot.',
          'misty drew 2 cards and played them to the Bench.',
          'misty ended their turn.',
          'misty evolved Froakie to Frogadier on the Bench.',
        ]),
      ])
    );
    expect(boards[0].misty.bench.map((p) => p.name)).toEqual(['Frogadier', '']);
    expect(boards[0].misty.bench[0].unknown).toBeUndefined();
  });

  it('never lets a placeholder keep a named Pokemon off a full bench', () => {
    const boards = deriveBoardStates(
      log([
        turn([
          'misty drew 5 cards and played them to the Bench.',
          'misty ended their turn.',
          'misty played Budew to the Bench.',
        ]),
      ])
    );
    expect(boards[0].misty.bench).toHaveLength(5);
    expect(boards[0].misty.bench.map((p) => p.name)).toContain('Budew');
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
          "misty's Spidops used Rocket Rush on ash’s Dreepy for 60 damage.",
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
        turn(['ash played Pikipek to the Active Spot.', "misty's Spidops used Rocket Rush on ash’s Pikipek for 70 damage."]),
        turn(["misty's Spidops used Rocket Rush on ash’s Pikipek for 50 damage."]),
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
          "misty's Spidops used Rocket Rush on ash’s Hoothoot for 150 damage.",
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
          "misty's Spidops used Rocket Rush on ash’s Pikipek for 150 damage.",
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

  /**
   * Read off the fixture by hand, line by line. The "never exceeds five benched"
   * test above passes even when overflow is silently dropped, so it cannot tell
   * a correct board from an empty one — this can.
   *
   * Bassoonboy135 ends on Gholdengo ex after Professor Turo's Scenario picks up
   * the Genesect ex that Boss's Orders had dragged active. Player2 ends on
   * Greninja ex, promoted after Budew retreated, with the Pidgeot ex that
   * retreated on turn 4 and the Froakie replayed by Buddy-Buddy Poffin benched.
   */
  it('derives the exact final-turn board for both players', () => {
    const parsed = parseBattleLog(battleLogNewStructure, 'l', '2026-01-01', null, null, 'Bassoonboy135', 'SVI-DRI');
    const boards = deriveBoardStates(parsed);
    const final = boards[boards.length - 1];

    expect(final.Bassoonboy135.active?.name).toBe('Gholdengo ex');
    expect(final.Bassoonboy135.bench.map((p) => p.name)).toEqual([
      'Lunatone',
      'Gholdengo ex',
      'Gholdengo ex',
      'Solrock',
    ]);

    expect(final.Player2.active?.name).toBe('Greninja ex');
    expect(final.Player2.bench.map((p) => p.name)).toEqual([
      'Fezandipiti ex',
      'Pidgey',
      'Pidgeot ex',
      'Froakie',
      'Budew',
    ]);

    // Nothing on the final board is an unresolved placeholder.
    const everything = [
      final.Bassoonboy135.active,
      ...final.Bassoonboy135.bench,
      final.Player2.active,
      ...final.Player2.bench,
    ];
    expect(everything.every((p) => p && !p.unknown)).toBe(true);
  });

  it('keeps the Pokemon Buddy-Buddy Poffin and Call for Family found in play', () => {
    const parsed = parseBattleLog(battleLogNewStructure, 'l', '2026-01-01', null, null, 'Bassoonboy135', 'SVI-DRI');
    const boards = deriveBoardStates(parsed);

    // Turn 2: two Froakie from Poffin, a hand-played Pidgey, then Duskull and
    // Fezandipiti ex from Call for Family. All five are named on reveal lines.
    expect(boards[2].Player2.bench.map((p) => p.name)).toEqual([
      'Froakie',
      'Froakie',
      'Pidgey',
      'Duskull',
      'Fezandipiti ex',
    ]);
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
