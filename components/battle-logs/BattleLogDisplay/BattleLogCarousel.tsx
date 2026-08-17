'use client';

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { BattleLog, BattleLogTurn } from "../utils/battle-log.types"
import { cn } from "@/lib/utils";
import { BattleLogDetectedStrings } from "@/lib/i18n/battle-log"
import { deriveBoardStates } from "../utils/board-state"
import { BoardStateView } from "../Board/BoardStateView"
import { useCardLookup } from "../Board/useCardLookup"

interface BattleLogCarouselProps {
  battleLog: BattleLog;
}

export function BattleLogCarousel(props: BattleLogCarouselProps) {
    // Empty for non-English logs: the board grammar is English-only, and a
    // wrong board is worse than none.
    const boards = React.useMemo(
      () => deriveBoardStates(props.battleLog),
      [props.battleLog]
    );

    const cardNames = React.useMemo(() => {
      const names = new Set<string>();
      for (const board of boards) {
        for (const player of Object.values(board)) {
          if (player.active && !player.active.unknown) names.add(player.active.name);
          for (const benched of player.bench) {
            if (!benched.unknown) names.add(benched.name);
          }
          for (const name of player.hand.known) names.add(name);
          for (const name of player.discard.known) names.add(name);
        }
      }
      return Array.from(names);
    }, [boards]);

    const cards = useCardLookup(cardNames);

    function getCardBackgroundColor(index: number, section: BattleLogTurn): string | undefined {
        if (index % 2 == 0 && !section.turnTitle.includes(BattleLogDetectedStrings[props.battleLog.language].setup)) {
            return 'bg-blue-100 dark:bg-blue-900';
          } else if (index % 2 == 1 && !section.turnTitle.includes(BattleLogDetectedStrings[props.battleLog.language].setup)) {
            return 'bg-red-100 dark:bg-red-900';
          }
          return 'bg-gray-100 dark:bg-gray-900';
    }

  return (
    <div className="flex flex-col gap-4">
        {props.battleLog.sections.map((section, index) => (
          <Card className={` ${getCardBackgroundColor(index, section)}`}>
            <CardHeader>
              <CardTitle className="dark:text-white">{section.turnTitle}</CardTitle>
              {index > 0 && (
                <CardDescription>
                  {Object.entries(section.prizesAfterTurn).map(([playerName, prizesRemaining]) => {
                    const previousPrizesOfThisPlayer = props.battleLog.sections[index - 1].prizesAfterTurn[playerName];
                    const prizesThisPlayerHasTaken = (index === 0) ? 0 : previousPrizesOfThisPlayer - section.prizesAfterTurn[playerName];

                    return (
                      <span className={cn(
                        (prizesThisPlayerHasTaken > 0) && 'font-bold'
                      )}>{playerName}: {((section.player === playerName || prizesThisPlayerHasTaken > 0) && `${previousPrizesOfThisPlayer} → `)}{prizesRemaining} prize{prizesRemaining !== 1 && 's'}<br /></span>
                    )
                  })}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {boards[index] && <BoardStateView board={boards[index]} cards={cards} />}
              {section.actions.map((action) => action.details.length === 0 ? (
                <p className="py-1">{action.title}</p>
              ) : (
                <Accordion type="single" collapsible>
                  <AccordionItem value="item-1">
                    <AccordionTrigger className="px-0 py-1 text-left">{action.title}</AccordionTrigger>
                    <AccordionContent>
                      {action.details.map((detail) => <p>{detail}<br /></p>)}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              ))}
            </CardContent>
          </Card>
        ))}
    </div>
  )
}
