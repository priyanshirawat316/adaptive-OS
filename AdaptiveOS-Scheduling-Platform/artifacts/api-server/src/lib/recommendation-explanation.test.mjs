import assert from "node:assert/strict";
import test from "node:test";
import { buildRecommendationExplanationPrompt } from "./recommendation-explanation.ts";

const metrics = {
  averageWaitingTime: 2,
  averageTurnaroundTime: 6,
  averageResponseTime: 1,
  cpuUtilization: 100,
  throughput: 0.5,
  totalDuration: 10,
};

test("explanation prompt contains comparison metrics but omits snapshot metadata", () => {
  const prompt = buildRecommendationExplanationPrompt({
    objective: "balanced",
    selectedPolicy: "Shortest Job First",
    processCount: 3,
    evaluations: [
      { algorithmId: "SJF", algorithmName: "Shortest Job First", score: 0.5, metrics },
    ],
    workloadName: "Personal laptop session",
    snapshotId: 9876,
    processIds: ["private-pid-1"],
  });

  assert.match(prompt, /averageWaitingTime/);
  assert.match(prompt, /Shortest Job First/);
  assert.match(prompt, /simulation outputs/);
  assert.doesNotMatch(prompt, /Personal laptop session|9876|private-pid-1/);
});

test("explanation prompt explicitly restricts the model to the deterministic result", () => {
  const prompt = buildRecommendationExplanationPrompt({
    objective: "waiting",
    selectedPolicy: "First-Come, First-Served",
    processCount: 1,
    evaluations: [],
  });

  assert.match(prompt, /selected policy is fixed by a deterministic rule/);
  assert.match(prompt, /never describe them as measurements of real OS scheduling/);
});
