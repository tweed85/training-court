'use client';

import Image from 'next/image';
import { useGT } from 'gt-react';
import type { Zone } from '../utils/zone';
import { unknownCount } from '../utils/zone';
import type { LookupCard } from '@/app/api/ptcg/cards/lookup/route';

const INTRINSIC_WIDTH = 292;
const INTRINSIC_HEIGHT = 408;
const CARD_SHAPE = 'aspect-[63/88] rounded-md';
const SLOT = 'w-12 lg:w-14 xl:w-16';

interface ZoneCardsProps {
  zone: Zone;
  cards: Record<string, LookupCard>;
  /** Render at most this many cards. Unset renders the whole zone. */
  limit?: number;
}

/**
 * A hand or discard pile: named cards as art, the rest as labelled placeholders.
 *
 * The placeholder count is the zone's own arithmetic — `size` minus the cards we
 * could name — so an identity we failed to track shows up as one more face-down
 * card rather than a wrong one.
 */
export function ZoneCards({ zone, cards, limit }: ZoneCardsProps) {
  const gt = useGT();
  if (zone.size === 0) return null;

  const cap = limit ?? zone.size;
  const known = zone.known.slice(0, cap);
  const unknown = Math.max(0, Math.min(unknownCount(zone), cap - known.length));

  return (
    <div className="flex flex-wrap items-end gap-1 lg:gap-1.5">
      {known.map((name, index) => {
        const card = cards[name];
        return (
          <div key={`${name}-${index}`} className={SLOT} title={name}>
            {card?.imageUrl ? (
              <Image
                src={card.imageUrl}
                alt={name}
                width={INTRINSIC_WIDTH}
                height={INTRINSIC_HEIGHT}
                sizes="64px"
                className={`h-auto w-full ${CARD_SHAPE} object-cover`}
              />
            ) : (
              <div
                className={`w-full ${CARD_SHAPE} flex items-center justify-center border bg-muted p-0.5 text-center text-[8px] leading-tight`}
              >
                {name}
              </div>
            )}
          </div>
        );
      })}

      {Array.from({ length: unknown }, (_, index) => (
        <div
          key={`unknown-${index}`}
          data-testid="zone-unknown-card"
          className={`${SLOT} ${CARD_SHAPE} flex items-center justify-center border border-dashed border-muted-foreground/40 bg-muted/40 text-[7px] font-medium uppercase tracking-wide text-muted-foreground lg:text-[8px]`}
        >
          {gt('Unknown', { $id: 'battleLogs.board.unknown' })}
        </div>
      ))}
    </div>
  );
}
