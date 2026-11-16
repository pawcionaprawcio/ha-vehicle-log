"""Tests for setup, panel registration and the websocket API."""
import base64

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.vehicle_log.const import DOMAIN
from tests.conftest import save_vehicle, ws_call, ws_raw
from tests.test_store import TWO_VEHICLES
from tests.xlsx_factory import make_xlsx


async def test_panel_registered(hass, setup_entry):
    assert "vehicle-log" in hass.data["frontend_panels"]
    assert hass.data[DOMAIN]["store"] is not None


@pytest.mark.parametrize(
    ("language", "title"),
    [("pl", "Dziennik pojazdu"), ("pl-PL", "Dziennik pojazdu"), ("en", "Vehicle Log"), ("de", "Vehicle Log")],
)
async def test_sidebar_title_follows_language(hass, language, title):
    hass.config.language = language
    entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, title="Vehicle Log")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.data["frontend_panels"]["vehicle-log"].sidebar_title == title


async def test_config_flow_single_instance(hass):
    r = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert r["type"] == "form"
    r = await hass.config_entries.flow.async_configure(r["flow_id"], {})
    assert r["type"] == "create_entry" and r["title"] == "Vehicle Log"
    r = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert r["type"] == "abort" and r["reason"] == "single_instance_allowed"


async def test_get_empty(hass, ws):
    view = await ws_call(ws, "vehicle_log/get")
    assert view["vehicles"] == []
    assert "service_types" in view and "fuel_types" in view


async def test_entry_save_accepts_decimal_comma(hass, ws):
    vid = await save_vehicle(ws)
    r = await ws_call(
        ws, "vehicle_log/entry/save",
        entry={
            "vehicle_id": vid, "kind": "refuel", "date": "2026-11-15",
            "time": "08:30", "odometer": "1000", "litres": "",
            "price_per_litre": "5,79", "total": "289,50", "full_tank": True,
        },
    )
    e = r["vehicles"][0]["entries"][0]
    assert e["litres"] == 50.0 and e["price_per_litre"] == 5.79
    assert e["odometer"] == 1000 and isinstance(e["odometer"], int)


async def test_entry_save_drops_unknown_keys_and_deletes(hass, ws):
    vid = await save_vehicle(ws)
    r = await ws_call(
        ws, "vehicle_log/entry/save",
        entry={"vehicle_id": vid, "kind": "odometer", "date": "2026-11-15",
               "odometer": "12000", "bogus": 1},
    )
    eid = r["vehicles"][0]["entries"][0]["id"]
    assert "bogus" not in r["vehicles"][0]["entries"][0]
    r = await ws_call(ws, "vehicle_log/entry/delete", entry_id=eid)
    assert r["vehicles"][0]["entries"] == []


async def test_invalid_entry_returns_error(hass, ws):
    msg = await ws_raw(
        ws, "vehicle_log/entry/save",
        entry={"vehicle_id": "nope", "kind": "service", "date": "2026-11-15"},
    )
    assert not msg["success"] and msg["error"]["code"] == "invalid_input"


async def test_vehicle_delete(hass, ws):
    vid = await save_vehicle(ws)
    r = await ws_call(ws, "vehicle_log/vehicle/delete", vehicle_id=vid)
    assert r["vehicles"] == []


async def test_reminder_save_edit_reset_delete(hass, ws):
    vid = await save_vehicle(ws)
    r = await ws_call(
        ws, "vehicle_log/reminder/save",
        reminder={
            "vehicle_id": vid, "service_type": "oil_filter", "text": "Olej",
            "interval_km": "10000", "interval_months": "12",
            "baseline_date": "2026-09-08", "baseline_odometer": "60000",
        },
    )
    rem = r["vehicles"][0]["reminders"][0]
    assert rem["interval_km"] == 10000 and rem["baseline_odometer"] == 60000
    # edit without baseline keeps it
    r = await ws_call(
        ws, "vehicle_log/reminder/save",
        reminder={"id": rem["id"], "vehicle_id": vid, "service_type": "oil_filter",
                  "text": "Olej 2", "interval_km": "15000,0", "interval_months": ""},
    )
    rem = r["vehicles"][0]["reminders"][0]
    assert rem["text"] == "Olej 2" and rem["interval_km"] == 15000
    assert rem["interval_months"] is None
    assert rem["baseline_date"] == "2026-09-08"
    r = await ws_call(
        ws, "vehicle_log/reminder/reset",
        reminder_id=rem["id"], date="2026-11-01", odometer="105000",
    )
    rem = r["vehicles"][0]["reminders"][0]
    assert rem["baseline_date"] == "2026-11-01" and rem["baseline_odometer"] == 105000
    r = await ws_call(ws, "vehicle_log/reminder/delete", reminder_id=rem["id"])
    assert r["vehicles"][0]["reminders"] == []


async def test_settings_save(hass, ws):
    r = await ws_call(
        ws, "vehicle_log/settings/save", settings={"forecast_enabled": False}
    )
    assert r["settings"]["forecast_enabled"] is False
    msg = await ws_raw(ws, "vehicle_log/settings/save", settings={"nope": True})
    assert not msg["success"]


async def test_import_reports_counts(hass, ws):
    content = base64.b64encode(make_xlsx(TWO_VEHICLES)).decode()
    r = await ws_call(ws, "vehicle_log/import_xlsx", content_b64=content)
    assert r["result"] == {
        "vehicles_added": 2, "entries_added": 3, "entries_skipped": 0,
    }
    assert {v["name"] for v in r["view"]["vehicles"]} == {"Auto A", "Auto B"}
    r = await ws_call(ws, "vehicle_log/import_xlsx", content_b64=content)
    assert r["result"] == {
        "vehicles_added": 0, "entries_added": 0, "entries_skipped": 3,
    }


async def test_invalid_import_returns_error(hass, ws):
    content = base64.b64encode(b"junk").decode()
    msg = await ws_raw(ws, "vehicle_log/import_xlsx", content_b64=content)
    assert not msg["success"] and msg["error"]["code"] == "invalid_input"
    msg = await ws_raw(ws, "vehicle_log/import_xlsx", content_b64="!!notb64!!")
    assert not msg["success"] and msg["error"]["code"] == "invalid_input"


async def test_subscribe_pushes_on_change(hass, ws):
    await ws.send_json({"id": 100, "type": "vehicle_log/subscribe"})
    first = await ws.receive_json()
    assert first["id"] == 100 and first["type"] == "result" and first["success"]
    ev = await ws.receive_json()
    assert ev["type"] == "event" and ev["event"]["view"]["vehicles"] == []
    await ws.send_json({
        "id": 101, "type": "vehicle_log/vehicle/save", "vehicle": {"name": "Nowe"},
    })
    msgs = [await ws.receive_json(), await ws.receive_json()]
    events = [m for m in msgs if m["id"] == 100]
    assert len(events) == 1
    assert events[0]["event"]["view"]["vehicles"][0]["name"] == "Nowe"
    # unsubscribe stops pushes
    await ws.send_json({"id": 102, "type": "unsubscribe_events", "subscription": 100})
    assert (await ws.receive_json())["success"]
    store = hass.data[DOMAIN]["store"]
    # only the integration's own listeners remain (coordinator + due check)
    assert len(store._listeners) == 2
    assert hass.data[DOMAIN]["coordinator"]._store_changed in store._listeners


async def test_unload_removes_panel(hass, setup_entry):
    assert await hass.config_entries.async_unload(setup_entry.entry_id)
    await hass.async_block_till_done()
    assert "vehicle-log" not in hass.data["frontend_panels"]
    assert DOMAIN not in hass.data


async def test_reload_keeps_data(hass, setup_entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    await save_vehicle(ws, "Zostaje")
    await hass.config_entries.async_reload(setup_entry.entry_id)
    await hass.async_block_till_done()
    assert "vehicle-log" in hass.data["frontend_panels"]
    ws2 = await hass_ws_client(hass)
    view = await ws_call(ws2, "vehicle_log/get")
    assert [v["name"] for v in view["vehicles"]] == ["Zostaje"]


async def test_non_integral_odometer_is_rejected(hass, ws):
    vid = await save_vehicle(ws)
    entry = {"vehicle_id": vid, "kind": "odometer", "date": "2026-11-15"}
    for bad in ("61.250", 61.250, "1e999", "nan", "inf", "-5"):
        msg = await ws_raw(ws, "vehicle_log/entry/save", entry={**entry, "odometer": bad})
        assert not msg["success"], bad
    view = await ws_call(ws, "vehicle_log/get")
    assert view["vehicles"][0]["entries"] == []
    msg = await ws_raw(
        ws, "vehicle_log/reminder/reset", reminder_id="x", date="2026-11-15",
        odometer="61.250",
    )
    assert not msg["success"]


async def test_whole_number_with_decimal_zero_is_accepted(hass, ws):
    vid = await save_vehicle(ws)
    r = await ws_call(
        ws, "vehicle_log/entry/save",
        entry={"vehicle_id": vid, "kind": "odometer", "date": "2026-11-15",
               "odometer": "61250,0"},
    )
    assert r["vehicles"][0]["entries"][0]["odometer"] == 61250


async def test_thousands_separators_of_any_kind_are_stripped(hass, ws):
    vid = await save_vehicle(ws)
    r = await ws_call(
        ws, "vehicle_log/entry/save",
        entry={"vehicle_id": vid, "kind": "odometer", "date": "2026-11-15",
               "odometer": "61 200"},
    )
    assert r["vehicles"][0]["entries"][0]["odometer"] == 61200
    r = await ws_call(
        ws, "vehicle_log/entry/save",
        entry={"vehicle_id": vid, "kind": "service", "service_type": "wheels",
               "date": "2026-11-15", "labour": "1 250,5"},
    )
    assert any(e["labour"] == 1250.5 for e in r["vehicles"][0]["entries"])


async def test_huge_reminder_interval_is_rejected_not_persisted(hass, ws):
    vid = await save_vehicle(ws)
    msg = await ws_raw(
        ws, "vehicle_log/reminder/save",
        reminder={"vehicle_id": vid, "service_type": "oil_filter", "text": "Olej",
                  "interval_months": 100000},
    )
    assert not msg["success"] and msg["error"]["code"] == "invalid_input"
    view = await ws_call(ws, "vehicle_log/get")
    assert view["vehicles"][0]["reminders"] == []
    msg = await ws_raw(
        ws, "vehicle_log/reminder/save",
        reminder={"vehicle_id": vid, "service_type": "oil_filter", "text": "O",
                  "interval_months": 12, "baseline_date": "nope"},
    )
    assert not msg["success"] and msg["error"]["code"] == "invalid_input"


async def test_settings_are_range_checked(hass, ws):
    for bad in ({"odometer_reminder_days": 0}, {"odometer_reminder_days": "x"},
                {"forecast_enabled": "yes"}):
        msg = await ws_raw(ws, "vehicle_log/settings/save", settings=bad)
        assert not msg["success"] and msg["error"]["code"] == "invalid_input"


async def test_client_generated_entry_id_makes_retry_idempotent(hass, ws):
    vid = await save_vehicle(ws)
    entry = {"id": "ab12cd34ef56ab12cd34ef56ab12cd34", "vehicle_id": vid,
             "kind": "refuel", "date": "2026-11-15", "odometer": 61200,
             "litres": 40, "total": 240, "full_tank": True}
    await ws_call(ws, "vehicle_log/entry/save", entry=entry)
    r = await ws_call(ws, "vehicle_log/entry/save", entry=entry)
    entries = r["vehicles"][0]["entries"]
    assert len(entries) == 1 and entries[0]["id"] == entry["id"]


async def test_setup_survives_corrupt_storage(hass, hass_storage):
    from pytest_homeassistant_custom_component.common import MockConfigEntry

    hass_storage[DOMAIN] = {
        "version": 1, "minor_version": 1, "key": DOMAIN,
        "data": {
            "vehicles": [
                {"id": "v1", "name": "Stare", "purchase_date": None, "icon": None},
                {"id": "v2", "purchase_date": None, "icon": None},
                {"id": "v3", "name": "Zla data", "purchase_date": "zle", "icon": None},
            ],
            "entries": [
                {"id": "e1", "vehicle_id": "v1", "date": "2026-11-01", "odometer": 10,
                 "service_type": "odometer_update"},
                {"id": "e2", "vehicle_id": "v1", "kind": "odometer", "date": "0001-01-01",
                 "odometer": 999999, "service_type": "odometer_update"},
                {"id": "e3", "vehicle_id": "v1", "kind": "odometer", "date": "2026-11-01",
                 "odometer": 1000, "service_type": "odometer_update"},
                {"id": "e4", "vehicle_id": "gone", "kind": "odometer", "date": "2026-11-01",
                 "odometer": 5, "service_type": "odometer_update"},
            ],
            "reminders": [
                {"id": "r1", "vehicle_id": "v1", "service_type": "oil_filter",
                 "interval_months": 1, "interval_km": None,
                 "baseline_date": "2026-01-01", "baseline_odometer": 0},
                {"id": "r2", "vehicle_id": "v1", "service_type": "oil_filter",
                 "text": "Zle", "interval_months": 12, "interval_km": None,
                 "baseline_date": "nie-data", "baseline_odometer": None},
            ],
            "settings": {"odometer_reminder_days": "dużo"},
            "notified": [],
        },
    }
    entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, title="Vehicle Log")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    store = hass.data[DOMAIN]["store"]
    assert [v["id"] for v in store.data["vehicles"]] == ["v1", "v3"]
    assert store.data["vehicles"][1]["purchase_date"] is None
    assert {q["id"] for q in store.data["quarantine"]} >= {"v2", "e1", "e2", "e4", "r2"}
    assert [e["id"] for e in store.data["entries"]] == ["e3"]
    assert [r["id"] for r in store.data["reminders"]] == ["r1"]
    coordinator = hass.data[DOMAIN]["coordinator"]
    assert coordinator.data["vehicles"][0]["entries"][0]["id"] == "e3"
    assert store.data["settings"]["odometer_reminder_days"] == 120


def test_manifest_version_matches_const():
    import json
    from pathlib import Path

    from custom_components.vehicle_log.const import VERSION

    manifest = Path(__file__).parent.parent / "custom_components/vehicle_log/manifest.json"
    assert json.loads(manifest.read_text())["version"] == VERSION


async def test_entry_save_parses_petrol_price_comma(hass, ws):
    vid = await save_vehicle(ws)
    r = await ws_call(
        ws, "vehicle_log/entry/save",
        entry={
            "vehicle_id": vid, "kind": "refuel", "date": "2026-12-01",
            "odometer": "1000", "litres": "40", "total": "120",
            "fuel_type": "LPG", "full_tank": True, "petrol_price": "6,49",
        },
    )
    assert r["vehicles"][0]["entries"][0]["petrol_price"] == 6.49


async def test_vehicle_save_parses_consumption_comma(hass, ws):
    view = await ws_call(
        ws, "vehicle_log/vehicle/save",
        vehicle={"name": "Car", "petrol_l_per_100km": "8,5"},
    )
    assert view["vehicles"][0]["petrol_l_per_100km"] == 8.5
    view = await ws_call(
        ws, "vehicle_log/vehicle/save",
        vehicle={"id": view["vehicles"][0]["id"], "name": "Car", "petrol_l_per_100km": ""},
    )
    assert view["vehicles"][0]["petrol_l_per_100km"] is None
