"""Tests for the persistent store."""
import copy
from datetime import date, timedelta

import pytest
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.vehicle_log.const import DEFAULT_SETTINGS
from custom_components.vehicle_log.store import VehicleLogStore, _VehicleLogStorage
from custom_components.vehicle_log.xlsx_import import parse_car_notes_xlsx
from tests.xlsx_factory import make_xlsx

TWO_VEHICLES = {
    "Auto A": {"purchase_date": "14.02.2024", "rows": [
        ["01.03.2026", 1000, "Olej z filtrem", 100, 50, None, None, 23, 184.5, "F1", "ok"],
        ["02.04.2026", 2000, "Aktualizacja przebiegu", None, None, None, None, None, None, "", ""],
    ]},
    "Auto B": {"purchase_date": None, "rows": [
        ["05.05.2026", 500, "Wycieraczki", 40, None, None, None, None, 40, "", ""],
    ]},
}


async def _store(hass) -> VehicleLogStore:
    store = VehicleLogStore(hass)
    await store.async_load()
    return store


def _service(vid, **kw):
    e = {
        "vehicle_id": vid, "kind": "service", "service_type": "oil_filter",
        "name": "Oil", "date": "2026-11-10", "odometer": 103500,
        "parts": 100, "labour": 50,
    }
    e.update(kw)
    return e


async def _with_reminder(store):
    v = await store.async_save_vehicle({"name": "Car"})
    r = await store.async_save_reminder({
        "vehicle_id": v["id"], "service_type": "oil_filter", "text": "Oil",
        "interval_km": 10000, "interval_months": 12,
        "baseline_odometer": 60000, "baseline_date": "2026-09-08",
    })
    return v, r


async def test_empty_load(hass):
    store = await _store(hass)
    assert store.data == {
        "vehicles": [], "entries": [], "reminders": [],
        "settings": DEFAULT_SETTINGS, "notified": [], "quarantine": [],
    }


async def test_logging_service_resets_matching_reminder(hass):
    store = await _store(hass)
    v, r = await _with_reminder(store)
    await store.async_mark_notified({f"reminder:{r['id']}", "odometer:x"})
    await store.async_save_entry(_service(v["id"]))
    got = store.data["reminders"][0]
    assert got["baseline_date"] == "2026-11-10"
    assert got["baseline_odometer"] == 103500
    assert store.notified == {"odometer:x"}


async def test_other_service_type_does_not_reset(hass):
    store = await _store(hass)
    v, _ = await _with_reminder(store)
    await store.async_save_entry(_service(v["id"], service_type="wipers"))
    assert store.data["reminders"][0]["baseline_date"] == "2026-09-08"


async def test_backdated_service_does_not_reset(hass):
    store = await _store(hass)
    v, r = await _with_reminder(store)
    await store.async_mark_notified({f"reminder:{r['id']}"})
    await store.async_save_entry(_service(v["id"], date="2026-08-01", odometer=95000))
    got = store.data["reminders"][0]
    assert got["baseline_date"] == "2026-09-08"
    assert got["baseline_odometer"] == 60000
    assert f"reminder:{r['id']}" in store.notified


async def test_service_without_odometer_uses_last_reading(hass):
    store = await _store(hass)
    v, _ = await _with_reminder(store)
    await store.async_save_entry({
        "vehicle_id": v["id"], "kind": "odometer", "date": "2026-10-01",
        "odometer": 102000, "name": "Przebieg",
    })
    await store.async_save_entry(_service(v["id"], odometer=None))
    assert store.data["reminders"][0]["baseline_odometer"] == 102000


async def test_service_total_computed_only_when_none(hass):
    store = await _store(hass)
    v = await store.async_save_vehicle({"name": "Car"})
    a = await store.async_save_entry(_service(v["id"], tax_pct=10))
    b = await store.async_save_entry(_service(v["id"], total=99.0))
    assert a["total"] == 165.0
    assert b["total"] == 99.0


async def test_refuel_computes_price_and_type(hass):
    store = await _store(hass)
    v = await store.async_save_vehicle({"name": "Car"})
    e = await store.async_save_entry({
        "vehicle_id": v["id"], "kind": "refuel", "name": "Tank",
        "date": "2026-11-01", "odometer": 1000, "total": 300.0, "litres": 50.0,
    })
    assert e["service_type"] == "refuel"
    assert e["price_per_litre"] == 6.0


async def test_odometer_entry_type(hass):
    store = await _store(hass)
    v = await store.async_save_vehicle({"name": "Car"})
    e = await store.async_save_entry({
        "vehicle_id": v["id"], "kind": "odometer", "name": "Przebieg",
        "date": "2026-11-01", "odometer": 1000,
    })
    assert e["service_type"] == "odometer_update"


async def test_save_entry_replaces_by_id_and_returns_copy(hass):
    store = await _store(hass)
    v = await store.async_save_vehicle({"name": "Car"})
    e = await store.async_save_entry(_service(v["id"], service_type="wipers"))
    e2 = await store.async_save_entry({**e, "name": "Changed"})
    assert e2["id"] == e["id"]
    assert len(store.data["entries"]) == 1
    e2["name"] = "mutated"
    assert store.data["entries"][0]["name"] == "Changed"


async def test_new_reminder_gets_baseline(hass, freezer):
    freezer.move_to("2026-11-15 10:00:00+00:00")
    store = await _store(hass)
    v = await store.async_save_vehicle({"name": "Car"})
    await store.async_save_entry({
        "vehicle_id": v["id"], "kind": "odometer", "name": "x",
        "date": "2026-11-01", "odometer": 5000,
    })
    r = await store.async_save_reminder(
        {"vehicle_id": v["id"], "service_type": "wipers", "text": "Wipers"}
    )
    assert r["baseline_date"] == "2026-11-15"
    assert r["baseline_odometer"] == 5000


async def test_editing_reminder_keeps_baseline(hass):
    store = await _store(hass)
    v, r = await _with_reminder(store)
    await store.async_save_entry(
        {"vehicle_id": v["id"], "kind": "odometer", "name": "x",
         "date": "2026-11-01", "odometer": 120000}
    )
    edited = await store.async_save_reminder({
        "id": r["id"], "vehicle_id": v["id"], "service_type": "oil_filter",
        "text": "Oil changed text", "interval_km": 15000, "interval_months": 12,
    })
    assert edited["text"] == "Oil changed text"
    assert edited["baseline_date"] == "2026-09-08"
    assert edited["baseline_odometer"] == 60000
    # an explicit baseline in the payload still wins
    again = await store.async_save_reminder({
        "id": r["id"], "vehicle_id": v["id"], "service_type": "oil_filter",
        "baseline_date": "2026-10-01", "baseline_odometer": 70000,
    })
    assert (again["baseline_date"], again["baseline_odometer"]) == ("2026-10-01", 70000)
    assert len(store.data["reminders"]) == 1


async def test_reset_reminder(hass):
    store = await _store(hass)
    _, r = await _with_reminder(store)
    await store.async_mark_notified({f"reminder:{r['id']}"})
    await store.async_reset_reminder(r["id"], "2026-12-01", 70000)
    got = store.data["reminders"][0]
    assert (got["baseline_date"], got["baseline_odometer"]) == ("2026-12-01", 70000)
    assert store.notified == set()


async def test_delete_vehicle_cascades(hass):
    store = await _store(hass)
    v, r = await _with_reminder(store)
    other = await store.async_save_vehicle({"name": "Other"})
    await store.async_save_entry(_service(v["id"]))
    await store.async_save_entry(_service(other["id"]))
    await store.async_delete_vehicle(v["id"])
    assert [x["id"] for x in store.data["vehicles"]] == [other["id"]]
    assert [e["vehicle_id"] for e in store.data["entries"]] == [other["id"]]
    assert store.data["reminders"] == []


async def test_delete_entry_and_reminder(hass):
    store = await _store(hass)
    v, r = await _with_reminder(store)
    e = await store.async_save_entry(_service(v["id"]))
    await store.async_delete_entry(e["id"])
    await store.async_delete_reminder(r["id"])
    assert store.data["entries"] == []
    assert store.data["reminders"] == []


async def test_save_settings_merges(hass):
    store = await _store(hass)
    await store.async_save_settings({"odometer_reminder_days": 30})
    assert store.data["settings"]["odometer_reminder_days"] == 30
    assert store.data["settings"]["forecast_enabled"] is True
    assert DEFAULT_SETTINGS["odometer_reminder_days"] == 120


async def test_unknown_references_rejected(hass):
    store = await _store(hass)
    v = await store.async_save_vehicle({"name": "Car"})
    with pytest.raises(ValueError):
        await store.async_save_entry(_service("nope"))
    with pytest.raises(ValueError):
        await store.async_save_entry(_service(v["id"], service_type="bogus"))
    with pytest.raises(ValueError):
        await store.async_save_reminder(
            {"vehicle_id": "nope", "service_type": "wipers", "text": "x"}
        )


async def test_rejects_too_long_name(hass):
    store = await _store(hass)
    v = await store.async_save_vehicle({"name": "Car"})
    with pytest.raises(ValueError):
        await store.async_save_entry(_service(v["id"], name="x" * 71))
    assert store.data["entries"] == []


@pytest.mark.parametrize(
    ("field", "limit"),
    [("part_numbers", 300), ("comment", 1000)],
)
async def test_rejects_too_long_entry_fields(hass, field, limit):
    store = await _store(hass)
    v = await store.async_save_vehicle({"name": "Car"})
    await store.async_save_entry(_service(v["id"], **{field: "x" * limit}))
    with pytest.raises(ValueError):
        await store.async_save_entry(_service(v["id"], **{field: "x" * (limit + 1)}))


async def test_rejects_too_long_reminder_text(hass):
    store = await _store(hass)
    v = await store.async_save_vehicle({"name": "Car"})
    base = {"vehicle_id": v["id"], "service_type": "wipers"}
    with pytest.raises(ValueError):
        await store.async_save_reminder({**base, "text": "x" * 71})
    with pytest.raises(ValueError):
        await store.async_save_reminder({**base, "text": "ok", "extra_text": "x" * 301})


async def test_import_and_reimport_idempotent(hass):
    store = await _store(hass)
    parsed = parse_car_notes_xlsx(make_xlsx(TWO_VEHICLES))
    first = await store.async_import(parsed)
    assert first == {"vehicles_added": 2, "entries_added": 3, "entries_skipped": 0}
    second = await store.async_import(parsed)
    assert second == {
        "vehicles_added": 0, "entries_added": 0, "entries_skipped": first["entries_added"]
    }
    assert len(store.data["vehicles"]) == 2
    assert store.data["reminders"] == []
    a = next(v for v in store.data["vehicles"] if v["name"] == "Auto A")
    assert a["purchase_date"] == "2024-02-14"


async def test_import_matches_vehicle_case_insensitive_and_keeps_purchase_date(hass):
    store = await _store(hass)
    v = await store.async_save_vehicle({"name": "auto a", "purchase_date": "2020-01-01"})
    res = await store.async_import(parse_car_notes_xlsx(make_xlsx(TWO_VEHICLES)))
    assert res["vehicles_added"] == 1
    assert len(store.data["vehicles"]) == 2
    assert store.data["vehicles"][0]["purchase_date"] == "2020-01-01"
    assert {e["vehicle_id"] for e in store.data["entries"]} >= {v["id"]}


async def test_import_does_not_reset_reminders(hass):
    store = await _store(hass)
    v = await store.async_save_vehicle({"name": "Auto A"})
    await store.async_save_reminder({
        "vehicle_id": v["id"], "service_type": "oil_filter", "text": "Oil",
        "baseline_odometer": 1, "baseline_date": "2020-01-01",
    })
    await store.async_import(parse_car_notes_xlsx(make_xlsx(TWO_VEHICLES)))
    assert store.data["reminders"][0]["baseline_date"] == "2020-01-01"


async def test_listeners_notified_and_unsubscribed(hass):
    store = await _store(hass)
    calls = []
    unsub = store.add_listener(lambda: calls.append(1))
    await store.async_save_vehicle({"name": "Car"})
    assert calls == [1]
    unsub()
    await store.async_save_vehicle({"name": "Car2"})
    assert calls == [1]


async def test_persists_across_reload(hass, hass_storage):
    store = await _store(hass)
    v = await store.async_save_vehicle({"name": "Car"})
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=2))
    await hass.async_block_till_done()
    assert hass_storage["vehicle_log"]["data"]["vehicles"][0]["id"] == v["id"]
    reloaded = await _store(hass)
    assert [x["id"] for x in reloaded.data["vehicles"]] == [v["id"]]


async def _vehicle(store):
    return await store.async_save_vehicle({"name": "Car"})


@pytest.mark.parametrize("field,value", [
    ("interval_months", 100000), ("interval_months", 0), ("interval_months", 1201),
    ("interval_months", -3), ("interval_km", 0), ("interval_km", 1_000_001),
    ("interval_months", 6.5), ("interval_months", True), ("interval_km", "10"),
    ("baseline_odometer", -1), ("baseline_date", "2026-13-40"),
    ("baseline_date", "11.02.2024"), ("baseline_date", 5),
    ("baseline_odometer", float("nan")), ("baseline_odometer", float("inf")),
])
async def test_reminder_rejects_unsafe_values(hass, field, value):
    store = await _store(hass)
    v = await _vehicle(store)
    base = {"vehicle_id": v["id"], "service_type": "oil_filter", "text": "Oil"}
    with pytest.raises(ValueError):
        await store.async_save_reminder({**base, field: value})
    assert store.data["reminders"] == []


async def test_reminder_accepts_boundary_values(hass):
    store = await _store(hass)
    v = await _vehicle(store)
    r = await store.async_save_reminder({
        "vehicle_id": v["id"], "service_type": "oil_filter", "text": "Oil",
        "interval_months": 1200, "interval_km": 1_000_000,
    })
    assert (r["interval_months"], r["interval_km"]) == (1200, 1_000_000)


@pytest.mark.parametrize("patch", [
    {"date": "garbage"}, {"date": "2026-02-30"}, {"odometer": -5},
    {"odometer": 12.5}, {"total": float("nan")}, {"parts": float("inf")},
    {"labour": "10"}, {"time": "later"}, {"full_tank": "yes"},
])
async def test_entry_rejects_unsafe_values(hass, patch):
    store = await _store(hass)
    v = await _vehicle(store)
    with pytest.raises(ValueError):
        await store.async_save_entry(_service(v["id"], **patch))
    assert store.data["entries"] == []


async def test_reset_rejects_bad_date_and_odometer(hass):
    store = await _store(hass)
    _, r = await _with_reminder(store)
    with pytest.raises(ValueError):
        await store.async_reset_reminder(r["id"], "nope", None)
    with pytest.raises(ValueError):
        await store.async_reset_reminder(r["id"], "2026-12-01", -1)


@pytest.mark.parametrize("settings", [
    {"odometer_reminder_days": 0}, {"odometer_reminder_days": 3651},
    {"odometer_reminder_days": "120"}, {"odometer_reminder_days": None},
    {"odometer_reminder_days": True}, {"forecast_enabled": "yes"},
    {"odometer_reminder_enabled": 1},
])
async def test_settings_rejects_bad_values(hass, settings):
    store = await _store(hass)
    with pytest.raises(ValueError):
        await store.async_save_settings(settings)
    assert store.data["settings"] == DEFAULT_SETTINGS


async def test_settings_accepts_valid_values(hass):
    store = await _store(hass)
    await store.async_save_settings({"odometer_reminder_days": 3650, "forecast_enabled": False})
    assert store.data["settings"]["odometer_reminder_days"] == 3650


async def test_vehicle_rejects_bad_purchase_date(hass):
    store = await _store(hass)
    with pytest.raises(ValueError):
        await store.async_save_vehicle({"name": "Car", "purchase_date": "soon"})


async def test_service_without_cost_inputs_has_no_total(hass):
    store = await _store(hass)
    v = await _vehicle(store)
    e = await store.async_save_entry(
        {"vehicle_id": v["id"], "kind": "service", "service_type": "wheels",
         "date": "2026-11-10"})
    assert e["total"] is None
    paid = await store.async_save_entry(_service(v["id"], id=None))
    assert paid["total"] == 150.0


async def test_client_supplied_entry_id_is_idempotent(hass):
    store = await _store(hass)
    v = await _vehicle(store)
    first = await store.async_save_entry(_service(v["id"], id="c0ffee00112233445566778899aabbcc"))
    again = await store.async_save_entry(_service(v["id"], id=first["id"]))
    assert first["id"] == again["id"] == "c0ffee00112233445566778899aabbcc"
    assert len(store.data["entries"]) == 1


IDENTICAL_ROWS = {"Auto A": {"purchase_date": None, "rows": [
    ["01.03.2024", 1000, "Wycieraczki", 20, None, None, None, None, 20, "", ""],
    ["01.03.2024", 1000, "Wycieraczki", 20, None, None, None, None, 20, "", ""],
]}}


async def test_import_keeps_identical_rows_once_then_dedupes(hass):
    store = await _store(hass)
    parsed = parse_car_notes_xlsx(make_xlsx(IDENTICAL_ROWS))
    first = await store.async_import(parsed)
    assert first["entries_added"] == 2 and first["entries_skipped"] == 0
    second = await store.async_import(parsed)
    assert second["entries_added"] == 0 and second["entries_skipped"] == 2
    assert len(store.data["entries"]) == 2


async def test_failing_import_leaves_store_unchanged(hass):
    store = await _store(hass)
    await store.async_import(parse_car_notes_xlsx(make_xlsx(TWO_VEHICLES)))
    before = copy.deepcopy(store.data)
    parsed = parse_car_notes_xlsx(make_xlsx({
        "Auto C": {"purchase_date": None, "rows": [
            ["01.03.2024", 1000, "Koła", 20, None, None, None, None, 20, "", ""],
            ["02.03.2024", 1100, "Koła", 20, None, None, None, None, 20, "", ""],
        ]}}))
    parsed[0]["entries"][1]["kind"] = "bogus"  # fails after the first row passed
    with pytest.raises(ValueError):
        await store.async_import(parsed)
    assert store.data == before


async def test_deleting_reminder_or_vehicle_clears_notified_keys(hass):
    store = await _store(hass)
    v, r = await _with_reminder(store)
    await store.async_mark_notified({f"reminder:{r['id']}", f"odometer:{v['id']}"})
    await store.async_delete_reminder(r["id"])
    assert store.notified == {f"odometer:{v['id']}"}
    r2 = await store.async_save_reminder({
        "vehicle_id": v["id"], "service_type": "oil_filter", "text": "Two",
    })
    await store.async_mark_notified({f"reminder:{r2['id']}"})
    await store.async_delete_vehicle(v["id"])
    assert store.notified == set()


async def test_load_repairs_corrupt_storage(hass, hass_storage):
    hass_storage["vehicle_log"] = {
        "version": 1, "minor_version": 1, "key": "vehicle_log",
        "data": {
            "vehicles": [{"id": "v1", "name": "A"}, "junk", {"name": "no id"}],
            "entries": [{"id": "e1", "vehicle_id": "v1"}, 5],
            "reminders": "nope",
            "settings": {"odometer_reminder_days": "x", "forecast_enabled": False},
            "notified": None,
        },
    }
    store = await _store(hass)
    assert [v["id"] for v in store.data["vehicles"]] == ["v1"]
    assert store.data["entries"] == [] and store.data["reminders"] == []
    assert store.data["notified"] == []
    from custom_components.vehicle_log.calc import build_view

    assert build_view(store.data, date(2026, 11, 16))["vehicles"][0]["entries"] == []
    assert store.data["settings"]["odometer_reminder_days"] == 120
    assert store.data["settings"]["forecast_enabled"] is False


async def test_migration_hook_called_for_older_version(hass, hass_storage):
    hass_storage["vehicle_log"] = {
        "version": 0, "minor_version": 1, "key": "vehicle_log",
        "data": {"vehicles": [{"id": "v1", "name": "Old"}]},
    }
    seen = []
    original = _VehicleLogStorage._async_migrate_func

    async def spy(self, major, minor, data):
        seen.append((major, minor))
        return await original(self, major, minor, data)

    _VehicleLogStorage._async_migrate_func = spy
    try:
        store = await _store(hass)
    finally:
        _VehicleLogStorage._async_migrate_func = original
    assert seen == [(0, 1)]
    assert store.data["vehicles"][0]["name"] == "Old"


async def test_migration_hook_rejects_newer_major(hass):
    store = await _store(hass)
    with pytest.raises(NotImplementedError):
        await store._store._async_migrate_func(99, 1, {})


async def test_build_view_isolates_a_failing_vehicle(hass, monkeypatch):
    from custom_components.vehicle_log import calc

    store = await _store(hass)
    store.data["vehicles"] = [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}]
    real = calc._vehicle_view if hasattr(calc, "_vehicle_view") else None
    assert real is not None
    def boom(vehicle, *a, **k):
        if vehicle["id"] == "a":
            raise RuntimeError("bad")
        return real(vehicle, *a, **k)
    monkeypatch.setattr(calc, "_vehicle_view", boom)
    views = calc.build_view(store.data, date(2026, 11, 16))["vehicles"]
    assert views[0]["error"] is True and views[0]["entries"] == []
    assert not views[1].get("error")


def test_entry_is_valid_enforces_year_range():
    from custom_components.vehicle_log.calc import entry_is_valid

    assert not entry_is_valid({"kind": "odometer", "date": "0001-01-01", "odometer": 5})


async def test_save_entry_rejects_id_reuse_across_vehicle_or_kind(hass):
    store = await _store(hass)
    a = await store.async_save_vehicle({"name": "A"})
    b = await store.async_save_vehicle({"name": "B"})
    e = await store.async_save_entry(
        {"vehicle_id": a["id"], "kind": "odometer", "date": "2026-01-01", "odometer": 5,
         "service_type": "odometer_update"})
    with pytest.raises(ValueError):
        await store.async_save_entry(
            {"id": e["id"], "vehicle_id": b["id"], "kind": "odometer", "date": "2026-01-01",
             "odometer": 5, "service_type": "odometer_update"})
    with pytest.raises(ValueError):
        await store.async_save_entry(
            {"id": e["id"], "vehicle_id": a["id"], "kind": "service", "date": "2026-01-01",
             "service_type": "oil_filter"})


async def test_save_reminder_rejects_id_reuse_across_vehicle(hass):
    store = await _store(hass)
    a = await store.async_save_vehicle({"name": "A"})
    b = await store.async_save_vehicle({"name": "B"})
    r = await store.async_save_reminder(
        {"vehicle_id": a["id"], "service_type": "oil_filter", "interval_months": 6,
         "baseline_date": "2026-01-01"})
    with pytest.raises(ValueError):
        await store.async_save_reminder(
            {"id": r["id"], "vehicle_id": b["id"], "service_type": "oil_filter",
             "interval_months": 6, "baseline_date": "2026-01-01"})


async def test_non_string_service_type_is_value_error(hass):
    store = await _store(hass)
    a = await store.async_save_vehicle({"name": "A"})
    for bad in (["x"], {"x": 1}):
        with pytest.raises(ValueError):
            await store.async_save_entry(
                {"vehicle_id": a["id"], "kind": "service", "date": "2026-01-01",
                 "service_type": bad})
        with pytest.raises(ValueError):
            await store.async_save_reminder(
                {"vehicle_id": a["id"], "service_type": bad, "interval_months": 6,
                 "baseline_date": "2026-01-01"})


async def test_save_entry_is_atomic_with_legacy_reminder(hass):
    store = await _store(hass)
    a = await store.async_save_vehicle({"name": "A"})
    store.data["reminders"].append({"id": "old", "vehicle_id": a["id"], "baseline_date": "2020-01-01"})
    e = await store.async_save_entry(
        {"vehicle_id": a["id"], "kind": "service", "date": "2026-01-01",
         "service_type": "oil_filter"})
    assert e["id"] in [x["id"] for x in store.data["entries"]]
    assert store.data["reminders"][0]["baseline_date"] == "2020-01-01"


def _seed(hass_storage, **data):
    hass_storage["vehicle_log"] = {
        "version": 1, "minor_version": 1, "key": "vehicle_log",
        "data": {"vehicles": [], "entries": [], "reminders": [], **data},
    }


async def test_bad_purchase_date_is_repaired_and_history_kept(hass, hass_storage):
    _seed(
        hass_storage,
        vehicles=[{"id": "v1", "name": "A", "purchase_date": "zle", "icon": "x" * 999}],
        entries=[{"id": "e1", "vehicle_id": "v1", "kind": "odometer", "date": "2026-01-01",
                  "odometer": 5, "time": 7, "comment": ["x"]}],
    )
    store = await _store(hass)
    assert store.data["vehicles"][0]["purchase_date"] is None
    assert store.data["vehicles"][0]["icon"] is None
    assert [e["id"] for e in store.data["entries"]] == ["e1"]
    assert store.data["entries"][0]["time"] is None
    assert store.data["entries"][0]["comment"] == ""
    assert store.data["quarantine"] == []


async def test_unrepairable_records_are_quarantined_once_and_survive_saves(hass, hass_storage):
    broken = {"id": "e1", "vehicle_id": "v1", "date": "2026-01-01", "odometer": 5}
    _seed(
        hass_storage,
        vehicles=[{"id": "v1", "name": "A"}, {"id": "v2"}],
        entries=[dict(broken), {"id": "e2", "vehicle_id": "v2", "kind": "odometer"}],
    )
    store = await _store(hass)
    assert store.data["entries"] == []
    ids = sorted(q.get("id") for q in store.data["quarantine"])
    assert ids == ["e1", "e2", "v2"]
    q1 = next(q for q in store.data["quarantine"] if q["id"] == "e1")
    assert q1["reason"] and {k: v for k, v in q1.items() if k != "reason"} == broken
    await store.async_save_vehicle({"name": "B"})
    await store.async_flush()
    saved = copy.deepcopy(hass_storage["vehicle_log"]["data"])
    assert len(saved["quarantine"]) == 3
    # Reload from the saved data, and again with a stale copy of the old entry.
    saved["entries"].append(dict(broken))
    hass_storage["vehicle_log"]["data"] = saved
    store2 = await _store(hass)
    assert len(store2.data["quarantine"]) == 3
    assert store2.data["entries"] == []


async def test_quarantine_survives_import(hass, hass_storage):
    _seed(hass_storage, vehicles=[{"id": "v1", "name": "A"}], entries=[{"id": "e1", "vehicle_id": "v1"}])
    store = await _store(hass)
    assert len(store.data["quarantine"]) == 1
    await store.async_import(parse_car_notes_xlsx(make_xlsx(TWO_VEHICLES)))
    assert len(store.data["quarantine"]) == 1


async def test_overflowing_number_in_storage_is_repaired(hass, hass_storage):
    _seed(
        hass_storage,
        vehicles=[{"id": "v1", "name": "A"}],
        entries=[{"id": "e1", "vehicle_id": "v1", "kind": "refuel", "date": "2026-01-01",
                  "litres": 10**400, "total": 50.0, "price_per_litre": 5.0}],
    )
    store = await _store(hass)
    assert store.data["entries"][0]["litres"] is None
    assert store.data["quarantine"] == []


async def test_overflowing_number_on_write_is_value_error(hass):
    store = await _store(hass)
    a = await store.async_save_vehicle({"name": "A"})
    with pytest.raises(ValueError):
        await store.async_save_entry(
            {"vehicle_id": a["id"], "kind": "refuel", "date": "2026-01-01", "litres": 10**400})


async def test_float_odometer_is_repaired_not_quarantined(hass, hass_storage):
    _seed(
        hass_storage,
        vehicles=[{"id": "v1", "name": "A"}],
        entries=[
            {"id": "e1", "vehicle_id": "v1", "kind": "odometer", "date": "2026-01-01", "odometer": 5.0},
            {"id": "e2", "vehicle_id": "v1", "kind": "odometer", "date": "2026-01-02", "odometer": 5.5},
        ],
    )
    store = await _store(hass)
    odos = {e["id"]: e["odometer"] for e in store.data["entries"]}
    assert odos == {"e1": 5, "e2": None}
    assert type(odos["e1"]) is int
    assert store.data["quarantine"] == []


async def test_bad_vehicle_name_is_repaired_and_entries_kept(hass, hass_storage):
    _seed(
        hass_storage,
        vehicles=[{"id": "abcdef123", "name": "   "}, {"id": "v2", "name": "x" * 100},
                  {"id": "v3", "name": 5}],
        entries=[{"id": "e1", "vehicle_id": "abcdef123", "kind": "odometer", "date": "2026-01-01"},
                 {"id": "e2", "vehicle_id": "v2", "kind": "odometer", "date": "2026-01-01"}],
    )
    store = await _store(hass)
    names = {v["id"]: v["name"] for v in store.data["vehicles"]}
    assert names == {"abcdef123": "Pojazd abcdef", "v2": "x" * 70}
    assert sorted(e["id"] for e in store.data["entries"]) == ["e1", "e2"]
    assert [q["id"] for q in store.data["quarantine"]] == ["v3"]


async def test_failed_entry_save_rolls_back_everything(hass, monkeypatch):
    store = await _store(hass)
    a = await store.async_save_vehicle({"name": "A"})
    await store.async_save_reminder(
        {"vehicle_id": a["id"], "service_type": "oil_filter", "interval_months": 6,
         "baseline_date": "2020-01-01"})
    store._dropped.add("k")
    before = copy.deepcopy(store.data)
    saves = []
    monkeypatch.setattr(store._store, "async_delay_save", lambda *a, **k: saves.append(1))

    def boom(entry):
        store._data["reminders"][0]["baseline_date"] = "2099-01-01"
        raise RuntimeError("boom")

    monkeypatch.setattr(store, "_apply_reminder_resets", boom)
    with pytest.raises(RuntimeError):
        await store.async_save_entry(
            {"vehicle_id": a["id"], "kind": "service", "date": "2026-01-01",
             "service_type": "oil_filter"})
    assert store.data == before
    assert store._dropped == {"k"}
    assert saves == []


async def test_vehicle_keeps_up_to_two_fuel_types(hass):
    store = await _store(hass)
    v = await store.async_save_vehicle({"name": "Car", "fuel_types": ["Pb95", "LPG"]})
    assert v["fuel_types"] == ["Pb95", "LPG"]
    assert store.data["vehicles"][0]["fuel_types"] == ["Pb95", "LPG"]


async def test_vehicle_without_fuel_types_gets_empty_list(hass):
    store = await _store(hass)
    v = await store.async_save_vehicle({"name": "Car"})
    assert v["fuel_types"] == []


@pytest.mark.parametrize("bad", [
    ["Pb95", "LPG", "ON"], ["Pb95", "Pb95"], ["Wodór"], "Pb95", [None], [95],
])
async def test_vehicle_rejects_bad_fuel_types(hass, bad):
    store = await _store(hass)
    with pytest.raises(ValueError):
        await store.async_save_vehicle({"name": "Car", "fuel_types": bad})
    assert store.data["vehicles"] == []


async def test_bad_stored_fuel_types_are_reset_and_vehicle_kept(hass, hass_storage):
    _seed(hass_storage, vehicles=[
        {"id": "v1", "name": "A", "purchase_date": None, "icon": None, "fuel_types": ["X", "Y", "Z"]},
        {"id": "v2", "name": "B", "purchase_date": None, "icon": None},
    ])
    store = await _store(hass)
    assert [v["id"] for v in store.data["vehicles"]] == ["v1", "v2"]
    assert store.data["vehicles"][0]["fuel_types"] == []
    assert store.data["vehicles"][1]["fuel_types"] == []
    assert store.data["quarantine"] == []


async def test_import_creates_vehicles_without_fuel_types(hass):
    store = await _store(hass)
    await store.async_import(parse_car_notes_xlsx(make_xlsx(TWO_VEHICLES)))
    assert all(v["fuel_types"] == [] for v in store.data["vehicles"])
