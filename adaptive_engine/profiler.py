from math import isfinite, sqrt


class WorkloadProfiler:
    """Extract useful features from a list of processes."""

    REQUIRED_FIELDS = ("arrival_time", "burst_time", "priority")

    @staticmethod
    def _get(process, key, default=None):
        if isinstance(process, dict):
            return process.get(key, default)
        return getattr(process, key, default)

    def profile(self, processes):
        if not isinstance(processes, (list, tuple)) or not processes:
            raise ValueError(
                "Workload must be a non-empty list or tuple of processes."
            )

        arrivals = []
        bursts = []
        priorities = []

        for index, process in enumerate(processes):
            if process is None:
                raise ValueError(f"Process at index {index} is invalid.")

            values = {}

            for field in self.REQUIRED_FIELDS:
                value = self._get(process, field)

                if value is None or isinstance(value, bool):
                    raise ValueError(
                        f"Process at index {index} is missing a valid "
                        f"'{field}' value."
                    )

                try:
                    value = float(value)
                except (TypeError, ValueError):
                    raise ValueError(
                        f"'{field}' in process {index} must be numeric."
                    ) from None

                if not isfinite(value):
                    raise ValueError(
                        f"'{field}' in process {index} must be finite."
                    )

                values[field] = value

            if values["arrival_time"] < 0:
                raise ValueError("Arrival times cannot be negative.")

            if values["burst_time"] <= 0:
                raise ValueError("Burst times must be greater than zero.")

            arrivals.append(values["arrival_time"])
            bursts.append(values["burst_time"])
            priorities.append(values["priority"])

        count = len(processes)
        average_burst = sum(bursts) / count
        variance = sum(
            (burst - average_burst) ** 2 for burst in bursts
        ) / count

        sorted_arrivals = sorted(arrivals)
        average_arrival_gap = (
            sum(
                sorted_arrivals[i] - sorted_arrivals[i - 1]
                for i in range(1, count)
            ) / (count - 1)
            if count > 1 else 0.0
        )

        return {
            "process_count": count,
            "average_burst_time": average_burst,
            "max_burst_time": max(bursts),
            "min_burst_time": min(bursts),
            "burst_std_dev": sqrt(variance),
            "average_arrival_gap": average_arrival_gap,
            "priority_spread": max(priorities) - min(priorities),
            "zero_arrival_processes": sum(
                arrival == 0 for arrival in arrivals
            ),
        }
