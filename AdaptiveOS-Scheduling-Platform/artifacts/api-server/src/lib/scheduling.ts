export type SchedulingInput = {
  pid: string;
  arrivalTime: number;
  burstTime: number;
  priority: number;
  memoryMb: number;
};

export type SchedulingMetrics = {
  averageWaitingTime: number;
  averageTurnaroundTime: number;
  averageResponseTime: number;
  cpuUtilization: number;
  throughput: number;
  totalDuration: number;
};

export type SchedulingProcessResult = SchedulingInput & {
  startTime: number;
  completionTime: number;
  waitingTime: number;
  turnaroundTime: number;
  responseTime: number;
};

export type TimelineSegment = {
  pid: string;
  start: number;
  end: number;
  kind: "process" | "idle";
};

export type AlgorithmId =
  | "FCFS"
  | "SJF"
  | "SRTF"
  | "PRIORITY"
  | "ROUND_ROBIN";

export type ScheduleResult = {
  metrics: SchedulingMetrics;
  processes: SchedulingProcessResult[];
  timeline: TimelineSegment[];
};

export const algorithms: Array<{
  id: AlgorithmId;
  name: string;
  description: string;
  preemptive: boolean;
  configurable: boolean;
}> = [
  {
    id: "FCFS",
    name: "First-Come, First-Served",
    description: "Runs processes in arrival order without preemption.",
    preemptive: false,
    configurable: false,
  },
  {
    id: "SJF",
    name: "Shortest Job First",
    description: "Runs the shortest available CPU burst first.",
    preemptive: false,
    configurable: false,
  },
  {
    id: "SRTF",
    name: "Shortest Remaining Time First",
    description: "Preempts when a process arrives with less remaining work.",
    preemptive: true,
    configurable: false,
  },
  {
    id: "PRIORITY",
    name: "Priority Scheduling",
    description: "Runs the available process with the lowest priority number.",
    preemptive: false,
    configurable: false,
  },
  {
    id: "ROUND_ROBIN",
    name: "Round Robin",
    description: "Shares the CPU in configurable time slices.",
    preemptive: true,
    configurable: true,
  },
];

type Job = {
  input: SchedulingInput;
  inputIndex: number;
  remaining: number;
  firstStart: number | null;
  completion: number | null;
};

const EPSILON = 1e-9;

function createJobs(processes: SchedulingInput[]): Job[] {
  if (processes.length === 0) {
    throw new Error("A workload must contain at least one process.");
  }

  const pids = new Set<string>();
  for (const process of processes) {
    if (!process.pid.trim() || pids.has(process.pid)) {
      throw new Error("Process IDs must be non-empty and unique.");
    }
    if (
      !Number.isFinite(process.arrivalTime) ||
      process.arrivalTime < 0 ||
      !Number.isFinite(process.burstTime) ||
      process.burstTime <= 0 ||
      !Number.isFinite(process.priority) ||
      !Number.isFinite(process.memoryMb) ||
      process.memoryMb < 0
    ) {
      throw new Error(`Process ${process.pid} has invalid scheduling values.`);
    }
    pids.add(process.pid);
  }

  return processes.map((input, inputIndex) => ({
    input,
    inputIndex,
    remaining: input.burstTime,
    firstStart: null,
    completion: null,
  }));
}

function byArrivalThenInput(a: Job, b: Job): number {
  return (
    a.input.arrivalTime - b.input.arrivalTime || a.inputIndex - b.inputIndex
  );
}

function appendSegment(
  timeline: TimelineSegment[],
  pid: string,
  start: number,
  end: number,
  kind: TimelineSegment["kind"],
): void {
  if (end - start <= EPSILON) return;
  const last = timeline[timeline.length - 1];
  if (last && last.pid === pid && last.kind === kind && last.end === start) {
    last.end = end;
    return;
  }
  timeline.push({ pid, start, end, kind });
}

function finish(jobs: Job[], timeline: TimelineSegment[]): ScheduleResult {
  const results = jobs.map((job) => {
    const completionTime = job.completion;
    const startTime = job.firstStart;
    if (completionTime === null || startTime === null) {
      throw new Error(`Process ${job.input.pid} did not complete.`);
    }
    const turnaroundTime = completionTime - job.input.arrivalTime;
    return {
      ...job.input,
      startTime,
      completionTime,
      turnaroundTime,
      waitingTime: Math.max(0, turnaroundTime - job.input.burstTime),
      responseTime: Math.max(0, startTime - job.input.arrivalTime),
    };
  });

  const totalDuration = timeline.at(-1)?.end ?? 0;
  const busyTime = results.reduce((sum, process) => sum + process.burstTime, 0);
  const count = results.length;
  const sum = (key: "waitingTime" | "turnaroundTime" | "responseTime") =>
    results.reduce((value, process) => value + process[key], 0) / count;

  return {
    metrics: {
      averageWaitingTime: sum("waitingTime"),
      averageTurnaroundTime: sum("turnaroundTime"),
      averageResponseTime: sum("responseTime"),
      cpuUtilization:
        totalDuration <= EPSILON ? 0 : (busyTime / totalDuration) * 100,
      throughput: totalDuration <= EPSILON ? 0 : count / totalDuration,
      totalDuration,
    },
    processes: results,
    timeline,
  };
}

function runNonPreemptive(
  input: SchedulingInput[],
  choose: (ready: Job[]) => Job,
): ScheduleResult {
  const jobs = createJobs(input);
  const timeline: TimelineSegment[] = [];
  const sorted = [...jobs].sort(byArrivalThenInput);
  let completed = 0;
  let time = 0;

  while (completed < jobs.length) {
    const ready = jobs.filter(
      (job) =>
        job.completion === null &&
        job.input.arrivalTime <= time + EPSILON,
    );
    if (ready.length === 0) {
      const next = sorted.find((job) => job.completion === null);
      if (!next) break;
      const nextTime = Math.max(time, next.input.arrivalTime);
      appendSegment(timeline, "IDLE", time, nextTime, "idle");
      time = nextTime;
      continue;
    }

    const job = choose(ready);
    job.firstStart ??= time;
    const end = time + job.remaining;
    appendSegment(timeline, job.input.pid, time, end, "process");
    time = end;
    job.remaining = 0;
    job.completion = time;
    completed += 1;
  }

  return finish(jobs, timeline);
}

export function runFcfs(processes: SchedulingInput[]): ScheduleResult {
  return runNonPreemptive(processes, (ready) =>
    ready.sort(byArrivalThenInput)[0]!,
  );
}

export function runSjf(processes: SchedulingInput[]): ScheduleResult {
  return runNonPreemptive(
    processes,
    (ready) =>
      ready.sort(
        (a, b) =>
          a.input.burstTime - b.input.burstTime || byArrivalThenInput(a, b),
      )[0]!,
  );
}

export function runPriority(processes: SchedulingInput[]): ScheduleResult {
  return runNonPreemptive(
    processes,
    (ready) =>
      ready.sort(
        (a, b) =>
          a.input.priority - b.input.priority || byArrivalThenInput(a, b),
      )[0]!,
  );
}

export function runSrtf(processes: SchedulingInput[]): ScheduleResult {
  const jobs = createJobs(processes);
  const timeline: TimelineSegment[] = [];
  const arrivals = [...jobs].sort(byArrivalThenInput);
  let time = 0;
  let completed = 0;

  while (completed < jobs.length) {
    const ready = jobs
      .filter(
        (job) =>
          job.completion === null &&
          job.input.arrivalTime <= time + EPSILON &&
          job.remaining > EPSILON,
      )
      .sort(
        (a, b) =>
          a.remaining - b.remaining || byArrivalThenInput(a, b),
      );

    if (ready.length === 0) {
      const next = arrivals.find(
        (job) => job.completion === null && job.input.arrivalTime > time + EPSILON,
      );
      if (!next) break;
      const nextTime = next.input.arrivalTime;
      appendSegment(timeline, "IDLE", time, nextTime, "idle");
      time = nextTime;
      continue;
    }

    const job = ready[0]!;
    job.firstStart ??= time;
    const nextArrival = arrivals.find(
      (candidate) => candidate.input.arrivalTime > time + EPSILON,
    )?.input.arrivalTime;
    const end = Math.min(
      time + job.remaining,
      nextArrival ?? Number.POSITIVE_INFINITY,
    );
    const ranFor = end - time;
    appendSegment(timeline, job.input.pid, time, end, "process");
    job.remaining = Math.max(0, job.remaining - ranFor);
    time = end;
    if (job.remaining <= EPSILON) {
      job.remaining = 0;
      job.completion = time;
      completed += 1;
    }
  }

  return finish(jobs, timeline);
}

export function runRoundRobin(
  processes: SchedulingInput[],
  quantum = 2,
): ScheduleResult {
  if (!Number.isFinite(quantum) || quantum <= 0) {
    throw new Error("Round Robin quantum must be greater than zero.");
  }
  const jobs = createJobs(processes);
  const arrivals = [...jobs].sort(byArrivalThenInput);
  const timeline: TimelineSegment[] = [];
  const ready: Job[] = [];
  let nextArrivalIndex = 0;
  let completed = 0;
  let time = 0;

  while (completed < jobs.length) {
    while (
      nextArrivalIndex < arrivals.length &&
      arrivals[nextArrivalIndex]!.input.arrivalTime <= time + EPSILON
    ) {
      ready.push(arrivals[nextArrivalIndex]!);
      nextArrivalIndex += 1;
    }

    const job = ready.shift();
    if (!job) {
      const next = arrivals[nextArrivalIndex];
      if (!next) break;
      const nextTime = Math.max(time, next.input.arrivalTime);
      appendSegment(timeline, "IDLE", time, nextTime, "idle");
      time = nextTime;
      continue;
    }

    job.firstStart ??= time;
    const runFor = Math.min(quantum, job.remaining);
    const end = time + runFor;
    appendSegment(timeline, job.input.pid, time, end, "process");
    time = end;
    job.remaining = Math.max(0, job.remaining - runFor);

    while (
      nextArrivalIndex < arrivals.length &&
      arrivals[nextArrivalIndex]!.input.arrivalTime <= time + EPSILON
    ) {
      ready.push(arrivals[nextArrivalIndex]!);
      nextArrivalIndex += 1;
    }

    if (job.remaining <= EPSILON) {
      job.remaining = 0;
      job.completion = time;
      completed += 1;
    } else {
      ready.push(job);
    }
  }

  return finish(jobs, timeline);
}

export function runAlgorithm(
  algorithmId: string,
  processes: SchedulingInput[],
  quantum = 2,
): ScheduleResult {
  switch (algorithmId) {
    case "FCFS":
      return runFcfs(processes);
    case "SJF":
      return runSjf(processes);
    case "SRTF":
      return runSrtf(processes);
    case "PRIORITY":
      return runPriority(processes);
    case "ROUND_ROBIN":
      return runRoundRobin(processes, quantum);
    default:
      throw new Error(`Unsupported scheduling algorithm: ${algorithmId}`);
  }
}
