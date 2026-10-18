import {
  CreateAgentSnapshotBody,
  CreateAgentSnapshotResponse,
  CreateAgentWorkloadBody,
  CreateAgentWorkloadResponse,
  CreateRecommendationBody,
  CreateRecommendationExplanationBody,
  CreateRecommendationExplanationResponse,
  CreateRecommendationResponse,
  CreateWorkloadBody,
  CreateWorkloadResponse,
  DeleteAgentSnapshotParams,
  DeleteWorkloadParams,
  GetAnalyticsQueryParams,
  GetAnalyticsResponse,
  GetAgentHealthResponse,
  GetDashboardResponse,
  GetSimulationParams,
  GetSimulationResponse,
  GetWorkloadParams,
  GetWorkloadResponse,
  ImportWorkloadCsvBody,
  ImportWorkloadCsvResponse,
  ListAgentSnapshotsResponse,
  ListAlgorithmsResponse,
  ListSimulationsQueryParams,
  ListSimulationsResponse,
  ListWorkloadsResponse,
  RunSimulationsBody,
  RunSimulationsResponse,
} from "@workspace/api-zod";
import {
  agentSnapshotsTable,
  db,
  sharedMetricsTable,
  processesTable,
  recommendationsTable,
  simulationsTable,
  workloadsTable,
} from "@workspace/db";
import { count, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import OpenAI from "openai";
import {
  algorithms,
  runAlgorithm,
  runFcfs,
  runPriority,
  runRoundRobin,
  runSjf,
  runSrtf,
  type AlgorithmId,
  type SchedulingInput,
} from "../lib/scheduling";
import {
  evaluatePolicies,
  getObjectiveLabel,
} from "../lib/recommendation";
import {
  buildRecommendationExplanationPrompt,
  isAiExplanationConfigured,
} from "../lib/recommendation-explanation";

const router: IRouter = Router();

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

function asIso(value: Date): string {
  return value.toISOString();
}

function parseIntegerParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function getWorkloadRecord(workloadId: number) {
  const [workload] = await db
    .select()
    .from(workloadsTable)
    .where(eq(workloadsTable.id, workloadId));
  if (!workload) return null;
  const processes = await db
    .select()
    .from(processesTable)
    .where(eq(processesTable.workloadId, workloadId))
    .orderBy(processesTable.id);
  return {
    ...workload,
    processes: processes.map((process) => ({
      id: process.id,
      pid: process.pid,
      arrivalTime: process.arrivalTime,
      burstTime: process.burstTime,
      priority: process.priority,
      memoryMb: process.memoryMb,
    })),
  };
}

function workloadDto(
  workload: NonNullable<Awaited<ReturnType<typeof getWorkloadRecord>>>,
) {
  return {
    id: workload.id,
    name: workload.name,
    description: workload.description,
    source: workload.source,
    profile: workload.profile,
    seed: workload.seed,
    snapshotId: workload.snapshotId,
    createdAt: asIso(workload.createdAt),
    processes: workload.processes,
  };
}

async function createWorkload(
  input: {
    name: string;
    description?: string;
    source: string;
    profile: string;
    seed?: number | null;
    snapshotId?: number | null;
    processes: SchedulingInput[];
  },
) {
  const pidSet = new Set<string>();
  for (const process of input.processes) {
    if (pidSet.has(process.pid)) {
      throw new Error(`Duplicate process ID: ${process.pid}`);
    }
    pidSet.add(process.pid);
  }
  runAlgorithm("FCFS", input.processes);

  const workload = await db.transaction(async (tx) => {
    const [workload] = await tx
      .insert(workloadsTable)
      .values({
        name: input.name,
        description: input.description ?? null,
        source: input.source,
        profile: input.profile,
        seed: input.seed ?? null,
        snapshotId: input.snapshotId ?? null,
      })
      .returning();
    if (!workload) throw new Error("Workload could not be saved.");

    await tx.insert(processesTable).values(
      input.processes.map((process) => ({
        workloadId: workload.id,
        pid: process.pid,
        arrivalTime: process.arrivalTime,
        burstTime: process.burstTime,
        priority: process.priority,
        memoryMb: process.memoryMb,
      })),
    );
    return workload;
  });
  const created = await getWorkloadRecord(workload.id);
  if (!created) throw new Error("Saved workload could not be retrieved.");
  return workloadDto(created);
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index]!;
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((entry) => entry !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
    if (rows.length > 501) throw new Error("CSV may contain at most 500 processes.");
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted value.");
  row.push(cell.trim());
  if (row.some((entry) => entry !== "")) rows.push(row);
  if (rows.length > 501) throw new Error("CSV may contain at most 500 processes.");
  return rows;
}

function readCsvProcesses(csv: string): SchedulingInput[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error("CSV must include a header and at least one process.");
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const headers = rows[0]!.map(normalize);
  const findColumn = (...aliases: string[]) =>
    headers.findIndex((header) => aliases.includes(header));
  const pidColumn = findColumn("pid", "processid", "process");
  const arrivalColumn = findColumn("arrivaltime", "arrival");
  const burstColumn = findColumn("bursttime", "burst", "cputime", "cpu");
  const priorityColumn = findColumn("priority");
  const memoryColumn = findColumn("memorymb", "memory");
  if (arrivalColumn < 0 || burstColumn < 0) {
    throw new Error("CSV needs arrival_time and burst_time columns.");
  }

  const processes = rows.slice(1).map((cells, index) => {
    if (cells.length !== headers.length) {
      throw new Error(`CSV row ${index + 2} has a different number of columns than the header.`);
    }
    const readNumber = (column: number, label: string, fallback?: number) => {
      if (column < 0 && fallback !== undefined) return fallback;
      const value = Number(cells[column]);
      if (!Number.isFinite(value)) {
        throw new Error(`CSV row ${index + 2} has an invalid ${label}.`);
      }
      return value;
    };
    const pid =
      pidColumn < 0 || !cells[pidColumn]
        ? `P${index + 1}`
        : cells[pidColumn]!;
    return {
      pid,
      arrivalTime: readNumber(arrivalColumn, "arrival time"),
      burstTime: readNumber(burstColumn, "burst time"),
      priority: readNumber(priorityColumn, "priority", 0),
      memoryMb: readNumber(memoryColumn, "memory", 0),
    };
  });
  runAlgorithm("FCFS", processes);
  return processes;
}

function simulationDto(row: typeof simulationsTable.$inferSelect, workloadName: string) {
  return {
    id: row.id,
    workloadId: row.workloadId,
    workloadName,
    algorithmId: row.algorithmId,
    algorithmName: row.algorithmName,
    quantum: row.quantum,
    metrics: row.metrics,
    processes: row.processes,
    timeline: row.timeline,
    createdAt: asIso(row.createdAt),
  };
}

async function storeSimulation(
  workloadId: number,
  workloadName: string,
  algorithmId: AlgorithmId,
  quantum: number,
  processes: SchedulingInput[],
) {
  const algorithm = algorithms.find((entry) => entry.id === algorithmId);
  if (!algorithm) throw new Error(`Unsupported algorithm: ${algorithmId}`);
  const result = runAlgorithm(algorithmId, processes, quantum);
  const [row] = await db
    .insert(simulationsTable)
    .values({
      workloadId,
      algorithmId,
      algorithmName: algorithm.name,
      quantum: algorithmId === "ROUND_ROBIN" ? quantum : null,
      metrics: result.metrics,
      processes: result.processes,
      timeline: result.timeline,
    })
    .returning();
  if (!row) throw new Error("Simulation could not be saved.");
  return simulationDto(row, workloadName);
}

router.get("/dashboard", async (_req, res): Promise<void> => {
  const [workloadCount] = await db
    .select({ value: count() })
    .from(workloadsTable);
  const [simulationCount] = await db
    .select({ value: count() })
    .from(simulationsTable);
  const [sharedResultCount] = await db
    .select({ value: count() })
    .from(sharedMetricsTable);
  const [processCount] = await db
    .select({ value: count() })
    .from(processesTable);
  const recentSimulations = await db
    .select({ simulation: simulationsTable, workloadName: workloadsTable.name })
    .from(simulationsTable)
    .innerJoin(workloadsTable, eq(simulationsTable.workloadId, workloadsTable.id))
    .orderBy(desc(simulationsTable.createdAt))
    .limit(5);
  const recentWorkloads = await db
    .select()
    .from(workloadsTable)
    .orderBy(desc(workloadsTable.createdAt))
    .limit(5);
  const workloadProcessCounts = await db
    .select({ workloadId: processesTable.workloadId, processCount: count() })
    .from(processesTable)
    .groupBy(processesTable.workloadId);
  const countByWorkload = new Map(
    workloadProcessCounts.map((item) => [item.workloadId, item.processCount]),
  );
  const [latestRecommendation] = await db
    .select()
    .from(recommendationsTable)
    .orderBy(desc(recommendationsTable.createdAt))
    .limit(1);
  const savedRecommendation = latestRecommendation?.recommendation as
    | { recommendedAlgorithmName?: string; objective?: string; rationale?: string }
    | undefined;

  res.json(
    GetDashboardResponse.parse({
      workloadCount: workloadCount?.value ?? 0,
      simulationCount: simulationCount?.value ?? 0,
      sharedResultCount: sharedResultCount?.value ?? 0,
      processCount: processCount?.value ?? 0,
      recentSimulations: recentSimulations.map(({ simulation, workloadName }) => ({
        ...simulationDto(simulation, workloadName),
      })),
      recentWorkloads: recentWorkloads.map((workload) => ({
        id: workload.id,
        name: workload.name,
        source: workload.source,
        profile: workload.profile,
        processCount: countByWorkload.get(workload.id) ?? 0,
        createdAt: asIso(workload.createdAt),
      })),
      latestRecommendation: savedRecommendation
        ? {
            algorithmName: savedRecommendation.recommendedAlgorithmName ?? "—",
            objective: savedRecommendation.objective ?? "—",
            rationale: savedRecommendation.rationale ?? "",
          }
        : null,
    }),
  );
});

router.get("/algorithms", (_req, res): void => {
  const sourceById = {
    FCFS: runFcfs.toString(),
    SJF: runSjf.toString(),
    SRTF: runSrtf.toString(),
    PRIORITY: runPriority.toString(),
    ROUND_ROBIN: runRoundRobin.toString(),
  };
  res.json(
    ListAlgorithmsResponse.parse(
      algorithms.map((algorithm) => ({
        ...algorithm,
        sourceCode: sourceById[algorithm.id],
      })),
    ),
  );
});

router.get("/workloads", async (_req, res): Promise<void> => {
  const workloads = await db
    .select()
    .from(workloadsTable)
    .orderBy(desc(workloadsTable.createdAt));
  const processCounts = await db
    .select({ workloadId: processesTable.workloadId, processCount: count() })
    .from(processesTable)
    .groupBy(processesTable.workloadId);
  const countById = new Map(processCounts.map((item) => [item.workloadId, item.processCount]));
  res.json(
    ListWorkloadsResponse.parse(
      workloads.map((workload) => ({
        id: workload.id,
        name: workload.name,
        source: workload.source,
        profile: workload.profile,
        processCount: countById.get(workload.id) ?? 0,
        createdAt: asIso(workload.createdAt),
      })),
    ),
  );
});

router.post("/workloads", async (req, res): Promise<void> => {
  const body = CreateWorkloadBody.safeParse(req.body);
  if (!body.success) {
    badRequest(res, body.error.message);
    return;
  }
  try {
    const created = await createWorkload(body.data);
    res.status(201).json(CreateWorkloadResponse.parse(created));
  } catch (error) {
    badRequest(res, error instanceof Error ? error.message : "Invalid workload.");
  }
});

router.post("/workloads/import", async (req, res): Promise<void> => {
  const body = ImportWorkloadCsvBody.safeParse(req.body);
  if (!body.success) {
    badRequest(res, body.error.message);
    return;
  }
  try {
    const processes = readCsvProcesses(body.data.csv);
    const created = await createWorkload({
      name: body.data.name,
      description: "Imported from a validated CSV file.",
      source: "csv",
      profile: "mixed",
      processes,
    });
    res.status(201).json(ImportWorkloadCsvResponse.parse(created));
  } catch (error) {
    badRequest(res, error instanceof Error ? error.message : "CSV could not be imported.");
  }
});

router.get("/workloads/:workloadId", async (req, res): Promise<void> => {
  const params = GetWorkloadParams.safeParse(req.params);
  if (!params.success) {
    badRequest(res, params.error.message);
    return;
  }
  const workload = await getWorkloadRecord(params.data.workloadId);
  if (!workload) {
    res.status(404).json({ error: "Workload not found." });
    return;
  }
  res.json(GetWorkloadResponse.parse(workloadDto(workload)));
});

router.delete("/workloads/:workloadId", async (req, res): Promise<void> => {
  const params = DeleteWorkloadParams.safeParse(req.params);
  if (!params.success) {
    badRequest(res, params.error.message);
    return;
  }
  const deleted = await db
    .delete(workloadsTable)
    .where(eq(workloadsTable.id, params.data.workloadId))
    .returning({ id: workloadsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Workload not found." });
    return;
  }
  res.sendStatus(204);
});

router.post("/simulations/run", async (req, res): Promise<void> => {
  const body = RunSimulationsBody.safeParse(req.body);
  if (!body.success) {
    badRequest(res, body.error.message);
    return;
  }
  const workload = await getWorkloadRecord(body.data.workloadId);
  if (!workload) {
    res.status(404).json({ error: "Workload not found." });
    return;
  }
  const unknown = body.data.algorithmIds.find(
    (id) => !algorithms.some((algorithm) => algorithm.id === id),
  );
  if (unknown) {
    badRequest(res, `Unsupported algorithm: ${unknown}`);
    return;
  }
  try {
    const results = [];
    for (const algorithmId of body.data.algorithmIds) {
      results.push(
        await storeSimulation(
          workload.id,
          workload.name,
          algorithmId as AlgorithmId,
          body.data.quantum ?? 2,
          workload.processes,
        ),
      );
    }
    res.status(201).json(RunSimulationsResponse.parse(results));
  } catch (error) {
    badRequest(res, error instanceof Error ? error.message : "Simulation failed.");
  }
});

router.get("/simulations", async (req, res): Promise<void> => {
  const params = ListSimulationsQueryParams.safeParse(req.query);
  if (!params.success) {
    badRequest(res, params.error.message);
    return;
  }
  const rows = params.data.workloadId
    ? await db
        .select({ simulation: simulationsTable, workloadName: workloadsTable.name })
        .from(simulationsTable)
        .innerJoin(workloadsTable, eq(simulationsTable.workloadId, workloadsTable.id))
        .where(eq(simulationsTable.workloadId, params.data.workloadId))
        .orderBy(desc(simulationsTable.createdAt))
    : await db
        .select({ simulation: simulationsTable, workloadName: workloadsTable.name })
        .from(simulationsTable)
        .innerJoin(workloadsTable, eq(simulationsTable.workloadId, workloadsTable.id))
        .orderBy(desc(simulationsTable.createdAt));
  res.json(
    ListSimulationsResponse.parse(
      rows.map(({ simulation, workloadName }) =>
        simulationDto(simulation, workloadName),
      ),
    ),
  );
});

router.get("/simulations/:simulationId", async (req, res): Promise<void> => {
  const params = GetSimulationParams.safeParse(req.params);
  if (!params.success) {
    badRequest(res, params.error.message);
    return;
  }
  const [result] = await db
    .select({ simulation: simulationsTable, workloadName: workloadsTable.name })
    .from(simulationsTable)
    .innerJoin(workloadsTable, eq(simulationsTable.workloadId, workloadsTable.id))
    .where(eq(simulationsTable.id, params.data.simulationId));
  if (!result) {
    res.status(404).json({ error: "Simulation not found." });
    return;
  }
  res.json(
    GetSimulationResponse.parse(
      simulationDto(result.simulation, result.workloadName),
    ),
  );
});

router.post("/recommendations", async (req, res): Promise<void> => {
  const body = CreateRecommendationBody.safeParse(req.body);
  if (!body.success) {
    badRequest(res, body.error.message);
    return;
  }
  const workload = await getWorkloadRecord(body.data.workloadId);
  if (!workload) {
    res.status(404).json({ error: "Workload not found." });
    return;
  }
  const scored = evaluatePolicies(
    workload.processes,
    body.data.objective,
    body.data.quantum ?? 2,
  );
  const winner = scored[0]!;
  const objectiveLabel = getObjectiveLabel(body.data.objective);
  const priorRuns = await db
    .select({ id: simulationsTable.id })
    .from(simulationsTable)
    .where(eq(simulationsTable.workloadId, workload.id))
    .limit(1);
  const recommendation = {
    objective: body.data.objective,
    recommendedAlgorithmId: winner.algorithmId,
    recommendedAlgorithmName: winner.algorithmName,
    rationale: `${winner.algorithmName} ranked best for ${objectiveLabel} in this simulation. Its averages were ${winner.metrics.averageWaitingTime.toFixed(2)} waiting, ${winner.metrics.averageTurnaroundTime.toFixed(2)} turnaround, and ${winner.metrics.averageResponseTime.toFixed(2)} response time. These are simulated results, not measurements from your real operating system; the recommendation comes from a transparent rule, not AI.`,
    historicalEvidenceAvailable: priorRuns.length > 0,
    aiExplanationAvailable: isAiExplanationConfigured(),
    evaluations: scored,
  };
  await db.insert(recommendationsTable).values({
    workloadId: workload.id,
    objective: body.data.objective,
    recommendation,
  });
  res.json(CreateRecommendationResponse.parse(recommendation));
});

router.post("/recommendations/explanation", async (req, res): Promise<void> => {
  const body = CreateRecommendationExplanationBody.safeParse(req.body);
  if (!body.success) {
    badRequest(res, body.error.message);
    return;
  }
  const workload = await getWorkloadRecord(body.data.workloadId);
  if (!workload) {
    res.status(404).json({ error: "Workload not found." });
    return;
  }

  const aiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim();
  const aiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim();
  if (!aiBaseUrl || !aiApiKey) {
    res.status(503).json({
      error: "AI commentary is unavailable until Replit AI is configured.",
    });
    return;
  }

  const quantum = body.data.quantum ?? 2;
  const scored = evaluatePolicies(
    workload.processes,
    body.data.objective,
    quantum,
  );
  const winner = scored[0]!;
  const prompt = buildRecommendationExplanationPrompt({
    objective: body.data.objective,
    selectedPolicy: winner.algorithmName,
    processCount: workload.processes.length,
    evaluations: scored,
    roundRobinQuantum:
      winner.algorithmId === "ROUND_ROBIN" ? quantum : undefined,
  });

  try {
    const client = new OpenAI({ apiKey: aiApiKey, baseURL: aiBaseUrl });
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 8192,
      messages: [
        {
          role: "system",
          content:
            "You provide accurate, concise operating-systems explanations for students. Follow the supplied instructions and data exactly.",
        },
        { role: "user", content: prompt },
      ],
    });
    const explanation = completion.choices[0]?.message.content?.trim();
    if (!explanation) {
      throw new Error("The AI service returned an empty explanation.");
    }
    res.json(
      CreateRecommendationExplanationResponse.parse({
        explanation: explanation.slice(0, 1200),
      }),
    );
  } catch (error) {
    req.log.warn(
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      "AI recommendation explanation could not be generated",
    );
    res.status(503).json({
      error: "AI commentary could not be generated. The deterministic recommendation is unchanged.",
    });
  }
});

router.get("/analytics", async (req, res): Promise<void> => {
  const params = GetAnalyticsQueryParams.safeParse(req.query);
  if (!params.success) {
    badRequest(res, params.error.message);
    return;
  }
  const rows = params.data.workloadId
    ? await db
        .select({ simulation: simulationsTable, workloadName: workloadsTable.name })
        .from(simulationsTable)
        .innerJoin(workloadsTable, eq(simulationsTable.workloadId, workloadsTable.id))
        .where(eq(simulationsTable.workloadId, params.data.workloadId))
        .orderBy(desc(simulationsTable.createdAt))
    : await db
        .select({ simulation: simulationsTable, workloadName: workloadsTable.name })
        .from(simulationsTable)
        .innerJoin(workloadsTable, eq(simulationsTable.workloadId, workloadsTable.id))
        .orderBy(desc(simulationsTable.createdAt));
  res.json(
    GetAnalyticsResponse.parse(
      rows.map(({ simulation, workloadName }) =>
        simulationDto(simulation, workloadName),
      ),
    ),
  );
});

router.get("/agent/health", async (_req, res): Promise<void> => {
  const [latest] = await db
    .select({ receivedAt: agentSnapshotsTable.receivedAt })
    .from(agentSnapshotsTable)
    .orderBy(desc(agentSnapshotsTable.receivedAt))
    .limit(1);
  const [snapshots] = await db
    .select({ value: count() })
    .from(agentSnapshotsTable);
  const lastSeenAt = latest ? asIso(latest.receivedAt) : null;
  const connected = latest
    ? Date.now() - latest.receivedAt.getTime() < 90_000
    : false;
  res.json(
    GetAgentHealthResponse.parse({
      connected,
      lastSeenAt,
      snapshotCount: snapshots?.value ?? 0,
    }),
  );
});

router.get("/agent/snapshots", async (_req, res): Promise<void> => {
  const snapshots = await db
    .select()
    .from(agentSnapshotsTable)
    .orderBy(desc(agentSnapshotsTable.receivedAt));
  res.json(
    ListAgentSnapshotsResponse.parse(
      snapshots.map((snapshot) => ({
        id: snapshot.id,
        schemaVersion: snapshot.schemaVersion,
        observedAt: asIso(snapshot.observedAt),
        receivedAt: asIso(snapshot.receivedAt),
        observationSeconds: snapshot.observationSeconds,
        processCount: snapshot.processCount,
        processes: snapshot.processes,
      })),
    ),
  );
});

function hasAgentAccess(req: Request): boolean {
  const expected = process.env.AGENT_ACCESS_TOKEN;
  if (!expected) return process.env.NODE_ENV !== "production";
  const auth = req.get("authorization");
  const supplied = auth?.startsWith("Bearer ")
    ? auth.slice("Bearer ".length)
    : req.get("x-agent-token");
  return supplied === expected;
}

router.post("/agent/snapshots", async (req, res): Promise<void> => {
  if (!hasAgentAccess(req)) {
    res.status(401).json({ error: "Agent access token is invalid." });
    return;
  }
  const body = CreateAgentSnapshotBody.safeParse(req.body);
  if (!body.success) {
    badRequest(res, body.error.message);
    return;
  }
  const observedAt = new Date(body.data.observedAt);
  if (!Number.isFinite(observedAt.getTime())) {
    badRequest(res, "Snapshot timestamp is invalid.");
    return;
  }
  const [snapshot] = await db
    .insert(agentSnapshotsTable)
    .values({
      schemaVersion: body.data.schemaVersion,
      observedAt,
      observationSeconds: body.data.observationSeconds,
      processCount: body.data.processes.length,
      processes: body.data.processes.map((process) => ({
        ...process,
        createdAt:
          process.createdAt instanceof Date
            ? process.createdAt.toISOString()
            : process.createdAt,
      })),
    })
    .returning();
  if (!snapshot) {
    res.status(500).json({ error: "Snapshot could not be saved." });
    return;
  }
  res.status(201).json(
    CreateAgentSnapshotResponse.parse({
      id: snapshot.id,
      schemaVersion: snapshot.schemaVersion,
      observedAt: asIso(snapshot.observedAt),
      receivedAt: asIso(snapshot.receivedAt),
      observationSeconds: snapshot.observationSeconds,
      processCount: snapshot.processCount,
      processes: snapshot.processes,
    }),
  );
});

router.delete("/agent/snapshots/:snapshotId", async (req, res): Promise<void> => {
  const params = DeleteAgentSnapshotParams.safeParse(req.params);
  if (!params.success) {
    badRequest(res, params.error.message);
    return;
  }
  const deleted = await db
    .delete(agentSnapshotsTable)
    .where(eq(agentSnapshotsTable.id, params.data.snapshotId))
    .returning({ id: agentSnapshotsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Snapshot not found." });
    return;
  }
  res.sendStatus(204);
});

router.post("/agent/workloads", async (req, res): Promise<void> => {
  const body = CreateAgentWorkloadBody.safeParse(req.body);
  if (!body.success) {
    badRequest(res, body.error.message);
    return;
  }
  const [snapshot] = await db
    .select()
    .from(agentSnapshotsTable)
    .where(eq(agentSnapshotsTable.id, body.data.snapshotId));
  if (!snapshot) {
    res.status(404).json({ error: "Snapshot not found." });
    return;
  }
  const observed = snapshot.processes
    .filter((process) => {
      if (body.data.includeAll) return true;
      return (
        process.status === "running" ||
        (process.cpuPercent ?? 0) >= 0.5
      );
    })
    .sort((a, b) => (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0))
    .slice(0, 500);
  if (observed.length === 0) {
    badRequest(
      res,
      "No active processes were found in this snapshot. Try including all accessible processes.",
    );
    return;
  }
  const processes = observed.map((process) => {
    const observedCpu = Math.max(0, Math.min(process.cpuPercent ?? 0, 100));
    const burstTime = Math.max(
      1,
      Math.min(snapshot.observationSeconds || 1, (snapshot.observationSeconds || 1) * observedCpu / 100),
    );
    return {
      pid: `PID-${process.pid}`,
      arrivalTime: 0,
      burstTime,
      priority: 0,
      memoryMb: process.memoryMb ?? 0,
    };
  });
  try {
    const created = await createWorkload({
      name: body.data.name,
      description: `Estimated simulation input derived from observed PC snapshot #${snapshot.id}. CPU bursts are estimates based on observed CPU usage during a ${snapshot.observationSeconds}-second sampling window; they are not recovered OS burst times.`,
      source: "agent",
      profile: "observed-estimate",
      snapshotId: snapshot.id,
      processes,
    });
    res.status(201).json(CreateAgentWorkloadResponse.parse(created));
  } catch (error) {
    badRequest(res, error instanceof Error ? error.message : "Could not create estimated workload.");
  }
});

export default router;
