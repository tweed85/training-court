'use client';

import Image from 'next/image';
import { Wrench } from 'lucide-react';
import { useGT } from 'gt-react';
import {
  ENERGY_ABBREVIATION,
  ENERGY_STYLE,
  SPECIAL_ENERGY_ABBREVIATION,
  SPECIAL_ENERGY_STYLE,
  classifyAttachment,
} from './attachment';
import type { BoardState, PokemonInPlay, ZoneCard } from '../utils/board-state.types';
import type { LookupCard } from '@/app/api/ptcg/cards/lookup/route';

interface BoardStateViewProps {
  board: BoardState;
  cards: Record<string, LookupCard>;
}

/**
 * Intrinsic size handed to next/image. The rendered size comes from the
 * responsive width classes below; this pair only fixes the aspect ratio and
 * asks for art sharp enough for the largest breakpoint.
 */
const INTRINSIC_WIDTH = 292;
const INTRINSIC_HEIGHT = 408;

/** A real card is 63x88mm. Matching it keeps placeholders the same shape as art. */
const CARD_SHAPE = 'aspect-[63/88] rounded-md';

/**
 * Cards grew on desktop because that is where there is room to read them; at
 * 64px the art was decorative rather than legible.
 */
const SLOT_WIDTH = {
  active: 'w-24 lg:w-32 xl:w-36',
  bench: 'w-16 lg:w-20 xl:w-24',
  /** Hand and discard cards are for counting and recall, not reading text. */
  zone: 'w-10 lg:w-12 xl:w-14',
} as const;

function CardSlot({
  pokemon,
  card,
  large,
}: {
  pokemon: PokemonInPlay;
  card?: LookupCard;
  large?: boolean;
}) {
  const gt = useGT();
  const width = large ? SLOT_WIDTH.active : SLOT_WIDTH.bench;

  if (pokemon.unknown) {
    return (
      <div
        data-testid="board-unknown-card"
        className={`${width} ${CARD_SHAPE} border border-dashed border-muted-foreground/40 bg-muted/40`}
        title={gt('Card not named in the log', { $id: 'battleLogs.board.unknownCard' })}
      />
    );
  }

  const maxHp = card?.hp;
  const remaining = maxHp === undefined ? undefined : Math.max(0, maxHp - pokemon.damage);
  const ratio = maxHp && remaining !== undefined ? remaining / maxHp : 1;

  return (
    <div className={`${width} flex flex-col items-center gap-1`}>
      <div className="relative w-full">
      {card?.imageUrl ? (
        <Image
          src={card.imageUrl}
          alt={pokemon.name}
          width={INTRINSIC_WIDTH}
          height={INTRINSIC_HEIGHT}
          sizes="(min-width: 1280px) 144px, (min-width: 1024px) 128px, 96px"
          className={`h-auto w-full ${CARD_SHAPE} object-cover`}
        />
      ) : (
        <div
          className={`w-full ${CARD_SHAPE} flex items-center justify-center border bg-muted p-1 text-center text-[10px] leading-tight`}
        >
          {pokemon.name}
        </div>
      )}
        <AttachmentChips attachments={pokemon.attachments} large={large} />
      </div>

      {remaining !== undefined && maxHp !== undefined && (
        <>
          <div className="h-1 w-full overflow-hidden rounded bg-muted">
            <div
              className={ratio > 0.5 ? 'h-full bg-emerald-500' : ratio > 0.2 ? 'h-full bg-amber-500' : 'h-full bg-red-500'}
              style={{ width: `${ratio * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground lg:text-xs">{`${remaining}/${maxHp}`}</span>
        </>
      )}


    </div>
  );
}

/** One card in the hand or discard pile. */
function ZoneSlot({ item, card }: { item: ZoneCard; card?: LookupCard }) {
  const gt = useGT();

  if (item.unknown) {
    return (
      <div
        data-testid="zone-unknown-card"
        className={`${SLOT_WIDTH.zone} ${CARD_SHAPE} flex items-center justify-center border border-dashed border-muted-foreground/40 bg-muted/40 p-0.5 text-center text-[8px] leading-tight text-muted-foreground lg:text-[9px]`}
      >
        {gt('Unknown', { $id: 'battleLogs.board.unknownZoneCard' })}
      </div>
    );
  }

  if (card?.imageUrl) {
    return (
      <Image
        src={card.imageUrl}
        alt={item.name}
        title={item.name}
        width={INTRINSIC_WIDTH}
        height={INTRINSIC_HEIGHT}
        sizes="56px"
        className={`${SLOT_WIDTH.zone} h-auto ${CARD_SHAPE} object-cover`}
      />
    );
  }

  return (
    <div
      title={item.name}
      className={`${SLOT_WIDTH.zone} ${CARD_SHAPE} flex items-center justify-center border bg-muted p-0.5 text-center text-[8px] leading-tight lg:text-[9px]`}
    >
      {item.name}
    </div>
  );
}

/** A labeled, compact card zone: Hand or Discard. Hidden while empty. */
function CardZone({
  label,
  items,
  cards,
  testId,
}: {
  label: string;
  items: ZoneCard[];
  cards: Record<string, LookupCard>;
  testId: string;
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label} ({items.length})
      </span>
      <div className="flex flex-wrap gap-1">
        {items.map((item, index) => (
          <ZoneSlot key={`${item.name}-${index}`} item={item} card={cards[item.name]} />
        ))}
      </div>
    </div>
  );
}

/** How many chips fit legibly across a bench card before they crowd the art. */
const MAX_VISIBLE_CHIPS = 4;

/**
 * Attached energy and tools, drawn over the bottom of the card art.
 *
 * Shape carries the distinction before colour does — energy is a circle, a tool
 * is a rounded square with a wrench — so the two stay separable in greyscale and
 * for colour-blind readers. Energy letters are the standard TCG shorthand
 * (R for fire, Y for fairy, N for dragon), which players already read on
 * decklists, so the row needs no legend.
 */
function AttachmentChips({ attachments, large }: { attachments: string[]; large?: boolean }) {
  const gt = useGT();
  if (attachments.length === 0) return null;

  const classified = attachments.map(classifyAttachment);
  const visible = classified.slice(0, MAX_VISIBLE_CHIPS);
  const overflow = classified.length - visible.length;

  return (
    <div
      className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-1 rounded-b-md bg-gradient-to-t from-black/80 via-black/45 to-transparent px-1.5 pb-1.5 pt-5"
      role="list"
      aria-label={`${gt('Attached', { $id: 'battleLogs.board.attached' })}: ${attachments.join(', ')}`}
      data-testid="attachment-chips"
    >
      {visible.map((attachment, index) => {
        // A white outline plus a drop shadow makes each chip read as a sticker
        // sitting on the art, rather than blending into whatever is behind it.
        const size = large
          ? 'h-5 w-5 text-[10px] lg:h-6 lg:w-6 lg:text-xs'
          : 'h-4 w-4 text-[9px] lg:h-5 lg:w-5 lg:text-[10px]';
        const shared = `flex items-center justify-center font-bold leading-none ring-1 ring-white/70 shadow-[0_1px_2px_rgba(0,0,0,0.55)] ${size}`;

        if (attachment.kind === 'tool') {
          return (
            <span
              key={`${attachment.name}-${index}`}
              role="listitem"
              title={attachment.name}
              className={`${shared} rounded-[3px] bg-zinc-700 text-white`}
            >
              <Wrench className={large ? "h-3 w-3 lg:h-3.5 lg:w-3.5" : "h-2.5 w-2.5 lg:h-3 lg:w-3"} aria-hidden />
            </span>
          );
        }

        const style = attachment.energyType
          ? ENERGY_STYLE[attachment.energyType]
          : SPECIAL_ENERGY_STYLE;
        const abbr = attachment.energyType
          ? ENERGY_ABBREVIATION[attachment.energyType]
          : SPECIAL_ENERGY_ABBREVIATION;

        return (
          <span
            key={`${attachment.name}-${index}`}
            role="listitem"
            title={attachment.name}
            className={`${shared} rounded-full ${style}`}
          >
            {abbr}
          </span>
        );
      })}

      {overflow > 0 && (
        <span
          role="listitem"
          title={classified.slice(MAX_VISIBLE_CHIPS).map((a) => a.name).join(', ')}
          className={`flex items-center rounded-full bg-white/95 px-1.5 font-bold leading-none text-neutral-900 ring-1 ring-black/20 ${
            large ? 'h-5 text-[10px] lg:h-6 lg:text-xs' : 'h-4 text-[9px] lg:h-5 lg:text-[10px]'
          }`}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

/** One player's active Pokemon and bench, plus their hand and discard pile. */
function PlayerRow({
  name,
  active,
  bench,
  hand,
  discardPile,
  cards,
}: {
  name: string;
  active: PokemonInPlay | null;
  bench: PokemonInPlay[];
  hand: ZoneCard[];
  discardPile: ZoneCard[];
  cards: Record<string, LookupCard>;
}) {
  const gt = useGT();

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold lg:text-sm">{name}</span>
      {/* Active sits apart from the bench so the split is structural, not just
          a size difference that disappears when the art is busy. */}
      <div className="flex flex-wrap items-end gap-4 lg:gap-6">
        {active ? (
          <CardSlot pokemon={active} card={cards[active.name]} large />
        ) : (
          <span className="text-xs text-muted-foreground">
            {gt('No active Pokemon', { $id: 'battleLogs.board.noActive' })}
          </span>
        )}
        {bench.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 lg:gap-3">
            {bench.map((pokemon, index) => (
              <CardSlot key={`${pokemon.name}-${index}`} pokemon={pokemon} card={cards[pokemon.name]} />
            ))}
          </div>
        )}
      </div>
      {(hand.length > 0 || discardPile.length > 0) && (
        <div className="flex flex-wrap items-start gap-4 lg:gap-6">
          <CardZone
            label={gt('Hand', { $id: 'battleLogs.board.hand' })}
            items={hand}
            cards={cards}
            testId="board-hand"
          />
          <CardZone
            label={gt('Discard', { $id: 'battleLogs.board.discard' })}
            items={discardPile}
            cards={cards}
            testId="board-discard"
          />
        </div>
      )}
    </div>
  );
}

export function BoardStateView({ board, cards }: BoardStateViewProps) {
  const gt = useGT();

  return (
    <div className="flex flex-col gap-3 py-2 lg:gap-6 lg:py-4" data-testid="board-state">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {gt('Board', { $id: 'battleLogs.board.title' })}
      </span>
      {Object.entries(board).map(([playerName, playerBoard]) => (
        <PlayerRow
          key={playerName}
          name={playerName}
          active={playerBoard.active}
          bench={playerBoard.bench}
          hand={playerBoard.hand ?? []}
          discardPile={playerBoard.discardPile ?? []}
          cards={cards}
        />
      ))}
    </div>
  );
}
