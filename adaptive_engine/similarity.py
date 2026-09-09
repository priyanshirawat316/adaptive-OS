class SimilarityMatcher:
    """
    Compares a current workload profile with historical
    workload profiles.
    """

    def calculate_similarity(self, current_profile, historical_profile):
        """
        Calculate similarity between two workload profiles.

        Returns a value between 0 and 1:
        1.0 = exactly similar
        0.0 = completely different
        """

        features = [
            "process_count",
            "avg_cpu_usage",
            "avg_memory_usage",
            "avg_io_usage",
            "avg_burst_time"
        ]

        differences = []

        for feature in features:
            current_value = current_profile[feature]
            historical_value = historical_profile[feature]

            if current_value == 0 and historical_value == 0:
                difference = 0

            else:
                maximum = max(
                    abs(current_value),
                    abs(historical_value),
                    1
                )

                difference = (
                    abs(current_value - historical_value)
                    / maximum
                )

            differences.append(difference)

        average_difference = sum(differences) / len(differences)

        similarity = 1 - average_difference

        return round(max(0, similarity), 4)

    def find_similar_workloads(
        self,
        current_profile,
        historical_profiles,
        threshold=0.80
    ):
        """
        Find historical workloads whose similarity is
        greater than or equal to the threshold.
        """

        similar_workloads = []

        for historical_profile in historical_profiles:

            similarity = self.calculate_similarity(
                current_profile,
                historical_profile
            )

            if similarity >= threshold:

                result = {
                    "profile": historical_profile,
                    "similarity": similarity
                }

                similar_workloads.append(result)

        similar_workloads.sort(
            key=lambda x: x["similarity"],
            reverse=True
        )

        return similar_workloads