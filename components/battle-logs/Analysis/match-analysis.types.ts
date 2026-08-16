import type { AnalysisGrounding } from '@/lib/server/ai/battle-log-analysis/build-context';
import type { BattleLogAnalysis } from '@/lib/server/ai/battle-log-analysis/schema';
import type { AnalysisWarning } from '@/lib/server/ai/battle-log-analysis/validate';

export type AnalysisStatus = 'none' | 'pending' | 'succeeded' | 'failed';

/** The shape both GET and POST of /api/battle-logs/[id]/analysis return. */
export interface MatchAnalysisResponse {
  status: AnalysisStatus;
  analysis: BattleLogAnalysis | null;
  warnings: AnalysisWarning[];
  grounding: AnalysisGrounding | null;
  errorCode: string | null;
  /** The stored analysis no longer matches the log or decklist it was built from. */
  stale: boolean;
}

export const hasLowGrounding = (warnings: AnalysisWarning[] | undefined): boolean =>
  Boolean(warnings?.some((warning) => warning.code === 'low_grounding'));

export const droppedSuggestionCount = (warnings: AnalysisWarning[] | undefined): number =>
  warnings?.filter((warning) => warning.code === 'suggestion_dropped').length ?? 0;
