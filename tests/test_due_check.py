"""Tests for due notifications."""
from datetime import datetime

from homeassistant.components import persistent_notification as pn
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    async_capture_events,
    async_fire_time_changed,
)

from custom_components.vehicle_log.const import DOMAIN
from custom_components.vehicle_log.due_check import async_check_due
from tests.conftest import save_vehicle, ws_call

EVENT = "vehicle_log_reminder_due"
TODAY = "2026-11-15"


def _notifications(hass):
    return pn._async_get_or_create_notifications(hass)


async def _reminder(ws, vid, baseline, text="Wymiana oleju", months=12, km=None,
                    odo=None):
    reminder = {
        "vehicle_id": vid, "service_type": "oil_filter", "text": text,
        "interval_months": months, "interval_km": km,
        "baseline_date": baseline, "baseline_odometer": odo,
    }
    view = await ws_call(ws, "vehicle_log/reminder/save", reminder=reminder)
    vehicle = next(v for v in view["vehicles"] if v["id"] == vid)
    return next(r for r in vehicle["reminders"] if r["text"] == text)["id"]


async def test_due_reminder_notifies_once(hass, freezer, ws):
    hass.config.language = "pl"
    freezer.move_to(f"{TODAY} 10:00:00")
    events = async_capture_events(hass, EVENT)
    vid = await save_vehicle(ws, "Octavia")
    rid = await _reminder(ws, vid, "2025-01-01", km=10000, odo=60000)
    await hass.async_block_till_done()

    assert len(events) == 1
    assert events[0].data == {
        "kind": "reminder", "vehicle_id": vid, "vehicle_name": "Octavia",
        "reminder_id": rid, "text": "Wymiana oleju",
        "due_date": "2026-01-01", "due_odometer": 70000,
    }
    note = _notifications(hass)[f"vehicle_log_{rid}"]
    assert note["title"] == "Dziennik pojazdu"
    assert note["message"] == (
        "Octavia: Wymiana oleju — termin 2026-01-01 / 70000 km"
    )
    assert hass.data[DOMAIN]["store"].notified == {f"reminder:{rid}"}

    store = hass.data[DOMAIN]["store"]
    assert await async_check_due(hass, store, dt_util.now().date()) == []
    await hass.async_block_till_done()
    assert len(events) == 1


async def test_message_omits_missing_parts(hass, freezer, ws):
    hass.config.language = "pl"
    freezer.move_to(f"{TODAY} 10:00:00")
    vid = await save_vehicle(ws, "Octavia")
    only_date = await _reminder(ws, vid, "2025-01-01", text="A")
    await hass.async_block_till_done()
    assert _notifications(hass)[f"vehicle_log_{only_date}"]["message"] == (
        "Octavia: A — termin 2026-01-01"
    )
    await ws_call(
        ws, "vehicle_log/entry/save",
        entry={"vehicle_id": vid, "kind": "odometer", "date": TODAY,
               "odometer": 120000},
    )
    only_km = await _reminder(ws, vid, TODAY, text="B", months=None, km=5000,
                              odo=70000)
    await hass.async_block_till_done()
    assert _notifications(hass)[f"vehicle_log_{only_km}"]["message"] == (
        "Octavia: B — 75000 km"
    )


async def test_not_due_reminder_is_silent(hass, freezer, ws):
    freezer.move_to(f"{TODAY} 10:00:00")
    events = async_capture_events(hass, EVENT)
    vid = await save_vehicle(ws)
    await _reminder(ws, vid, TODAY)
    await hass.async_block_till_done()
    assert events == []
    assert hass.data[DOMAIN]["store"].notified == set()


async def test_reset_reminder_allows_next_notification(hass, freezer, ws):
    freezer.move_to(f"{TODAY} 10:00:00")
    events = async_capture_events(hass, EVENT)
    vid = await save_vehicle(ws)
    rid = await _reminder(ws, vid, "2025-01-01")
    await hass.async_block_till_done()
    assert len(events) == 1

    await ws_call(ws, "vehicle_log/reminder/reset", reminder_id=rid,
                  date=TODAY, odometer=None)
    await hass.async_block_till_done()
    assert hass.data[DOMAIN]["store"].notified == set()
    assert len(events) == 1

    freezer.move_to("2027-12-01 10:00:00")
    store = hass.data[DOMAIN]["store"]
    assert await async_check_due(hass, store, dt_util.now().date()) == [
        f"reminder:{rid}"
    ]
    await hass.async_block_till_done()
    assert len(events) == 2


async def test_odometer_overdue_event_kind(hass, freezer, ws):
    hass.config.language = "pl"
    freezer.move_to(f"{TODAY} 10:00:00")
    events = async_capture_events(hass, EVENT)
    vid = await save_vehicle(ws, "Octavia")
    await ws_call(
        ws, "vehicle_log/entry/save",
        entry={"vehicle_id": vid, "kind": "odometer", "date": "2026-06-01",
               "odometer": 60000},
    )
    await hass.async_block_till_done()
    assert len(events) == 1
    assert events[0].data["kind"] == "odometer"
    assert events[0].data["vehicle_id"] == vid
    assert events[0].data["vehicle_name"] == "Octavia"
    assert _notifications(hass)[f"vehicle_log_odometer_{vid}"]["message"] == (
        "Octavia: zaktualizuj przebieg (ostatni wpis 2026-06-01)"
    )
    assert hass.data[DOMAIN]["store"].notified == {f"odometer:{vid}"}

    # A new reading clears the key so a later overdue period notifies again.
    await ws_call(
        ws, "vehicle_log/entry/save",
        entry={"vehicle_id": vid, "kind": "odometer", "date": TODAY,
               "odometer": 101000},
    )
    await hass.async_block_till_done()
    assert hass.data[DOMAIN]["store"].notified == set()
    assert len(events) == 1


async def _reload_frozen(hass, freezer, setup_entry, when):
    """Freeze time, then reload so the 09:00 timer is scheduled from `when`."""
    freezer.move_to(when)
    assert await hass.config_entries.async_reload(setup_entry.entry_id)
    await hass.async_block_till_done()


async def test_daily_tick_checks_and_refreshes(hass, freezer, ws, setup_entry):
    await _reload_frozen(hass, freezer, setup_entry, "2026-11-14 10:00:00")
    events = async_capture_events(hass, EVENT)
    vid = await save_vehicle(ws)
    await _reminder(ws, vid, "2025-11-15")  # becomes due on 2026-11-15
    await hass.async_block_till_done()
    assert events == []

    now = datetime(2026, 11, 15, 9, 0, 0, tzinfo=dt_util.DEFAULT_TIME_ZONE)
    freezer.move_to(now)
    async_fire_time_changed(hass, now)
    await hass.async_block_till_done()
    assert len(events) == 1


async def test_unload_stops_checks(hass, freezer, ws, setup_entry):
    await _reload_frozen(hass, freezer, setup_entry, "2026-11-14 10:00:00")
    events = async_capture_events(hass, EVENT)
    vid = await save_vehicle(ws)
    await _reminder(ws, vid, "2025-11-15")
    await hass.async_block_till_done()
    store = hass.data[DOMAIN]["store"]

    assert await hass.config_entries.async_unload(setup_entry.entry_id)
    await hass.async_block_till_done()
    assert store._listeners == []

    now = datetime(2026, 11, 15, 9, 0, 0, tzinfo=dt_util.DEFAULT_TIME_ZONE)
    freezer.move_to(now)
    async_fire_time_changed(hass, now)
    await hass.async_block_till_done()
    assert events == []


async def test_setup_checks_existing_data(hass, freezer, ws, setup_entry):
    freezer.move_to(f"{TODAY} 10:00:00")
    vid = await save_vehicle(ws)
    rid = await _reminder(ws, vid, "2025-01-01")
    await hass.async_block_till_done()
    store = hass.data[DOMAIN]["store"]
    # Drop the notified key on disk, then reload: setup must notify again.
    store.data["notified"] = []
    await store.async_flush()
    events = async_capture_events(hass, EVENT)
    assert await hass.config_entries.async_reload(setup_entry.entry_id)
    await hass.async_block_till_done()
    assert [e.data["reminder_id"] for e in events] == [rid]


async def test_notification_dismissed_when_no_longer_due(hass, freezer, ws):
    freezer.move_to(f"{TODAY} 10:00:00")
    vid = await save_vehicle(ws)
    rid = await _reminder(ws, vid, "2025-01-01")
    await hass.async_block_till_done()
    assert f"vehicle_log_{rid}" in _notifications(hass)
    await ws_call(ws, "vehicle_log/reminder/reset", reminder_id=rid,
                  date=TODAY, odometer=None)
    await hass.async_block_till_done()
    assert f"vehicle_log_{rid}" not in _notifications(hass)


async def test_notification_dismissed_when_reminder_deleted(hass, freezer, ws):
    freezer.move_to(f"{TODAY} 10:00:00")
    vid = await save_vehicle(ws)
    rid = await _reminder(ws, vid, "2025-01-01")
    await hass.async_block_till_done()
    assert f"vehicle_log_{rid}" in _notifications(hass)
    await ws_call(ws, "vehicle_log/reminder/delete", reminder_id=rid)
    await hass.async_block_till_done()
    assert f"vehicle_log_{rid}" not in _notifications(hass)
    assert hass.data[DOMAIN]["store"].notified == set()


async def test_notifications_dismissed_when_vehicle_deleted(hass, freezer, ws):
    freezer.move_to(f"{TODAY} 10:00:00")
    vid = await save_vehicle(ws)
    rid = await _reminder(ws, vid, "2025-01-01")
    await ws_call(
        ws, "vehicle_log/entry/save",
        entry={"vehicle_id": vid, "kind": "odometer", "date": "2026-06-01",
               "odometer": 60000},
    )
    await hass.async_block_till_done()
    notes = _notifications(hass)
    assert f"vehicle_log_{rid}" in notes and f"vehicle_log_odometer_{vid}" in notes
    await ws_call(ws, "vehicle_log/vehicle/delete", vehicle_id=vid)
    await hass.async_block_till_done()
    notes = _notifications(hass)
    assert f"vehicle_log_{rid}" not in notes
    assert f"vehicle_log_odometer_{vid}" not in notes
    assert hass.data[DOMAIN]["store"].notified == set()


async def test_due_check_survives_a_failing_vehicle(hass, freezer, ws, monkeypatch):
    from custom_components.vehicle_log import calc

    freezer.move_to(f"{TODAY} 10:00:00")
    bad = await save_vehicle(ws, "Zepsute")
    good = await save_vehicle(ws, "Dobre")
    real = calc._vehicle_view

    def boom(vehicle, *a, **k):
        if vehicle["id"] == bad:
            raise RuntimeError("bad")
        return real(vehicle, *a, **k)

    monkeypatch.setattr(calc, "_vehicle_view", boom)
    events = async_capture_events(hass, EVENT)
    rid = await _reminder(ws, good, "2025-01-01")
    await hass.async_block_till_done()
    assert [e.data["reminder_id"] for e in events] == [rid]
    store = hass.data[DOMAIN]["store"]
    await async_check_due(hass, store, dt_util.now().date())


async def test_messages_are_english_outside_polish(hass, freezer, ws):
    hass.config.language = "en"
    freezer.move_to(f"{TODAY} 10:00:00")
    vid = await save_vehicle(ws, "Octavia")
    rid = await _reminder(ws, vid, "2025-01-01", text="Oil", km=10000, odo=60000)
    await hass.async_block_till_done()
    note = _notifications(hass)[f"vehicle_log_{rid}"]
    assert note["title"] == "Vehicle Log"
    assert note["message"] == "Octavia: Oil — due 2026-01-01 / 70000 km"

    vid2 = await save_vehicle(ws, "Fabia")
    await ws_call(
        ws, "vehicle_log/entry/save",
        entry={"vehicle_id": vid2, "kind": "odometer", "date": "2026-06-01",
               "odometer": 60000},
    )
    await hass.async_block_till_done()
    assert _notifications(hass)[f"vehicle_log_odometer_{vid2}"]["message"] == (
        "Fabia: update the odometer (last reading 2026-06-01)"
    )
