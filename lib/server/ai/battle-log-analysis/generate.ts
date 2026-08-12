import { generateText, Output } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { ANALYSIS_MODEL } from './cache-key';
import { ANALYSIS_SYSTEM_PROMPT } from './prompt';
import { battleLogAnalysisSchema, type BattleLogAnalysis } from './schema';

export interface GenerateResult {
  analysis: BattleLogAnalysis;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

/**
 * Cost ceiling for a single call. Combined with the input character budget in
 * compact-log.ts this bounds the price of any one analysis to a known number.
 *
 * This must leave room for the WHOLE response. A real 15-turn log fills roughly
 * 1.7k tokens of structured output, so 8k is comfortable headroom.
 */
const MAX_OUTPUT_TOKENS = 8000;

/**
 * ai@7 routes structured output through `generateText` + `Output.object`;
 * the old `generateObject` helper is deprecated. Note `instructions` rather than
 * `system` — also a v7 rename.
 *
 * The provider is Anthropic directly (ANTHROPIC_API_KEY) rather than the Vercel
 * AI Gateway, so there is no bare `"provider/model"` string here. That means no
 * gateway-level spend cap either — set usage limits in the Anthropic console.
 */
export async function generateAnalysis(
  userPrompt: string,
  signal: AbortSignal
): Promise<GenerateResult> {
  const started = Date.now();

  const { output, usage } = await generateText({
    model: anthropic(ANALYSIS_MODEL),
    output: Output.object({
      schema: battleLogAnalysisSchema,
      name: 'BattleLogAnalysis',
      description: 'A grounded coaching review of one Pokemon TCG match.',
    }),
    instructions: ANALYSIS_SYSTEM_PROMPT,
    prompt: userPrompt,
    // No `temperature`: claude-sonnet-5 does not support it, and passing it
    // makes the AI SDK log a warning on every single call.
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    // Extended thinking is ON by default for this model and its reasoning
    // tokens are drawn from maxOutputTokens. Left enabled, it burned the entire
    // budget before emitting any structured output and every call failed with
    // NoOutputGeneratedError. Measured on a real 15-turn log: thinking on
    // needed ~24.5k output tokens to succeed; thinking off produced an
    // equally grounded analysis in ~1.7k. Keep it disabled.
    providerOptions: { anthropic: { thinking: { type: 'disabled' } } },
    maxRetries: 1,
    abortSignal: signal,
  });

  return {
    analysis: output,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    latencyMs: Date.now() - started,
  };
}
