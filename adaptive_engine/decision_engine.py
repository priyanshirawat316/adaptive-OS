from .profiler import WorkloadProfiler
from .similarity import WorkloadSimilarity
from .cold_start import ColdStartSelector


class AdaptiveDecisionEngine:
    def __init__(self, similarity_threshold=0.75):
        self.profiler = WorkloadProfiler()
        self.matcher = WorkloadSimilarity()
        self.cold_start = ColdStartSelector()
        self.similarity_threshold = similarity_threshold

    def decide(self, processes, historical_records=None):
        historical_records = historical_records or []

        # Analyze the current workload
        features = self.profiler.profile(processes)

        # Find similar historical workloads
        matches = self.matcher.find_similar(
            features,
            historical_records,
            threshold=self.similarity_threshold,
        )

        # Use historical performance when available
        evaluated_matches = []

        for match in matches:
            record = match["record"]
            algorithm = record.get("algorithm")
            metrics = record.get("metrics", {})
            waiting_time = metrics.get("average_waiting_time")

            if (
                algorithm in self.cold_start.ALGORITHMS
                and isinstance(waiting_time, (int, float))
                and waiting_time >= 0
            ):
                evaluated_matches.append({
                    "algorithm": algorithm,
                    "average_waiting_time": waiting_time,
                    "similarity": match["similarity"],
                })

        if evaluated_matches:
            best = min(
                evaluated_matches,
                key=lambda item: (
                    item["average_waiting_time"],
                    -item["similarity"],
                ),
            )

            return {
                "algorithm": best["algorithm"],
                "mode": "historical",
                "features": features,
                "similarity": best["similarity"],
                "reason": "Selected using historical performance.",
            }

        # Fall back to a baseline when history is unavailable
        algorithm = self.cold_start.select_algorithm(features)

        return {
            "algorithm": algorithm,
            "mode": "cold_start",
            "features": features,
            "similarity": None,
            "reason": "No usable similar historical workload found.",
        }
