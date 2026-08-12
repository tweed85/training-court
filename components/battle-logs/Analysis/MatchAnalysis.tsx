'use client';

import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { T, useGT } from 'gt-react';
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import {
  droppedSuggestionCount,
  hasLowGrounding,
  type MatchAnalysisResponse,
} from './match-analysis.types';

interface MatchAnalysisProps {
  logId: string;
}

const fetchAnalysis = async (logId: string): Promise<MatchAnalysisResponse> => {
  const response = await fetch(`/api/battle-logs/${logId}/analysis`);
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
};

const CONFIDENCE_STYLES: Record<string, string> = {
  low: 'text-muted-foreground',
  medium: 'text-foreground',
  high: 'text-foreground font-medium',
};

export const MatchAnalysis = ({ logId }: MatchAnalysisProps) => {
  const gt = useGT();
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);

  const { data, isLoading, mutate } = useSWR(['battle-log-analysis', logId], () =>
    fetchAnalysis(logId)
  );

  const handleGenerate = useCallback(async () => {
    // The unique index on (log_id, cache_key) makes a duplicate POST harmless,
    // but there is no reason to fire one.
    if (isGenerating) return;
    setIsGenerating(true);

    try {
      const response = await fetch(`/api/battle-logs/${logId}/analysis`, { method: 'POST' });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toast({
          variant: 'destructive',
          title: gt('Could not analyze this match', { $id: 'battleLogs.analysis.errorTitle' }),
          description: describeError(body?.error, gt),
        });
        return;
      }

      await mutate();
    } catch {
      toast({
        variant: 'destructive',
        title: gt('Could not analyze this match', { $id: 'battleLogs.analysis.errorTitle' }),
        description: gt('Please try again.', { $id: 'common.pleaseTryAgain' }),
      });
    } finally {
      setIsGenerating(false);
    }
  }, [gt, isGenerating, logId, mutate, toast]);

  if (isLoading) return null;

  const analysis = data?.analysis ?? null;
  const showEmptyState = !analysis || data?.status === 'failed';

  return (
    <Card data-testid="match-analysis">
      <CardHeader className="flex flex-row justify-between items-center">
        <T id="battleLogs.analysis.title">
          <CardTitle>Match Analysis</CardTitle>
        </T>
        <Button
          size="sm"
          variant={analysis ? 'ghost' : 'default'}
          onClick={handleGenerate}
          disabled={isGenerating}
          data-testid="match-analysis-generate"
        >
          {isGenerating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {analysis
            ? gt('Regenerate', { $id: 'battleLogs.analysis.regenerate' })
            : gt('Analyze', { $id: 'battleLogs.analysis.analyze' })}
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {isGenerating && !analysis && (
          <div className="flex flex-col gap-2" data-testid="match-analysis-skeleton">
            <Skeleton className="w-full h-[24px] rounded-xl" />
            <Skeleton className="w-full h-[68px] rounded-xl" />
            <Skeleton className="w-full h-[68px] rounded-xl" />
          </div>
        )}

        {showEmptyState && !isGenerating && (
          <T id="battleLogs.analysis.emptyState">
            <CardDescription>
              Get a turn-by-turn read on this match, including plays worth revisiting and cards worth
              trying.
            </CardDescription>
          </T>
        )}

        {data?.stale && analysis && (
          <T id="battleLogs.analysis.stale">
            <CardDescription className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
              Your deck or this log changed since this was written. Regenerate for current advice.
            </CardDescription>
          </T>
        )}

        {hasLowGrounding(data?.warnings) && (
          <T id="battleLogs.analysis.lowGrounding">
            <CardDescription className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
              Several cards in this analysis could not be verified against the card database. Read it
              with caution.
            </CardDescription>
          </T>
        )}

        {analysis && (
          <div className={analysis && data?.stale ? 'opacity-60' : undefined}>
            <AnalysisBody analysis={analysis} />
          </div>
        )}

        {analysis && droppedSuggestionCount(data?.warnings) > 0 && (
          <p className="text-xs text-muted-foreground">
            {gt('Some suggestions were withheld because they referenced cards you did not have.', {
              $id: 'battleLogs.analysis.droppedSuggestions',
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

function AnalysisBody({ analysis }: { analysis: NonNullable<MatchAnalysisResponse['analysis']> }) {
  const gt = useGT();

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-1">
        <h3 className="font-semibold">{analysis.matchSummary.headline}</h3>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
          {analysis.matchSummary.narrative}
        </p>
      </section>

      {analysis.turningPoints.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">
            {gt('Turning points', { $id: 'battleLogs.analysis.turningPoints' })}
          </h4>
          {analysis.turningPoints.map((point, index) => (
            <div key={`${point.turnNumber}-${index}`} className="text-sm">
              <span className="font-medium">
                {gt('Turn', { $id: 'battleLogs.analysis.turn' })} {point.turnNumber}
              </span>
              <p className="text-muted-foreground">{point.whatHappened}</p>
              <p className="text-muted-foreground">{point.whyItMattered}</p>
            </div>
          ))}
        </section>
      )}

      {analysis.tacticalSuggestions.length > 0 && (
        <section className="flex flex-col gap-3" data-testid="tactical-suggestions">
          <h4 className="text-sm font-semibold">
            {gt('Plays worth revisiting', { $id: 'battleLogs.analysis.tactical' })}
          </h4>
          {analysis.tacticalSuggestions.map((suggestion, index) => (
            <div key={`${suggestion.turnNumber}-${index}`} className="text-sm flex flex-col gap-1">
              <span className="font-medium">
                {gt('Turn', { $id: 'battleLogs.analysis.turn' })} {suggestion.turnNumber}
              </span>
              <p className="text-muted-foreground">{suggestion.actualPlay}</p>
              <p className={CONFIDENCE_STYLES[suggestion.confidence]}>{suggestion.suggestedPlay}</p>
              <p className="text-muted-foreground text-xs">{suggestion.rationale}</p>
              {suggestion.requiresSearchOrDraw && (
                <span className="text-xs text-muted-foreground italic">
                  {gt('Depends on finding the card that turn.', {
                    $id: 'battleLogs.analysis.requiresSearch',
                  })}
                </span>
              )}
            </div>
          ))}
        </section>
      )}

      {analysis.deckSuggestions.length > 0 && (
        <section className="flex flex-col gap-3" data-testid="deck-suggestions">
          <h4 className="text-sm font-semibold">
            {gt('Deck changes to consider', { $id: 'battleLogs.analysis.deck' })}
          </h4>
          {analysis.deckSuggestions.map((suggestion, index) => (
            <div key={index} className="text-sm flex flex-col gap-1">
              <p className="font-medium">{formatDeckChange(suggestion)}</p>
              <p className="text-muted-foreground text-xs">{suggestion.rationale}</p>
            </div>
          ))}
        </section>
      )}

      {analysis.notEnoughInformation && (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <AlertTriangle className="h-3 w-3" />
          {gt('This log did not contain enough detail for confident advice.', {
            $id: 'battleLogs.analysis.notEnoughInfo',
          })}
        </p>
      )}
    </div>
  );
}

/** "-1 Nest Ball → +1 Dusknoir", or just one side for a pure add or cut. */
function formatDeckChange(suggestion: {
  cardsIn: { name: string; count: number }[];
  cardsOut: { name: string; count: number }[];
}): string {
  const out = suggestion.cardsOut.map((c) => `-${c.count} ${c.name}`).join(', ');
  const added = suggestion.cardsIn.map((c) => `+${c.count} ${c.name}`).join(', ');
  return [out, added].filter(Boolean).join(' → ');
}

function describeError(code: string | undefined, gt: ReturnType<typeof useGT>): string {
  switch (code) {
    case 'screen_name_missing':
      return gt('Set your PTCG Live screen name in preferences first.', {
        $id: 'battleLogs.analysis.error.screenName',
      });
    case 'screen_name_mismatch':
      return gt('You do not appear as a player in this battle log.', {
        $id: 'battleLogs.analysis.error.notAParticipant',
      });
    case 'unparseable_log':
      return gt('We could not read this battle log format.', {
        $id: 'battleLogs.analysis.error.unparseable',
      });
    case 'insufficient_grounding':
      return gt('Link a decklist to analyze a non-English battle log.', {
        $id: 'battleLogs.analysis.error.grounding',
      });
    case 'ai_disabled':
      return gt('Match analysis is temporarily unavailable.', {
        $id: 'battleLogs.analysis.error.disabled',
      });
    case 'gateway_rate_limited':
      return gt('Too many requests right now. Try again shortly.', {
        $id: 'battleLogs.analysis.error.rateLimited',
      });
    default:
      return gt('Please try again.', { $id: 'common.pleaseTryAgain' });
  }
}
