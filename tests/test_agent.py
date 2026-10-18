import importlib.util
import sys
import types
import unittest
from unittest.mock import patch


class AccessDenied(Exception):
    pass


class NoSuchProcess(Exception):
    pass


class ZombieProcess(Exception):
    pass


class FakeProcess:
    def __init__(self, pid, name, cpu, status="running", memory=1048576):
        self.pid = pid
        self.name = name
        self.cpu = cpu
        self.status = status
        self.memory = memory
        self.calls = 0

    def cpu_percent(self, interval=None):
        self.calls += 1
        return 0 if self.calls == 1 else self.cpu

    def as_dict(self, attrs=None, ad_value=None):
        return {
            "pid": self.pid,
            "name": self.name,
            "create_time": 1700000000,
            "status": self.status,
            "memory_info": types.SimpleNamespace(rss=self.memory),
        }


class FailingProcess:
    def cpu_percent(self, interval=None):
        raise AccessDenied()


fake_psutil = types.SimpleNamespace(
    Process=FakeProcess,
    AccessDenied=AccessDenied,
    NoSuchProcess=NoSuchProcess,
    ZombieProcess=ZombieProcess,
    process_iter=lambda: [],
)
sys.modules["psutil"] = fake_psutil

SPEC = importlib.util.spec_from_file_location("adaptiveos_agent", "agent.py")
agent = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(agent)


class AgentCollectionTests(unittest.TestCase):
    def test_snapshot_contains_only_basic_observations_and_timestamp(self):
        process = FakeProcess(101, "worker", 18.25)
        fake_psutil.process_iter = lambda: [process]
        with patch.object(agent.time, "sleep"):
            snapshot = agent.collect_snapshot(0.5)

        self.assertEqual(snapshot["schemaVersion"], "1")
        self.assertEqual(snapshot["observationSeconds"], 0.5)
        self.assertTrue(snapshot["observedAt"].endswith("+00:00"))
        self.assertEqual(len(snapshot["processes"]), 1)
        self.assertEqual(snapshot["processes"][0]["pid"], 101)
        self.assertEqual(snapshot["processes"][0]["cpuPercent"], 18.25)
        self.assertEqual(snapshot["processes"][0]["memoryMb"], 1.0)

    def test_process_errors_are_skipped_without_aborting_snapshot(self):
        fake_psutil.process_iter = lambda: [FailingProcess()]
        with patch.object(agent.time, "sleep"):
            snapshot = agent.collect_snapshot(0.2)
        self.assertEqual(snapshot["processes"], [])

    def test_iso_helper_handles_missing_creation_time(self):
        self.assertIsNone(agent.iso_utc(None))


if __name__ == "__main__":
    unittest.main()
