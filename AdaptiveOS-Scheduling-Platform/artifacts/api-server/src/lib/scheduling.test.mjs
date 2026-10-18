import assert from "node:assert/strict";
import test from "node:test";
import { runAlgorithm } from "./scheduling.ts";

const workload = [
  { pid: "P1", arrivalTime: 0, burstTime: 5, priority: 2, memoryMb: 64 },
  { pid: "P2", arrivalTime: 1, burstTime: 3, priority: 1, memoryMb: 128 },
  { pid: "P3", arrivalTime: 2, burstTime: 1, priority: 3, memoryMb: 32 },
];

test("all supported schedulers complete the same input workload", () => {
  for (const algorithm of ["FCFS", "SJF", "SRTF", "PRIORITY", "ROUND_ROBIN"]) {
    const result = runAlgorithm(algorithm, workload, 2);
    assert.equal(result.processes.length, workload.length);
    assert.equal(result.processes.every((process) => process.completionTime > 0), true);
    assert.equal(result.metrics.cpuUtilization, 100);
    assert.ok(result.timeline.every((segment) => segment.end > segment.start));
  }
});

test("SRTF preempts the running process for a shorter remaining job", () => {
  const result = runAlgorithm("SRTF", workload);
  assert.deepEqual(
    result.timeline.map(({ pid, start, end }) => [pid, start, end]),
    [
      ["P1", 0, 1],
      ["P2", 1, 2],
      ["P3", 2, 3],
      ["P2", 3, 5],
      ["P1", 5, 9],
    ],
  );
  assert.equal(result.metrics.averageWaitingTime, 5 / 3);
  assert.equal(result.metrics.averageTurnaroundTime, 14 / 3);
});

test("non-preemptive SJF chooses the shortest process already available", () => {
  const result = runAlgorithm("SJF", workload);
  assert.deepEqual(
    result.timeline.map(({ pid, start, end }) => [pid, start, end]),
    [
      ["P1", 0, 5],
      ["P3", 5, 6],
      ["P2", 6, 9],
    ],
  );
  assert.equal(result.processes.find((process) => process.pid === "P3")?.responseTime, 3);
});

test("Round Robin respects its quantum and arrival ordering", () => {
  const result = runAlgorithm("ROUND_ROBIN", workload, 2);
  assert.deepEqual(
    result.timeline.map(({ pid, start, end }) => [pid, start, end]),
    [
      ["P1", 0, 2],
      ["P2", 2, 4],
      ["P3", 4, 5],
      ["P1", 5, 7],
      ["P2", 7, 8],
      ["P1", 8, 9],
    ],
  );
});

test("idle time is visible and included in duration and utilization", () => {
  const result = runAlgorithm("FCFS", [
    { pid: "late", arrivalTime: 4, burstTime: 2, priority: 0, memoryMb: 0 },
  ]);
  assert.deepEqual(result.timeline, [
    { pid: "IDLE", start: 0, end: 4, kind: "idle" },
    { pid: "late", start: 4, end: 6, kind: "process" },
  ]);
  assert.equal(result.metrics.totalDuration, 6);
  assert.ok(Math.abs(result.metrics.cpuUtilization - 100 / 3) < 1e-9);
  assert.equal(result.metrics.throughput, 1 / 6);
});

test("invalid quantum and duplicate process IDs are rejected", () => {
  assert.throws(() => runAlgorithm("ROUND_ROBIN", workload, 0), /quantum/i);
  assert.throws(
    () => runAlgorithm("FCFS", [workload[0], { ...workload[1], pid: "P1" }]),
    /unique/i,
  );
});
