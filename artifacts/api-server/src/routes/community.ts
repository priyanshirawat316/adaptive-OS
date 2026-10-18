import {
  CreateAlgorithmCommentBody,
  CreateAlgorithmCommentParams,
  CreateAlgorithmCommentResponse,
  CreateCommunityAlgorithmBody,
  CreateCommunityAlgorithmResponse,
  CreateDiscussionBody,
  CreateDiscussionCommentBody,
  CreateDiscussionCommentParams,
  CreateDiscussionCommentResponse,
  CreateDiscussionResponse,
  CreateMetricCommentBody,
  CreateMetricCommentParams,
  CreateMetricCommentResponse,
  ListAlgorithmCommentsParams,
  ListAlgorithmCommentsResponse,
  ListCommunityAlgorithmsResponse,
  ListDiscussionCommentsParams,
  ListDiscussionCommentsResponse,
  ListDiscussionsResponse,
  ListMetricCommentsParams,
  ListMetricCommentsResponse,
  ListSharedMetricsResponse,
  ShareSimulationBody,
  ShareSimulationParams,
  ShareSimulationResponse,
} from "@workspace/api-zod";
import {
  communityAlgorithmsTable,
  communityCommentsTable,
  db,
  discussionsTable,
  sharedMetricsTable,
  simulationsTable,
  workloadsTable,
} from "@workspace/db";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";

const router: IRouter = Router();

function iso(value: Date): string {
  return value.toISOString();
}

function parseId(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function invalid(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

async function commentsCount(targetType: string, targetIds: number[]) {
  if (targetIds.length === 0) return new Map<number, number>();
  const rows = await db
    .select({
      targetId: communityCommentsTable.targetId,
      value: count(),
    })
    .from(communityCommentsTable)
    .where(
      and(
        eq(communityCommentsTable.targetType, targetType),
        // Target IDs come from the database, not user input.
        // `inArray` keeps the query parameterized.
        inArray(communityCommentsTable.targetId, targetIds),
      ),
    )
    .groupBy(communityCommentsTable.targetId);
  return new Map(rows.map((row) => [row.targetId, row.value]));
}

router.get("/community/metrics", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      shared: sharedMetricsTable,
      simulation: simulationsTable,
      workloadName: workloadsTable.name,
    })
    .from(sharedMetricsTable)
    .innerJoin(
      simulationsTable,
      eq(sharedMetricsTable.simulationId, simulationsTable.id),
    )
    .innerJoin(
      workloadsTable,
      eq(simulationsTable.workloadId, workloadsTable.id),
    )
    .orderBy(desc(sharedMetricsTable.createdAt));
  const counts = await commentsCount(
    "metric",
    rows.map((row) => row.shared.id),
  );
  res.json(
    ListSharedMetricsResponse.parse(
      rows.map(({ shared, simulation, workloadName }) => ({
        id: shared.id,
        simulationId: simulation.id,
        title: shared.title,
        authorName: shared.authorName,
        algorithmName: simulation.algorithmName,
        workloadName,
        processCount: simulation.processes.length,
        metrics: simulation.metrics,
        createdAt: iso(shared.createdAt),
        commentCount: counts.get(shared.id) ?? 0,
      })),
    ),
  );
});

router.post(
  "/community/metrics/:simulationId/share",
  async (req, res): Promise<void> => {
    const params = ShareSimulationParams.safeParse(req.params);
    const body = ShareSimulationBody.safeParse(req.body);
    if (!params.success) {
      invalid(res, params.error.message);
      return;
    }
    if (!body.success) {
      invalid(res, body.error.message);
      return;
    }
    const [record] = await db
      .select({
        simulation: simulationsTable,
        workloadName: workloadsTable.name,
      })
      .from(simulationsTable)
      .innerJoin(
        workloadsTable,
        eq(simulationsTable.workloadId, workloadsTable.id),
      )
      .where(eq(simulationsTable.id, params.data.simulationId));
    if (!record) {
      res.status(404).json({ error: "Simulation not found." });
      return;
    }
    const [existing] = await db
      .select()
      .from(sharedMetricsTable)
      .where(eq(sharedMetricsTable.simulationId, params.data.simulationId));
    if (existing) {
      res.status(409).json({ error: "This simulation has already been shared." });
      return;
    }
    const [shared] = await db
      .insert(sharedMetricsTable)
      .values({
        simulationId: params.data.simulationId,
        title: body.data.title,
        authorName: body.data.authorName,
      })
      .returning();
    if (!shared) {
      res.status(500).json({ error: "The result could not be shared." });
      return;
    }
    res.status(201).json(
      ShareSimulationResponse.parse({
        id: shared.id,
        simulationId: record.simulation.id,
        title: shared.title,
        authorName: shared.authorName,
        algorithmName: record.simulation.algorithmName,
        workloadName: record.workloadName,
        processCount: record.simulation.processes.length,
        metrics: record.simulation.metrics,
        createdAt: iso(shared.createdAt),
        commentCount: 0,
      }),
    );
  },
);

router.get(
  "/community/metrics/:metricId/comments",
  async (req, res): Promise<void> => {
    const params = ListMetricCommentsParams.safeParse(req.params);
    if (!params.success) {
      invalid(res, params.error.message);
      return;
    }
    const comments = await db
      .select()
      .from(communityCommentsTable)
      .where(
        and(
          eq(communityCommentsTable.targetType, "metric"),
          eq(communityCommentsTable.targetId, params.data.metricId),
        ),
      )
      .orderBy(communityCommentsTable.createdAt);
    res.json(
      ListMetricCommentsResponse.parse(
        comments.map((comment) => ({
          id: comment.id,
          authorName: comment.authorName,
          message: comment.message,
          createdAt: iso(comment.createdAt),
        })),
      ),
    );
  },
);

router.post(
  "/community/metrics/:metricId/comments",
  async (req, res): Promise<void> => {
    const params = CreateMetricCommentParams.safeParse(req.params);
    const body = CreateMetricCommentBody.safeParse(req.body);
    if (!params.success) {
      invalid(res, params.error.message);
      return;
    }
    if (!body.success) {
      invalid(res, body.error.message);
      return;
    }
    const [metric] = await db
      .select({ id: sharedMetricsTable.id })
      .from(sharedMetricsTable)
      .where(eq(sharedMetricsTable.id, params.data.metricId));
    if (!metric) {
      res.status(404).json({ error: "Shared result not found." });
      return;
    }
    const [comment] = await db
      .insert(communityCommentsTable)
      .values({
        targetType: "metric",
        targetId: metric.id,
        authorName: body.data.authorName,
        message: body.data.message,
      })
      .returning();
    if (!comment) {
      res.status(500).json({ error: "Comment could not be saved." });
      return;
    }
    res.status(201).json(
      CreateMetricCommentResponse.parse({
        id: comment.id,
        authorName: comment.authorName,
        message: comment.message,
        createdAt: iso(comment.createdAt),
      }),
    );
  },
);

router.get("/community/algorithms", async (_req, res): Promise<void> => {
  const algorithms = await db
    .select()
    .from(communityAlgorithmsTable)
    .orderBy(desc(communityAlgorithmsTable.createdAt));
  const counts = await commentsCount(
    "algorithm",
    algorithms.map((algorithm) => algorithm.id),
  );
  res.json(
    ListCommunityAlgorithmsResponse.parse(
      algorithms.map((algorithm) => ({
        id: algorithm.id,
        name: algorithm.name,
        description: algorithm.description,
        authorName: algorithm.authorName,
        sourceCode: algorithm.sourceCode,
        tags: algorithm.tags,
        status: "review-unexecuted" as const,
        createdAt: iso(algorithm.createdAt),
        commentCount: counts.get(algorithm.id) ?? 0,
      })),
    ),
  );
});

router.post("/community/algorithms", async (req, res): Promise<void> => {
  const body = CreateCommunityAlgorithmBody.safeParse(req.body);
  if (!body.success) {
    invalid(res, body.error.message);
    return;
  }
  const [algorithm] = await db
    .insert(communityAlgorithmsTable)
    .values({
      name: body.data.name,
      description: body.data.description,
      authorName: body.data.authorName,
      sourceCode: body.data.sourceCode,
      tags: body.data.tags ?? [],
      status: "review-unexecuted",
    })
    .returning();
  if (!algorithm) {
    res.status(500).json({ error: "Algorithm could not be saved." });
    return;
  }
  res.status(201).json(
    CreateCommunityAlgorithmResponse.parse({
      id: algorithm.id,
      name: algorithm.name,
      description: algorithm.description,
      authorName: algorithm.authorName,
      sourceCode: algorithm.sourceCode,
      tags: algorithm.tags,
      status: "review-unexecuted",
      createdAt: iso(algorithm.createdAt),
      commentCount: 0,
    }),
  );
});

router.get(
  "/community/algorithms/:algorithmId/comments",
  async (req, res): Promise<void> => {
    const params = ListAlgorithmCommentsParams.safeParse(req.params);
    if (!params.success) {
      invalid(res, params.error.message);
      return;
    }
    const comments = await db
      .select()
      .from(communityCommentsTable)
      .where(
        and(
          eq(communityCommentsTable.targetType, "algorithm"),
          eq(communityCommentsTable.targetId, params.data.algorithmId),
        ),
      )
      .orderBy(communityCommentsTable.createdAt);
    res.json(
      ListAlgorithmCommentsResponse.parse(
        comments.map((comment) => ({
          id: comment.id,
          authorName: comment.authorName,
          message: comment.message,
          createdAt: iso(comment.createdAt),
        })),
      ),
    );
  },
);

router.post(
  "/community/algorithms/:algorithmId/comments",
  async (req, res): Promise<void> => {
    const params = CreateAlgorithmCommentParams.safeParse(req.params);
    const body = CreateAlgorithmCommentBody.safeParse(req.body);
    if (!params.success) {
      invalid(res, params.error.message);
      return;
    }
    if (!body.success) {
      invalid(res, body.error.message);
      return;
    }
    const [algorithm] = await db
      .select({ id: communityAlgorithmsTable.id })
      .from(communityAlgorithmsTable)
      .where(eq(communityAlgorithmsTable.id, params.data.algorithmId));
    if (!algorithm) {
      res.status(404).json({ error: "Algorithm not found." });
      return;
    }
    const [comment] = await db
      .insert(communityCommentsTable)
      .values({
        targetType: "algorithm",
        targetId: algorithm.id,
        authorName: body.data.authorName,
        message: body.data.message,
      })
      .returning();
    if (!comment) {
      res.status(500).json({ error: "Comment could not be saved." });
      return;
    }
    res.status(201).json(
      CreateAlgorithmCommentResponse.parse({
        id: comment.id,
        authorName: comment.authorName,
        message: comment.message,
        createdAt: iso(comment.createdAt),
      }),
    );
  },
);

router.get("/community/discussions", async (_req, res): Promise<void> => {
  const discussions = await db
    .select()
    .from(discussionsTable)
    .orderBy(desc(discussionsTable.createdAt));
  const counts = await commentsCount(
    "discussion",
    discussions.map((discussion) => discussion.id),
  );
  res.json(
    ListDiscussionsResponse.parse(
      discussions.map((discussion) => ({
        id: discussion.id,
        title: discussion.title,
        body: discussion.body,
        category: discussion.category,
        authorName: discussion.authorName,
        createdAt: iso(discussion.createdAt),
        commentCount: counts.get(discussion.id) ?? 0,
      })),
    ),
  );
});

router.post("/community/discussions", async (req, res): Promise<void> => {
  const body = CreateDiscussionBody.safeParse(req.body);
  if (!body.success) {
    invalid(res, body.error.message);
    return;
  }
  const [discussion] = await db
    .insert(discussionsTable)
    .values(body.data)
    .returning();
  if (!discussion) {
    res.status(500).json({ error: "Discussion could not be saved." });
    return;
  }
  res.status(201).json(
    CreateDiscussionResponse.parse({
      id: discussion.id,
      title: discussion.title,
      body: discussion.body,
      category: discussion.category,
      authorName: discussion.authorName,
      createdAt: iso(discussion.createdAt),
      commentCount: 0,
    }),
  );
});

router.get(
  "/community/discussions/:discussionId/comments",
  async (req, res): Promise<void> => {
    const params = ListDiscussionCommentsParams.safeParse(req.params);
    if (!params.success) {
      invalid(res, params.error.message);
      return;
    }
    const comments = await db
      .select()
      .from(communityCommentsTable)
      .where(
        and(
          eq(communityCommentsTable.targetType, "discussion"),
          eq(communityCommentsTable.targetId, params.data.discussionId),
        ),
      )
      .orderBy(communityCommentsTable.createdAt);
    res.json(
      ListDiscussionCommentsResponse.parse(
        comments.map((comment) => ({
          id: comment.id,
          authorName: comment.authorName,
          message: comment.message,
          createdAt: iso(comment.createdAt),
        })),
      ),
    );
  },
);

router.post(
  "/community/discussions/:discussionId/comments",
  async (req, res): Promise<void> => {
    const params = CreateDiscussionCommentParams.safeParse(req.params);
    const body = CreateDiscussionCommentBody.safeParse(req.body);
    if (!params.success) {
      invalid(res, params.error.message);
      return;
    }
    if (!body.success) {
      invalid(res, body.error.message);
      return;
    }
    const [discussion] = await db
      .select({ id: discussionsTable.id })
      .from(discussionsTable)
      .where(eq(discussionsTable.id, params.data.discussionId));
    if (!discussion) {
      res.status(404).json({ error: "Discussion not found." });
      return;
    }
    const [comment] = await db
      .insert(communityCommentsTable)
      .values({
        targetType: "discussion",
        targetId: discussion.id,
        authorName: body.data.authorName,
        message: body.data.message,
      })
      .returning();
    if (!comment) {
      res.status(500).json({ error: "Reply could not be saved." });
      return;
    }
    res.status(201).json(
      CreateDiscussionCommentResponse.parse({
        id: comment.id,
        authorName: comment.authorName,
        message: comment.message,
        createdAt: iso(comment.createdAt),
      }),
    );
  },
);

export default router;
