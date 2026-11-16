import pytest
from datetime import date

from custom_components.vehicle_log.calc import (
    add_months,
    consumption_segments,
    consumption_summary,
    entry_total,
    forecast_odometer,
    km_per_day,
    lpg_install_point,
    lpg_segments,
    lpg_view,
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


# -- LPG ---------------------------------------------------------------------


def lpg(odo, litres, cost, full=True, date="2026-11-01", petrol_price=None):
    return {**rf(odo, litres, cost, full, date), "fuel_type": "LPG", "petrol_price": petrol_price}


def pb(odo, litres, cost, full=True, date="2026-11-01", petrol_only=False):
    return {**rf(odo, litres, cost, full, date), "fuel_type": "Pb95",
            "price_per_litre": round(cost / litres, 3) if litres else None,
            "petrol_only": petrol_only}


def svc(stype, odo, total=None, date="2026-01-01"):
    return {"kind": "service", "service_type": stype, "date": date, "time": None,
            "odometer": odo, "total": total}


CAR = {"id": "v1", "name": "Car", "fuel_types": ["Pb95", "LPG"], "petrol_l_per_100km": 8.0}
TODAY = date(2026, 12, 1)


def _spans(segs):
    return [(s["from_odometer"], s["to_odometer"]) for s in segs]


def test_lpg_refuel_breaks_petrol_segment():
    segs = consumption_segments([
        pb(1000, 40, 240), lpg(1300, 30, 90), pb(1600, 40, 240), pb(2000, 40, 240),
    ])
    assert _spans(segs) == [(1600, 2000)]
    assert segs[0]["fuel"] == "petrol" and segs[0]["litres"] == 40


def test_post_install_segment_needs_petrol_only_flag():
    refuels = [
        pb(500, 40, 240), pb(1000, 40, 240), pb(1600, 40, 240),
        pb(2000, 40, 240, petrol_only=True),
    ]
    assert _spans(consumption_segments(refuels, install_odometer=1500)) == [
        (500, 1000), (1600, 2000),
    ]
    assert len(consumption_segments(refuels)) == 3


def test_lpg_segments_full_to_full():
    (s,) = lpg_segments([
        lpg(1000, 40, 120), pb(1100, 10, 60), lpg(1200, 20, 60, full=False),
        lpg(1500, 30, 90),
    ])
    assert (s["from_odometer"], s["to_odometer"]) == (1000, 1500)
    assert s["litres"] == 50 and s["l_per_100km"] == 10 and s["fuel"] == "lpg"


def test_install_point_earliest_with_odometer():
    p = lpg_install_point([
        svc("lpg_install", 101000, date="2026-03-01"),
        svc("lpg_install", None, date="2026-01-01"),
        svc("lpg_install", 100000, date="2026-02-01"),
        svc("oil_filter", 90000, date="2025-01-01"),
    ])
    assert p["odometer"] == 100000 and p["date"] == "2026-02-01"


def test_no_install_entry_gives_no_lpg_view():
    assert lpg_view(CAR, [pb(1000, 40, 240), svc("lpg_service", 900, 100)], TODAY) is None


def test_install_without_odometer_status():
    v = lpg_view(CAR, [svc("lpg_install", None, 3000)], TODAY)
    assert v["status"] == "no_install_odometer"
    assert v["lpg_cost"] == 3000 and v["fuel_savings"] is None


def test_savings_basic():
    v = lpg_view(CAR, [svc("lpg_install", 100000), lpg(100500, 50, 150, petrol_price=6.0)], TODAY)
    assert v["status"] == "ok"
    assert v["install_odometer"] == 100000 and v["install_date"] == "2026-01-01"
    assert v["baseline_l_per_100km"] == 8.0 and v["baseline_source"] == "manual"
    assert v["fuel_savings"] == 90 and v["net_savings"] == 90 and v["lpg_cost"] == 0
    assert v["progress_pct"] is None and v["remaining"] is None
    assert v["km_since_install"] == 500 and v["unpriced_count"] == 0


def test_savings_price_fallback_last_known():
    v = lpg_view(CAR, [
        pb(99900, 40, 260), svc("lpg_install", 100000), lpg(100500, 50, 150),
    ], TODAY)
    assert v["fuel_savings"] == 110


def test_savings_unpriced_counted_and_excluded():
    v = lpg_view(CAR, [
        svc("lpg_install", 100000), lpg(100500, 50, 999),
        lpg(101000, 50, 150, petrol_price=6.0),
    ], TODAY)
    assert v["unpriced_count"] == 1 and v["fuel_savings"] == 90


def test_savings_same_odometer_counts_cost():
    v = lpg_view(CAR, [
        svc("lpg_install", 100000), lpg(100500, 50, 150, petrol_price=6.0),
        lpg(100500, 10, 50, petrol_price=6.0),
    ], TODAY)
    assert v["fuel_savings"] == 40


def test_savings_ignores_refuels_without_odometer():
    v = lpg_view(CAR, [
        svc("lpg_install", 100000), lpg(None, 50, 999, petrol_price=6.0),
        lpg(100500, 50, 150, petrol_price=6.0),
    ], TODAY)
    assert v["fuel_savings"] == 90


@pytest.mark.parametrize(("litres", "km", "source", "savings"), [
    (96, 1200, "measured", 90),   # 8.0 l/100 measured over 1200 km
    (72, 900, "manual", 150),     # 900 km is not enough: manual 10.0 used
])
def test_baseline_switches_to_measured_after_1000_km(litres, km, source, savings):
    car = {**CAR, "petrol_l_per_100km": 10.0}
    v = lpg_view(car, [
        pb(90000, 40, 240), pb(90000 + km, litres, 432), svc("lpg_install", 100000),
        lpg(100500, 50, 150, petrol_price=6.0),
    ], TODAY)
    assert v["baseline_source"] == source and v["measured_km"] == km
    assert v["fuel_savings"] == pytest.approx(savings)


def test_no_baseline_status():
    car = {**CAR, "petrol_l_per_100km": None}
    v = lpg_view(car, [svc("lpg_install", 100000), lpg(100500, 50, 150, petrol_price=6.0)], TODAY)
    assert v["status"] == "no_baseline"
    assert v["fuel_savings"] is None and v["net_savings"] is None


def test_lpg_cost_and_payback():
    v = lpg_view(CAR, [
        svc("lpg_install", 100000, 3000), svc("lpg_service", 100300, 200, date="2026-06-01"),
        lpg(100500, 50, 150, petrol_price=6.0),
    ], TODAY)
    assert v["lpg_cost"] == 3200
    assert v["progress_pct"] == pytest.approx(2.8125)
    assert v["remaining"] == 3110 and v["net_savings"] == -3110
    assert v["paid_back"] is False


def test_payback_forecast_month():
    v = lpg_view(CAR, [
        svc("lpg_install", 100000, 300, date="2026-01-01"),
        lpg(100500, 50, 150, date="2026-01-21", petrol_price=6.0),
    ], date(2026, 1, 21))
    assert v["payback_odometer"] == 101667
    assert v["payback_month"] == "2026-03"


def test_payback_forecast_skipped_when_savings_near_zero():
    v = lpg_view(CAR, [
        svc("lpg_install", 100000, 4000, date="2026-01-01"),
        lpg(100500, 50, 239.99, date="2026-01-10", petrol_price=6.0),
        lpg(101100, 60, 288, date="2026-02-10", petrol_price=6.0),
    ], date(2026, 2, 10))
    assert v["fuel_savings"] == pytest.approx(0.01)
    assert v["payback_odometer"] is None and v["payback_month"] is None
    assert v["remaining"] == pytest.approx(3999.99)


def test_paid_back():
    v = lpg_view(CAR, [svc("lpg_install", 100000, 50), lpg(100500, 50, 150, petrol_price=6.0)], TODAY)
    assert v["paid_back"] is True and v["progress_pct"] == 100 and v["remaining"] == 0
    assert v["payback_odometer"] is None and v["net_savings"] == 40


def test_km_per_day_needs_two_weeks():
    assert km_per_day([svc("x", 1000, date="2026-01-01"), svc("x", 1100, date="2026-01-05")]) is None
    assert km_per_day([svc("x", 1000, date="2026-01-01"), svc("x", 1500, date="2026-01-21")]) == 25


def test_view_has_lpg_and_merged_segments():
    data = {
        "vehicles": [CAR], "reminders": [], "settings": {},
        "entries": [{**e, "id": str(i), "vehicle_id": "v1"} for i, e in enumerate([
            pb(90000, 40, 240), pb(90500, 40, 240), svc("lpg_install", 100000),
            lpg(100000, 40, 120), lpg(100400, 40, 120, petrol_price=6.0),
        ])],
    }
    v = build_view(data, TODAY)["vehicles"][0]
    assert v["lpg"]["fuel_savings"] == pytest.approx(400 * 0.08 * 6 - 120)
    assert v["consumption"]["last_l_per_100km"] == 8.0
    assert v["lpg_consumption"]["last_l_per_100km"] == 10.0
    assert [s["fuel"] for s in v["segments"]] == ["petrol", "lpg"]
