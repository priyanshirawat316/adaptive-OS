from math import isfinite


class WorkloadSimilarity:
    """Compare current workload features with historical workloads."""

    WEIGHTS = {
        "process_count": 0.20,
        "average_burst_time": 0.25,
        "burst_std_dev": 0.20,
        "average_arrival_gap": 0.15,
        "priority_spread": 0.20,
    }

    def similarity_score(self, current, historical):
        if not isinstance(current, dict) or not isinstance(historical, dict):
            raise ValueError("Workload features must be dictionaries.")

        score_total = 0.0

        for feature, weight in self.WEIGHTS.items():
            try:
                a = float(current[feature])
                b = float(historical[feature])
            except (KeyError, TypeError, ValueError):
                raise ValueError(f"Missing or invalid feature: {feature}") from None

            if not isfinite(a) or not isfinite(b):
                raise ValueError(f"Feature '{feature}' must be finite.")

            scale = max(abs(a), abs(b), 1.0)
            score_total += max(0.0, 1.0 - abs(a - b) / scale) * weight

        return score_total

    def find_similar(self, current_features, historical_records, threshold=0.75):
        if (
            isinstance(threshold, bool)
            or not isinstance(threshold, (int, float))
            or not isfinite(threshold)
            or not 0 <= threshold <= 1
        ):
            raise ValueError("Threshold must be between 0 and 1.")

        if not isinstance(historical_records, (list, tuple)):
            raise ValueError("Historical records must be a list or tuple.")

        matches = []

        for record in historical_records:
            if not isinstance(record, dict):
                continue

            features = record.get("features", record)

            try:
                score = self.similarity_score(current_features, features)
            except ValueError:
                continue

            if score >= threshold:
                matches.append({"record": record, "similarity": score})

        return sorted(matches, key=lambda item: item["similarity"], reverse=True)
