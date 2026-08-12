import type { BattleLog, BattleLogTurn } from '@/components/battle-logs/utils/battle-log.types';

export const COMPACTION_BUDGET = {
  /** Whole prompt ceiling, roughly 15k tokens. */
  totalChars: 60_000,
  /** Share of that reserved for the turn-by-turn transcript. */
  turnsChars: 38_000,
  /** Per-turn ceiling before a turn is truncated. */
  charsPerTurn: 1_400,
  /** Sub-bullets kept per action before collapsing to a count. */
  detailsPerAction: 4,
  /** Turns from the start always kept in full. */
  openingTurns: 8,
  /** Turns from the end always kept in full. */
  closingTurns: 6,
} as const;

/**
 * Lines that carry no analytical signal. Dropping them is worth roughly a
 * quarter of a typical log.
 */
const NOISE_MARKERS = [
  'shuffled their deck',
  'A card was added to',
  'can no longer use VSTAR Powers',
  'was activated.',
];

const isNoise = (line: string): boolean =>
  NOISE_MARKERS.some((marker) => line.includes(marker));

const truncate = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;

type TurnMode = 'full' | 'headline';

/**
 * Which players' prize counts moved during this turn, rendered as a delta.
 * `parseBattleLog` already threads a running prize counter through every turn,
 * so this is free and it is the single most informative line per turn.
 */
function prizeDelta(turn: BattleLogTurn, previous: BattleLogTurn | undefined): string {
  if (!previous) return '';

  const changes = Object.entries(turn.prizesAfterTurn)
    .filter(([name, remaining]) => previous.prizesAfterTurn[name] !== remaining)
    .map(([name, remaining]) => `${name} ${previous.prizesAfterTurn[name]}->${remaining}`);

  return changes.length ? `\nPRIZES: ${changes.join(', ')}` : '';
}

const hasPrizeChange = (turn: BattleLogTurn, previous: BattleLogTurn | undefined): boolean =>
  prizeDelta(turn, previous) !== '';

function renderTurn(
  turn: BattleLogTurn,
  index: number,
  previous: BattleLogTurn | undefined,
  mode: TurnMode
): string {
  const active = turn.player ? ` [active: ${turn.player}]` : '';
  const header = `## T${index} ${turn.turnTitle}${active}${prizeDelta(turn, previous)}`;

  if (mode === 'headline') {
    const titles = turn.actions
      .map((action) => action.title)
      .filter((title) => !isNoise(title))
      .slice(0, 6);
    return titles.length ? `${header}\n${titles.join('\n')}` : header;
  }

  const body = turn.actions
    .filter((action) => !isNoise(action.title))
    .map((action) => {
      const details = action.details
        .filter((detail) => !isNoise(detail))
        .slice(0, COMPACTION_BUDGET.detailsPerAction);

      const omitted = action.details.length - details.length;
      const suffix = omitted > 0 ? `\n  (+${omitted} more)` : '';

      if (!details.length) return action.title;

      const rendered = details.map((detail) => `  ${detail.replace(/^[\s\-•]+/, '')}`).join('\n');
      return `${action.title}\n${rendered}${suffix}`;
    })
    .join('\n');

  return truncate(body ? `${header}\n${body}` : header, COMPACTION_BUDGET.charsPerTurn);
}

export interface CompactedLog {
  text: string;
  turnsTotal: number;
  /** Turns rendered as headlines only. */
  turnsCompacted: number;
}

/**
 * Rebuild the match transcript from the parsed structure rather than the raw
 * text, then shrink it to fit the budget.
 *
 * The shrink is semantically aware rather than a blind window: opening turns,
 * closing turns, and every turn where a prize count changed keep full detail,
 * because prize swings are exactly where the turning points are. Only the quiet
 * middle degrades to action headlines.
 */
export function compactBattleLog(battleLog: BattleLog): CompactedLog {
  const sections = battleLog.sections;
  const modes: TurnMode[] = sections.map(() => 'full');

  const render = () =>
    sections
      .map((turn, index) => renderTurn(turn, index, sections[index - 1], modes[index]))
      .join('\n\n');

  let text = render();

  if (text.length > COMPACTION_BUDGET.turnsChars) {
    const lastIndex = sections.length - 1;

    for (let index = 0; index < sections.length; index += 1) {
      const isOpening = index <= COMPACTION_BUDGET.openingTurns;
      const isClosing = index > lastIndex - COMPACTION_BUDGET.closingTurns;
      const isPivot = hasPrizeChange(sections[index], sections[index - 1]);

      if (!isOpening && !isClosing && !isPivot) {
        modes[index] = 'headline';
      }
    }

    text = render();
  }

  // Still over budget on a very long game: give up detail on the middle
  // regardless of prize activity, oldest turns first.
  if (text.length > COMPACTION_BUDGET.turnsChars) {
    for (let index = COMPACTION_BUDGET.openingTurns + 1; index < sections.length; index += 1) {
      if (index > sections.length - 1 - COMPACTION_BUDGET.closingTurns) break;
      modes[index] = 'headline';
      text = render();
      if (text.length <= COMPACTION_BUDGET.turnsChars) break;
    }
  }

  return {
    text: truncate(text, COMPACTION_BUDGET.turnsChars),
    turnsTotal: sections.length,
    turnsCompacted: modes.filter((mode) => mode === 'headline').length,
  };
}
