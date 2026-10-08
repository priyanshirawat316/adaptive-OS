import pytest

from adaptive_engine import (
    WorkloadProfiler,
    WorkloadSimilarity,
    ColdStartSelector,
    AdaptiveDecisionEngine,
)


@pytest.fixture
def processes():
    return [
        {"pid": 1, "arrival_time": 0, "burst_time": 3, "priority": 2},
        {"pid": 2, "arrival_time": 1, "burst_time": 12, "priority": 1},
        {"pid": 3, "arrival_time": 2, "burst_time": 4, "priority": 3},
    ]


def test_profiler_extracts_features(processes):
    features = WorkloadProfiler().profile(processes)

    assert features["process_count"] == 3
    assert features["average_burst_time"] == pytest.approx(19 / 3)
    assert features["max_burst_time"] == 12
    assert features["min_burst_time"] == 3


def test_profiler_rejects_empty_workload():
    with pytest.raises(ValueError):
        WorkloadProfiler().profile([])


def test_identical_workloads_have_full_similarity(processes):
    profiler = WorkloadProfiler()
    features = profiler.profile(processes)

    score = WorkloadSimilarity().similarity_score(features, features)

    assert score == pytest.approx(1.0)


def test_cold_start_selects_baseline(processes):
    features = WorkloadProfiler().profile(processes)
    algorithm = ColdStartSelector().select_algorithm(features)

    assert algorithm in ColdStartSelector.ALGORITHMS


def test_engine_uses_cold_start_without_history(processes):
    result = AdaptiveDecisionEngine().decide(processes)

    assert result["mode"] == "cold_start"
    assert result["algorithm"] in ColdStartSelector.ALGORITHMS


def test_engine_uses_historical_performance(processes):
    engine = AdaptiveDecisionEngine()
    features = WorkloadProfiler().profile(processes)

    history = [{
        "features": features,
        "algorithm": "SJF",
        "metrics": {"average_waiting_time": 2.0},
    }]

    result = engine.decide(processes, history)

    assert result["mode"] == "historical"
    assert result["algorithm"] == "SJF"
    assert result["similarity"] == pytest.approx(1.0)


def test_profiler_rejects_zero_burst_time():
    with pytest.raises(ValueError):
        WorkloadProfiler().profile([
            {"arrival_time": 0, "burst_time": 0, "priority": 1}
        ])


def test_profiler_rejects_negative_arrival_time():
    with pytest.raises(ValueError):
        WorkloadProfiler().profile([
            {"arrival_time": -1, "burst_time": 5, "priority": 1}
        ])


def test_profiler_rejects_non_numeric_burst_time():
    with pytest.raises(ValueError):
        WorkloadProfiler().profile([
            {"arrival_time": 0, "burst_time": "abc", "priority": 1}
        ])


def test_profiler_rejects_missing_priority():
    with pytest.raises(ValueError):
        WorkloadProfiler().profile([
            {"arrival_time": 0, "burst_time": 5}
        ])


def test_similarity_ignores_invalid_historical_records():
    matcher = WorkloadSimilarity()
    current = {
        "process_count": 3,
        "average_burst_time": 5,
        "burst_std_dev": 2,
        "average_arrival_gap": 1,
        "priority_spread": 2,
    }
    history = [
        {"features": {"process_count": "invalid"}},
        {"features": current, "algorithm": "SJF"},
        None,
    ]

    matches = matcher.find_similar(current, history)

    assert len(matches) == 1
    assert matches[0]["record"]["algorithm"] == "SJF"
    assert matches[0]["similarity"] == pytest.approx(1.0)


def test_similarity_rejects_invalid_threshold():
    with pytest.raises(ValueError):
        WorkloadSimilarity().find_similar({}, [], threshold=1.5)
