class ColdStartSelector:
    """Choose a baseline scheduling algorithm without history."""

    ALGORITHMS = ("FCFS", "SJF", "PRIORITY", "ROUND_ROBIN")

    def select_algorithm(self, features):
        count = features["process_count"]
        average_burst = features["average_burst_time"]
        burst_std_dev = features["burst_std_dev"]
        priority_spread = features["priority_spread"]

        if priority_spread > 0:
            return "PRIORITY"

        if count >= 8 and average_burst >= 5:
            return "ROUND_ROBIN"

        if average_burst > 0:
            if burst_std_dev / average_burst >= 0.5:
                return "SJF"

        return "FCFS"
