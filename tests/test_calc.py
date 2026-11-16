import pytest
from datetime import date

from custom_components.vehicle_log.calc import (
    add_months,
    consumption_segments,
    consumption_summary,
    entry_total,
    forecast_odometer,
    last_reading,
    build_view,
    odometer_update_status,
    reminder_status,
    normalize_refuel,
    parse_date,
)
from custom_components.vehicle_log.const import (
    DEFAULT_SETTINGS,
    FUEL_TYPES,
    REMINDER_TEMPLATES,
    SERVICE_TYPES,
)


def test_add_months_plain():
    assert add_months(date(2026, 9, 9), 12) == date(2027, 9, 9)


def test_add_months_clamps_month_end():
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)


def test_parse_date_iso():
    assert parse_date("2026-11-15") == date(2026, 11, 15)


def test_catalog_complete():
    assert len(SERVICE_TYPES) == 29
    assert SERVICE_TYPES["odometer_update"]["label"] == "Aktualizacja przebiegu"
    assert all(k in SERVICE_TYPES for k in REMINDER_TEMPLATES)


def rf(odo, litres, cost, full, date="2026-11-01", time=None):
    return {
        "kind": "refuel",
        "date": date,
        "time": time,
        "odometer": odo,
        "litres": litres,
        "total": cost,
        "full_tank": full,
    }


def test_entry_total_parts_labour():
    assert entry_total(500, 100, None, None, None) == 600


def test_entry_total_discount_then_tax():
    assert entry_total(1000, 0, 23, 10, 0) == 1107.0


def test_entry_total_all_none():
    assert entry_total(None, None, None, None, None) == 0.0


def test_entry_total_discount_amount():
    assert entry_total(500, 100, None, None, 50) == 550.0


def test_normalize_refuel_from_total_and_price():
    assert normalize_refuel(300, None, 6.0) == (300, 50.0, 6.0)


def test_normalize_refuel_from_litres_and_price():
    assert normalize_refuel(None, 40, 6.5) == (260.0, 40, 6.5)


def test_normalize_refuel_from_total_and_litres():
    assert normalize_refuel(250, 40, None) == (250, 40, 6.25)


def test_normalize_refuel_all_three_unchanged():
    assert normalize_refuel(250, 40, 6.0) == (250, 40, 6.0)


def test_normalize_refuel_needs_two():
    with pytest.raises(ValueError):
        normalize_refuel(300, None, None)


def test_normalize_refuel_zero_divisor_is_value_error():
    with pytest.raises(ValueError):
        normalize_refuel(300, None, 0)
    with pytest.raises(ValueError):
        normalize_refuel(300, 0, None)


def test_consumption_full_partial_full():
    r = [rf(1000, 40, 240, True), rf(1300, 20, 120, False), rf(1600, 15, 90, True)]
    (s,) = consumption_segments(r)
    assert s["km"] == 600
    assert s["litres"] == 35
    assert round(s["l_per_100km"], 2) == 5.83
    assert s["cost_per_100km"] == 35.0
    assert (s["from_odometer"], s["to_odometer"]) == (1000, 1600)


def test_consumption_needs_second_full():
    assert consumption_segments([rf(1000, 40, 240, True)]) == []


def test_consumption_skips_missing_odometer():
    r = [rf(1000, 40, 240, True), rf(None, 10, 60, False), rf(1500, 30, 180, True)]
    assert consumption_segments(r)[0]["litres"] == 30


def test_consumption_ignores_fills_before_first_full():
    r = [rf(800, 10, 60, False), rf(1000, 40, 240, True), rf(1500, 30, 180, True)]
    (s,) = consumption_segments(r)
    assert s["litres"] == 30 and s["km"] == 500


def test_consumption_sorted_and_two_segments():
    r = [rf(2000, 30, 180, True), rf(1000, 40, 240, True), rf(1500, 25, 150, True)]
    segs = consumption_segments(r)
    assert [s["to_odometer"] for s in segs] == [1500, 2000]


def test_consumption_summary():
    r = [rf(1000, 40, 240, True), rf(1500, 25, 150, True), rf(2500, 80, 480, True)]
    summ = consumption_summary(consumption_segments(r))
    assert round(summ["last_l_per_100km"], 2) == 8.0
    assert round(summ["avg_l_per_100km"], 2) == 7.0
    assert round(summ["avg_cost_per_100km"], 2) == 42.0


def test_consumption_summary_empty():
    assert consumption_summary([]) is None


def odo(date_str, odometer, vehicle_id="v1", **kw):
    return {
        "id": f"e-{vehicle_id}-{date_str}-{odometer}",
        "vehicle_id": vehicle_id,
        "kind": "odometer",
        "service_type": "odometer_update",
        "date": date_str,
        "time": None,
        "odometer": odometer,
        **kw,
    }


REM = {"id": "r1", "vehicle_id": "v1", "service_type": "oil_filter", "text": "Olej", "extra_text": "",
       "interval_km": 10000, "interval_months": 12, "baseline_odometer": 60000, "baseline_date": "2026-09-08"}


def test_reminder_status_matches_app_example():
    entries = [odo("2026-09-08", 60000), odo("2026-10-26", 62850)]
    s = reminder_status(REM, entries, date(2026, 11, 15), forecast_enabled=False)
    assert s["due_date"] == "2027-09-08" and s["due_odometer"] == 70000
    assert s["days_left"] == 297 and int(s["progress_time"]) == 18 and int(s["progress_km"]) == 28
    assert s["km_left"] == 7150 and s["is_due"] is False and s["progress_forecast"] is None


def test_due_when_km_passed():
    s = reminder_status(REM, [odo("2026-11-01", 70500)], date(2026, 11, 15), False)
    assert s["is_due"] is True


def test_time_only_reminder():
    r = {**REM, "interval_km": None, "interval_months": 6}
    s = reminder_status(r, [], date(2026, 11, 15), True)
    assert s["progress_km"] is None and s["due_odometer"] is None
    assert s["km_left"] is None and s["progress_forecast"] is None
    assert s["due_date"] == "2027-03-08" and isinstance(s["progress_time"], float)


def test_km_only_reminder_without_readings():
    r = {**REM, "interval_months": None}
    s = reminder_status(r, [], date(2026, 11, 15), True)
    assert s["due_date"] is None and s["days_left"] is None and s["progress_time"] is None
    assert s["km_left"] is None and s["progress_km"] is None and s["progress"] is None
    assert s["is_due"] is False


def test_progress_clamps_negative_to_zero():
    s = reminder_status(REM, [odo("2026-09-01", 59000)], date(2026, 9, 1), False)
    assert s["progress_km"] == 0 and s["progress_time"] == 0


def test_forecast_progress_used_when_enabled():
    e = [odo("2026-09-01", 60000), odo("2026-10-01", 63000)]  # 100 km/day
    s = reminder_status(REM, e, date(2026, 11, 15), True)
    assert s["progress_forecast"] > s["progress_km"]
    assert s["progress"] == max(s["progress_time"], s["progress_km"], s["progress_forecast"])


def test_forecast_linear():
    e = [odo("2026-09-01", 60000), odo("2026-10-01", 63000)]  # 100 km/day
    assert forecast_odometer(e, date(2026, 10, 11)) == 64000


def test_forecast_never_below_last_and_ignores_missing():
    e = [odo("2026-10-01", 63000), odo("2026-10-05", None)]
    assert forecast_odometer(e, date(2026, 11, 15)) == 63000


def test_forecast_none_without_readings():
    assert forecast_odometer([], date(2026, 11, 15)) is None


def test_forecast_short_span_returns_last():
    e = [odo("2026-11-01", 60000), odo("2026-11-05", 60400)]
    assert forecast_odometer(e, date(2026, 11, 15)) == 60400


def test_forecast_uses_all_when_year_window_too_short():
    e = [odo("2024-01-01", 50000), odo("2026-11-10", 60000), odo("2026-11-12", 60100)]
    # window (last 365 days) spans 2 days -> fall back to all: 10100 km / 1047 days
    f = forecast_odometer(e, date(2026, 11, 15))
    assert f == 60100 + round(10100 / 1047 * 3)


def test_last_reading_backdated_entry():
    e = [odo("2026-10-01", 63000), odo("2026-09-15", 61000)]
    assert last_reading(e) == (date(2026, 10, 1), 63000)


def test_odometer_update_due_after_120_days():
    st = odometer_update_status([odo("2026-07-01", 1)], date(2026, 11, 15), DEFAULT_SETTINGS)
    assert st["days_since"] == 137 and st["is_due"] is True and st["last_date"] == "2026-07-01"


def test_odometer_update_not_due_without_readings_or_when_disabled():
    st = odometer_update_status([], date(2026, 11, 15), DEFAULT_SETTINGS)
    assert st == {"last_date": None, "days_since": None, "is_due": False}
    off = {**DEFAULT_SETTINGS, "odometer_reminder_enabled": False}
    assert odometer_update_status([odo("2026-01-01", 1)], date(2026, 11, 15), off)["is_due"] is False


def test_build_view_sorts_entries_newest_first():
    refuel = {"id": "f1", "vehicle_id": "v1", "kind": "refuel", "service_type": "refuel", "date": "2026-10-20",
              "time": "08:00", "odometer": 63000, "litres": 40.0, "total": 240.0, "full_tank": True}
    refuel2 = {**refuel, "id": "f2", "date": "2026-11-01", "odometer": 63500, "litres": 30.0, "total": 180.0}
    data = {
        "vehicles": [
            {"id": "v1", "name": "Auto", "purchase_date": "2026-01-01", "icon": "mdi:car"},
            {"id": "v2", "name": "Drugie", "purchase_date": None, "icon": "mdi:car"},
        ],
        "entries": [
            odo("2026-09-08", 60000),
            refuel,
            refuel2,
            odo("2026-10-26", 62850, vehicle_id="v2"),
            odo("2026-10-01", 61000),
        ],
        "reminders": [
            {**REM, "id": "r-low", "baseline_odometer": 60000},
            {**REM, "id": "r-high", "baseline_odometer": 90000, "baseline_date": "2025-11-01"},
        ],
        "settings": dict(DEFAULT_SETTINGS),
        "notified": [],
    }
    view = build_view(data, date(2026, 11, 15))
    v1, v2 = view["vehicles"]
    assert [e["date"] for e in v1["entries"]] == ["2026-11-01", "2026-10-20", "2026-10-01", "2026-09-08"]
    assert [e["vehicle_id"] for e in v2["entries"]] == ["v2"]
    assert v1["odometer"] == 63500 and v2["odometer"] == 62850
    assert v1["consumption"]["avg_l_per_100km"] == pytest.approx(30.0 / 500 * 100)
    assert v2["consumption"] is None and v2["reminders"] == []
    assert [r["id"] for r in v1["reminders"]] == ["r-high", "r-low"]
    assert all("progress" in r and "is_due" in r and "due_date" in r for r in v1["reminders"])
    assert v1["odometer_update"]["last_date"] == "2026-11-01"
    assert v1["forecast_odometer"] >= 63500
    assert view["settings"] == DEFAULT_SETTINGS
    assert view["service_types"] == SERVICE_TYPES
    assert view["reminder_templates"] == REMINDER_TEMPLATES and view["fuel_types"] == FUEL_TYPES


def test_reminder_without_baseline_odometer_has_no_km_due():
    rem = {"baseline_date": "2026-01-01", "baseline_odometer": None,
           "interval_km": 10000, "interval_months": 12}
    entries = [{"date": "2026-06-01", "odometer": 5000}, {"date": "2026-10-01", "odometer": 9000}]
    st = reminder_status(rem, entries, date(2026, 11, 1), True)
    assert st["due_odometer"] is None and st["km_left"] is None
    assert st["progress_km"] is None and st["progress_forecast"] is None
    assert st["due_date"] == "2027-01-01"


def test_build_view_survives_bad_records():
    """A corrupt record is flagged, never raised: it must not brick the view."""
    data = {
        "vehicles": [{"id": "v1", "name": "Auto", "purchase_date": None, "icon": None}],
        "entries": [
            odo("2026-09-04", 60000),
            odo("not-a-date", 61000),
            odo("2026-10-01", "x"),
            odo("2026-10-02", 62000, time=5),
        ],
        "reminders": [
            {**REM, "id": "r-huge", "interval_months": 100000},
            {**REM, "id": "r-baddate", "baseline_date": "garbage"},
            {"id": "r-missing", "vehicle_id": "v1"},
            {**REM, "id": "r-ok"},
        ],
        "settings": {**DEFAULT_SETTINGS, "odometer_reminder_days": "many"},
        "notified": [],
    }
    view = build_view(data, date(2026, 11, 15))
    (v,) = view["vehicles"]
    by_id = {r["id"]: r for r in v["reminders"]}
    assert {i for i, r in by_id.items() if r.get("error")} == {
        "r-huge", "r-baddate", "r-missing",
    }
    assert by_id["r-huge"]["is_due"] is False and by_id["r-huge"]["due_date"] is None
    assert "error" not in by_id["r-ok"] and by_id["r-ok"]["due_date"] == "2027-09-08"
    assert sum(1 for e in v["entries"] if e.get("error")) == 3
    assert v["odometer"] == 60000
    assert v["odometer_update"]["is_due"] is False  # 72 days < default 120
    late = build_view(data, date(2027, 3, 1))["vehicles"][0]
    assert late["odometer_update"]["is_due"] is True  # bad setting -> default days
