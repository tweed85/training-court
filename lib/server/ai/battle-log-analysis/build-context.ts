import type { BattleLog } from '@/components/battle-logs/utils/battle-log.types';
import type { DeckbuilderCatalogCard } from '@/lib/server/ptcg-card-catalog';
import { normalizeCardName } from '@/lib/server/ptcg-card-name';
import { buildCardIndex, extractCardNamesFromLog, type CardIndex } from './card-index';
import { compactBattleLog, COMPACTION_BUDGET } from './compact-log';

/**
 * How well we can check the model's claims.
 * - `full`     English log + a linked decklist. Everything is checkable.
 * - `deck-only` Decklist present but the log is non-English, so the card
 *               extractor finds nothing (the catalog is English-only).
 * - `log-only`  English log, no linked decklist. Deck suggestions are suppressed.
 * - `none`      Neither. The caller refuses rather than produce ungrounded advice.
 */
export type GroundingLevel = 'full' | 'deck-only' | 'log-only' | 'none';

export interface DeckEntry {
  name: string;
  qty: number;
  category?: string;
  metadata?: DeckbuilderCatalogCard['metadata'];
}

export interface AnalysisGrounding {
  level: GroundingLevel;
  language: string;
  hasDecklist: boolean;
  turnsTotal: number;
  turnsCompacted: number;
  logCardsResolved: number;
  approxChars: number;
}

export interface AnalysisContext {
  userPrompt: string;
  /** Every card the model is allowed to name, keyed by normalized name. */
  allowedCards: CardIndex;
  /** Cards the player demonstrably had access to: decklist ∪ cards they played. */
  userAccessibleCards: Set<string>;
  /** Normalized names in the saved decklist. */
  decklistCards: Set<string>;
  grounding: AnalysisGrounding;
}

const BASIC_ENERGY = /^basic\s+\w+\s+energy$/i;

/**
 * Neutralize markup inside a block whose contents the user controls.
 *
 * Every string here belongs to the requesting user and the analysis goes back
 * only to them, so a crafted log is self-directed rather than an attack on
 * anyone else. It is still worth closing: a log or note containing a literal
 * `</match_log>` would end the block early and let whatever follows read as
 * framing rather than as quoted evidence.
 *
 * Only `<` is rewritten. That is enough to stop any tag from forming, and it
 * leaves the rest of the user's text — which the model is meant to read
 * verbatim — untouched.
 */
const escapeUntrustedBlock = (value: string): string => value.replace(/</g, '&lt;');

/** Attribute values are quoted, so a deck named `x" y="` would break out. */
const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** Card text is expensive; basic energy carries none worth spending tokens on. */
const renderCardLine = (name: string, qty: number | null, card?: DeckbuilderCatalogCard): string => {
  const prefix = qty === null ? '' : `${qty} `;
  if (!card || BASIC_ENERGY.test(name)) return `${prefix}${name}`;

  const text = card.metadata.cardText?.filter(Boolean).join(' / ').trim();
  return text ? `${prefix}${name} — "${text}"` : `${prefix}${name}`;
};

function renderDecklist(entries: DeckEntry[], index: CardIndex): string {
  const buckets = new Map<string, string[]>();

  for (const entry of entries) {
    const category = (entry.category ?? 'Other').toUpperCase();
    const card = index.get(normalizeCardName(entry.name));
    const line = renderCardLine(entry.name, entry.qty, card);
    buckets.set(category, [...(buckets.get(category) ?? []), line]);
  }

  return Array.from(buckets.entries())
    .map(([category, lines]) => `${category}\n${lines.join('\n')}`)
    .join('\n\n');
}

export interface BuildContextInput {
  battleLog: BattleLog;
  logRow: {
    log: string;
    archetype: string | null;
    opp_archetype: string | null;
    format: string | null;
    turn_order: string | null;
    result: string | null;
    notes: string | null;
  };
  decklist: { name: string; archetype: string | null; cards: DeckEntry[] } | null;
  catalog: DeckbuilderCatalogCard[];
}

/**
 * Assemble everything the model sees, and everything the validator later needs
 * to check what it said.
 *
 * Card text is emitted once as a lookup table rather than repeated inline next
 * to each play; the model cross-references by name. That alone is the difference
 * between a prompt that fits the budget and one that does not.
 */
export function buildAnalysisContext(input: BuildContextInput): AnalysisContext {
  const { battleLog, logRow, decklist, catalog } = input;

  const index = buildCardIndex(catalog);
  const { resolved: logCards } = extractCardNamesFromLog(logRow.log, index);

  const decklistCards = new Set<string>();
  const allowedCards: CardIndex = new Map();
  const userAccessibleCards = new Set<string>();

  if (decklist) {
    for (const entry of decklist.cards) {
      const key = normalizeCardName(entry.name);
      if (!key) continue;
      decklistCards.add(key);
      userAccessibleCards.add(key);

      const card = index.get(key);
      if (card) allowedCards.set(key, card);
    }
  }

  // Cards seen in the log are quotable, and — for the analyzed player's own
  // plays — count as demonstrably accessible even without a linked decklist.
  const playerName = battleLog.players[0]?.name?.toLowerCase() ?? '';
  Array.from(logCards.entries()).forEach(([key, card]) => {
    allowedCards.set(key, card);
  });
  if (playerName) {
    for (const line of logRow.log.split('\n')) {
      if (!line.toLowerCase().includes(playerName)) continue;
      Array.from(extractCardNamesFromLog(line, index).resolved.keys()).forEach((key) => {
        userAccessibleCards.add(key);
      });
    }
  }

  const compacted = compactBattleLog(battleLog);

  const isEnglish = battleLog.language === 'en';
  const hasDecklist = Boolean(decklist && decklist.cards.length > 0);
  const level: GroundingLevel = hasDecklist
    ? isEnglish
      ? 'full'
      : 'deck-only'
    : isEnglish
      ? 'log-only'
      : 'none';

  // Opponent-side and other cards worth quoting that the decklist did not cover.
  const referenceCards = Array.from(logCards.entries())
    .filter(([key]) => !decklistCards.has(key))
    .slice(0, 60)
    .map(([, card]) => renderCardLine(card.name, null, card));

  const sections: string[] = [
    `FORMAT: ${logRow.format ?? 'unknown'}`,
    `ANALYZED PLAYER: ${battleLog.players[0]?.name ?? 'unknown'} (this is the person you are coaching)`,
    `OPPONENT: ${battleLog.players[1]?.name ?? 'unknown'}`,
    `RECORDED RESULT: ${logRow.result ?? 'unknown'}   TURN ORDER: ${logRow.turn_order ?? 'unknown'}`,
    `ANALYZED PLAYER'S DECK (user-labeled): ${logRow.archetype ?? 'unknown'}`,
    `OPPONENT'S DECK (user-labeled): ${logRow.opp_archetype ?? 'unknown'}`,
  ];

  if (decklist && hasDecklist) {
    sections.push(
      `<decklist name="${escapeAttribute(decklist.name)}" untrusted="true">\n${escapeUntrustedBlock(renderDecklist(decklist.cards, index))}\n</decklist>`
    );
  } else {
    sections.push(
      'DECKLIST: not linked. Do not produce any deck suggestions; you cannot know what the player brought.'
    );
  }

  if (referenceCards.length) {
    sections.push(
      `<card_reference note="cards observed in the log that are not in the decklist">\n${referenceCards.join('\n')}\n</card_reference>`
    );
  }

  if (!isEnglish) {
    sections.push(
      `NOTE: this log is in "${battleLog.language}". Card rules text could not be resolved for it, so reason only from the mechanical sequence of plays.`
    );
  }

  sections.push(
    `<match_log untrusted="true" turns_total="${compacted.turnsTotal}" turns_summarized="${compacted.turnsCompacted}">\n${escapeUntrustedBlock(compacted.text)}\n</match_log>`
  );

  if (logRow.notes?.trim()) {
    sections.push(
      `<player_notes untrusted="true">\n${escapeUntrustedBlock(logRow.notes.trim())}\n</player_notes>`
    );
  }

  sections.push(`Analyze this match for ${battleLog.players[0]?.name ?? 'the analyzed player'}.`);

  let userPrompt = sections.join('\n\n');
  if (userPrompt.length > COMPACTION_BUDGET.totalChars) {
    userPrompt = `${userPrompt.slice(0, COMPACTION_BUDGET.totalChars - 3)}...`;
  }

  return {
    userPrompt,
    allowedCards,
    userAccessibleCards,
    decklistCards,
    grounding: {
      level,
      language: battleLog.language,
      hasDecklist,
      turnsTotal: compacted.turnsTotal,
      turnsCompacted: compacted.turnsCompacted,
      logCardsResolved: logCards.size,
      approxChars: userPrompt.length,
    },
  };
}
