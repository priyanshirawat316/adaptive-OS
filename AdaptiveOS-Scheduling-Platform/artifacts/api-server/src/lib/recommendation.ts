import {
  algorithms,
  runAlgorithm,
  type AlgorithmId,
  type SchedulingInput,
  type SchedulingMetrics,
} from "./scheduling";

export type RecommendationObjective = "waiting" | "turnaround" | "response" | "balanced";

export type EvaluatedPolicy = {
  algorithmId: AlgorithmId;
  algorithmName: string;
  score: number;
  metrics: SchedulingMetrics;
};

export function evaluatePolicies(
  processes: SchedulingInput[],
  objective: RecommendationObjective,
  quantum: number,
): EvaluatedPolicy[] {
  const evaluations = algorithms.map((algorithm) => {
    const run = runAlgorithm(algorithm.id, processes, quantum);
    const rawObjective =
      objective === "waiting"
        ? run.metrics.averageWaitingTime
        : objective === "turnaround"
          ? run.metrics.averageTurnaroundTime
          : objective === "response"
            ? run.metrics.averageResponseTime
            : null;
    return {
      algorithmId: algorithm.id,
      algorithmName: algorithm.name,
      metrics: run.metrics,
      rawObjective,
    };
  });

  const singleMetric = objective !== "balanced";
  const balancedValues = evaluations.map((item) => [
    item.metrics.averageWaitingTime,
    item.metrics.averageTurnaroundTime,
    item.metrics.averageResponseTime,
  ]);
  const maxima = [0, 1, 2].map((index) =>
    Math.max(...balancedValues.map((value) => value[index] ?? 0)),
  );

  return evaluations
    .map((item, index) => {
      const score = singleMetric
        ? (item.rawObjective ?? 0)
        : balancedValues[index]!.reduce(
            (sum, value, metricIndex) =>
              sum +
              (maxima[metricIndex] === 0 ? 0 : value / maxima[metricIndex]),
            0,
          ) / 3;
      return {
        algorithmId: item.algorithmId,
        algorithmName: item.algorithmName,
        score,
        metrics: item.metrics,
      };
    })
    .sort((a, b) => a.score - b.score);
}

export function getObjectiveLabel(objective: RecommendationObjective): string {
  return objective === "waiting"
    ? "average waiting time"
    : objective === "turnaround"
      ? "average turnaround time"
      : objective === "response"
        ? "average response time"
        : "a normalized balance of waiting, turnaround, and response time";
}
