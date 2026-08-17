'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useGT } from 'gt-react';
import type { Zone } from '../utils/zone';
import type { LookupCard } from '@/app/api/ptcg/cards/lookup/route';
import { ZoneCards } from './ZoneCards';

/** Enough to see what just went to the pile without dwarfing the board above. */
const COLLAPSED_LIMIT = 5;

export function DiscardPile({ zone, cards }: { zone: Zone; cards: Record<string, LookupCard> }) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);

  if (zone.size === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        data-testid="discard-toggle"
        aria-expanded={expanded}
        className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {gt('Discard', { $id: 'battleLogs.board.discard' })} ({zone.size})
      </button>
      <ZoneCards zone={zone} cards={cards} limit={expanded ? undefined : COLLAPSED_LIMIT} />
    </div>
  );
}
