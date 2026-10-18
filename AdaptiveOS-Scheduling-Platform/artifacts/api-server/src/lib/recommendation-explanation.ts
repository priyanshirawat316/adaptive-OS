import type { EvaluatedPolicy, RecommendationObjective } from "./recommendation";

type ExplanationPromptInput = {
  objective: RecommendationObjective;
  selectedPolicy: string;
  processCount: number;
  evaluations: EvaluatedPolicy[];
  roundRobinQuantum?: number;
};

export function isAiExplanationConfigured(): boolean {
  return Boolean(
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim() &&
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim(),
  );
}

export function buildRecommendationExplanationPrompt(
  input: ExplanationPromptInput,
): string {
  const summary = {
    objective: input.objective,
    selectedPolicy: input.selectedPolicy,
    processCount: input.processCount,
    ...(input.roundRobinQuantum === undefined
      ? {}
      : { roundRobinQuantum: input.roundRobinQuantum }),
    policiesCompared: input.evaluations.map(({ algorithmName, metrics }) => ({
      policy: algorithmName,
      metrics: {
        averageWaitingTime: metrics.averageWaitingTime,
        averageTurnaroundTime: metrics.averageTurnaroundTime,
        averageResponseTime: metrics.averageResponseTime,
        cpuUtilization: metrics.cpuUtilization,
        throughput: metrics.throughput,
        totalDuration: metrics.totalDuration,
      },
    })),
  };

  return [
    "Explain the scheduler comparison to an operating-systems student in 2–4 plain-language sentences, at most 100 words.",
    "The selected policy is fixed by a deterministic rule; do not change or second-guess the recommendation.",
    "Include at least two exact numeric metrics for the selected policy, using simulation time units where relevant, and explain its tradeoff compared with the other policies.",
    "These are simulation outputs (or estimates when the input came from an observation); never describe them as measurements of real OS scheduling.",
    "Use only the supplied summary. Do not infer workload identity, process details, computer details, or facts not present in it.",
    `Comparison summary: ${JSON.stringify(summary)}`,
  ].join("\n");
}
