class WorkloadProfiler:
    """
    Analyzes a workload and creates a workload profile.

    The profile contains:
    - Number of processes
    - Average CPU usage
    - Average memory usage
    - Average I/O usage
    - Average burst time
    """

    def profile_workload(self, processes):

        if not processes:
            raise ValueError("Workload cannot be empty.")

        process_count = len(processes)

        avg_cpu = sum(
            process["cpu_usage"] for process in processes
        ) / process_count

        avg_memory = sum(
            process["memory_usage"] for process in processes
        ) / process_count

        avg_io = sum(
            process["io_usage"] for process in processes
        ) / process_count

        avg_burst = sum(
            process["burst_time"] for process in processes
        ) / process_count

        profile = {
            "process_count": process_count,
            "avg_cpu_usage": round(avg_cpu, 2),
            "avg_memory_usage": round(avg_memory, 2),
            "avg_io_usage": round(avg_io, 2),
            "avg_burst_time": round(avg_burst, 2)
        }

        return profile