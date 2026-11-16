"""Tests for vehicle and reminder sensors."""
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from custom_components.vehicle_log.const import DOMAIN
from tests.conftest import save_vehicle, ws_call

TODAY = "2026-11-15"


def _device(hass, vid):
    entry = hass.config_entries.async_entries(DOMAIN)[0]
    return dr.async_get(hass).async_get_device_by_identifier(
        (DOMAIN, vid), entry.entry_id
    )


def _state(hass, platform, unique_id):
    ent_reg = er.async_get(hass)
    entity_id = ent_reg.async_get_entity_id(platform, DOMAIN, unique_id)
    assert entity_id, f"no {platform} entity {unique_id}"
    return hass.states.get(entity_id)


async def _reading(ws, vid, date, odometer):
    return await ws_call(
        ws, "vehicle_log/entry/save",
        entry={"vehicle_id": vid, "kind": "odometer", "date": date,
               "odometer": odometer},
    )


async def _add_reminder(ws, vid, text="Wymiana oleju"):
    view = await ws_call(
        ws, "vehicle_log/reminder/save",
        reminder={
            "vehicle_id": vid, "service_type": "oil_filter", "text": text,
            "interval_km": 10000, "interval_months": 12,
            "baseline_odometer": 60000, "baseline_date": "2026-09-08",
        },
    )
    return next(
        r["id"] for v in view["vehicles"] if v["id"] == vid
        for r in v["reminders"] if r["text"] == text
    )


async def _vehicle_with_reminder(hass, ws):
    await ws_call(ws, "vehicle_log/settings/save",
                  settings={"forecast_enabled": False})
    vid = await save_vehicle(ws)
    await _reading(ws, vid, "2026-09-08", 60000)
    await _reading(ws, vid, TODAY, 62850)
    rid = await _add_reminder(ws, vid)
    await hass.async_block_till_done()
    return vid, rid


async def test_reminder_entities_created_and_updated(hass, freezer, ws):
    freezer.move_to(f"{TODAY} 10:00:00")
    vid, rid = await _vehicle_with_reminder(hass, ws)

    assert _state(hass, "sensor", f"{rid}_progress").state == "28"
    assert _state(hass, "sensor", f"{rid}_progress").attributes[
        "unit_of_measurement"] == "%"
    assert _state(hass, "sensor", f"{rid}_remaining_days").state == "297"
    assert _state(hass, "sensor", f"{rid}_remaining_km").state == "7150"
    due = _state(hass, "binary_sensor", f"{rid}_due")
    assert due.state == "off"
    assert due.attributes["due_date"] == "2027-09-08"
    assert due.attributes["due_odometer"] == 70000
    assert _state(hass, "sensor", f"{vid}_odometer").state == "62850"
    assert _state(hass, "binary_sensor", f"{vid}_odometer_update_due").state == "off"

    # reminder entities live on the vehicle's device and carry the reminder text
    device = _device(hass, vid)
    assert device.name == "Testowe"
    assert device.entry_type is dr.DeviceEntryType.SERVICE
    assert "Wymiana oleju" in _state(hass, "sensor", f"{rid}_progress").name

    # a new reading pushes the state without polling
    await _reading(ws, vid, TODAY, 71000)
    await hass.async_block_till_done()
    assert _state(hass, "sensor", f"{rid}_remaining_km").state == "-1000"
    assert _state(hass, "binary_sensor", f"{rid}_due").state == "on"
    assert _state(hass, "sensor", f"{vid}_odometer").state == "71000"


async def test_consumption_sensor(hass, freezer, ws):
    freezer.move_to(f"{TODAY} 10:00:00")
    vid = await save_vehicle(ws)
    for odo, litres in ((1000, 40), (1500, 25)):
        await ws_call(
            ws, "vehicle_log/entry/save",
            entry={"vehicle_id": vid, "kind": "refuel", "date": TODAY,
                   "odometer": odo, "litres": litres, "total": litres * 6,
                   "full_tank": True},
        )
    await hass.async_block_till_done()
    s = _state(hass, "sensor", f"{vid}_consumption")
    assert s.state == "5.0"
    assert s.attributes["unit_of_measurement"] == "L/100km"
    assert s.attributes["avg_l_per_100km"] == 5.0
    assert s.attributes["avg_cost_per_100km"] == 30.0


async def test_adding_reminder_after_setup_creates_entities(hass, freezer, ws):
    freezer.move_to(f"{TODAY} 10:00:00")
    vid = await save_vehicle(ws)
    await hass.async_block_till_done()
    assert _state(hass, "sensor", f"{vid}_odometer") is not None
    rid = await _add_reminder(ws, vid, "Filtr kabinowy")
    await hass.async_block_till_done()
    for uid in ("remaining_km", "remaining_days", "progress"):
        assert _state(hass, "sensor", f"{rid}_{uid}") is not None
    assert _state(hass, "binary_sensor", f"{rid}_due") is not None


async def test_deleting_reminder_removes_entities(hass, freezer, ws):
    freezer.move_to(f"{TODAY} 10:00:00")
    vid, rid = await _vehicle_with_reminder(hass, ws)
    await ws_call(ws, "vehicle_log/reminder/delete", reminder_id=rid)
    await hass.async_block_till_done()
    ent_reg = er.async_get(hass)
    for platform, key in (("sensor", "progress"), ("sensor", "remaining_km"),
                          ("sensor", "remaining_days"), ("binary_sensor", "due")):
        assert ent_reg.async_get_entity_id(platform, DOMAIN, f"{rid}_{key}") is None
    # vehicle entities and device stay
    assert _state(hass, "sensor", f"{vid}_odometer") is not None
    assert _device(hass, vid)


async def test_deleting_vehicle_removes_device_and_entities(hass, freezer, ws):
    freezer.move_to(f"{TODAY} 10:00:00")
    vid, rid = await _vehicle_with_reminder(hass, ws)
    await ws_call(ws, "vehicle_log/vehicle/delete", vehicle_id=vid)
    await hass.async_block_till_done()
    assert _device(hass, vid) is None
    ent_reg = er.async_get(hass)
    assert not [e for e in ent_reg.entities.values() if e.platform == DOMAIN]


async def test_vehicle_without_readings_is_unknown(hass, freezer, ws):
    freezer.move_to(f"{TODAY} 10:00:00")
    vid = await save_vehicle(ws)
    await hass.async_block_till_done()
    assert _state(hass, "sensor", f"{vid}_odometer").state == "unknown"
    assert _state(hass, "sensor", f"{vid}_forecast_odometer").state == "unknown"
    assert _state(hass, "sensor", f"{vid}_consumption").state == "unknown"
    assert _state(hass, "binary_sensor", f"{vid}_odometer_update_due").state == "off"


async def test_vehicle_rename_updates_device(hass, freezer, ws):
    freezer.move_to(f"{TODAY} 10:00:00")
    vid = await save_vehicle(ws)
    await ws_call(ws, "vehicle_log/vehicle/save",
                  vehicle={"id": vid, "name": "Nowa nazwa"})
    await hass.async_block_till_done()
    device = _device(hass, vid)
    assert device.name == "Nowa nazwa"


async def test_refresh_recomputes_from_current_date(hass, freezer, ws):
    """The daily tick (Task 8) calls coordinator.async_refresh()."""
    freezer.move_to(f"{TODAY} 10:00:00")
    vid, rid = await _vehicle_with_reminder(hass, ws)
    freezer.move_to("2026-11-16 10:00:00")
    await hass.data[DOMAIN]["coordinator"].async_refresh()
    await hass.async_block_till_done()
    assert _state(hass, "sensor", f"{rid}_remaining_days").state == "296"


async def test_unload_and_reload_entities(hass, freezer, ws, setup_entry):
    freezer.move_to(f"{TODAY} 10:00:00")
    vid, rid = await _vehicle_with_reminder(hass, ws)
    assert await hass.config_entries.async_unload(setup_entry.entry_id)
    await hass.async_block_till_done()
    assert _state(hass, "sensor", f"{vid}_odometer").state == "unavailable"
    await hass.config_entries.async_reload(setup_entry.entry_id)
    await hass.async_block_till_done()
    assert _state(hass, "sensor", f"{rid}_remaining_days").state == "297"



async def test_reminder_rename_updates_friendly_name(hass, freezer, ws):
    freezer.move_to(f"{TODAY} 10:00:00")
    vid, rid = await _vehicle_with_reminder(hass, ws)
    assert "Wymiana oleju" in _state(hass, "sensor", f"{rid}_progress").name
    await ws_call(
        ws, "vehicle_log/reminder/save",
        reminder={"id": rid, "vehicle_id": vid, "service_type": "oil_filter",
                  "text": "Olej silnik", "interval_km": 10000,
                  "interval_months": 12},
    )
    await hass.async_block_till_done()
    for platform, key in (("sensor", "progress"), ("sensor", "remaining_km"),
                          ("sensor", "remaining_days"), ("binary_sensor", "due")):
        name = _state(hass, platform, f"{rid}_{key}").name
        assert "Olej silnik" in name and "Wymiana oleju" not in name


async def test_odometer_sensors_use_measurement_state_class(hass, freezer, ws):
    freezer.move_to(f"{TODAY} 10:00:00")
    vid = await save_vehicle(ws)
    await hass.async_block_till_done()
    for key in ("odometer", "forecast_odometer"):
        s = _state(hass, "sensor", f"{vid}_{key}")
        assert s.attributes["state_class"] == "measurement"
        assert s.attributes["device_class"] == "distance"


async def test_setup_sweeps_orphaned_entities_and_devices(
    hass, freezer, ws, setup_entry, hass_storage
):
    freezer.move_to(f"{TODAY} 10:00:00")
    vid, rid = await _vehicle_with_reminder(hass, ws)
    ent_reg = er.async_get(hass)
    assert ent_reg.async_get_entity_id("sensor", DOMAIN, f"{vid}_odometer")
    assert await hass.config_entries.async_unload(setup_entry.entry_id)
    await hass.async_block_till_done()
    # The vehicle disappears from storage while the integration is not loaded.
    data = hass_storage[DOMAIN]["data"]
    data.update(vehicles=[], entries=[], reminders=[])
    assert await hass.config_entries.async_setup(setup_entry.entry_id)
    await hass.async_block_till_done()
    assert ent_reg.async_get_entity_id("sensor", DOMAIN, f"{vid}_odometer") is None
    assert ent_reg.async_get_entity_id("sensor", DOMAIN, f"{rid}_progress") is None
    assert _device(hass, vid) is None


async def _lpg_car(hass, ws, install_total=None):
    view = await ws_call(ws, "vehicle_log/vehicle/save",
                         vehicle={"name": "Gaz", "fuel_types": ["Pb95"],
                                  "petrol_l_per_100km": 8})
    vid = view["vehicles"][0]["id"]
    await ws_call(ws, "vehicle_log/entry/save", entry={
        "vehicle_id": vid, "kind": "service", "service_type": "lpg_install",
        "name": "Montaż", "date": "2026-11-01", "odometer": 100000,
        "total": install_total,
    })
    view = await ws_call(ws, "vehicle_log/entry/save", entry={
        "vehicle_id": vid, "kind": "refuel", "date": "2026-11-10",
        "odometer": 100500, "litres": 50, "total": 150, "fuel_type": "LPG",
        "full_tank": True, "petrol_price": 6,
    })
    await hass.async_block_till_done()
    install = next(e for e in view["vehicles"][0]["entries"]
                   if e["service_type"] == "lpg_install")
    return vid, install


def _entity_id(hass, unique_id):
    return er.async_get(hass).async_get_entity_id("sensor", DOMAIN, unique_id)


async def test_lpg_sensors_created_with_install(hass, ws):
    hass.config.currency = "PLN"
    vid, _ = await _lpg_car(hass, ws, install_total=3000)
    savings = _state(hass, "sensor", f"{vid}_lpg_savings")
    assert float(savings.state) == -2910.0
    assert savings.attributes["unit_of_measurement"] == "PLN"
    assert savings.attributes["device_class"] == "monetary"
    assert _state(hass, "sensor", f"{vid}_lpg_payback").state == "3"


async def test_lpg_savings_sensor_has_lpg_mode_consumption(hass, ws):
    vid, _ = await _lpg_car(hass, ws, install_total=3000)
    attrs = _state(hass, "sensor", f"{vid}_lpg_savings").attributes
    assert "lpg_l_per_100km" in attrs and "petrol_on_lpg_l_per_100km" in attrs


async def test_consumption_sensor_has_lpg_mode_without_install(hass, ws):
    view = await ws_call(ws, "vehicle_log/vehicle/save",
                         vehicle={"name": "Gaz", "fuel_types": ["Pb95", "LPG"]})
    vid = view["vehicles"][0]["id"]
    for odo, litres in ((100000, 40), (100500, 50)):
        await ws_call(ws, "vehicle_log/entry/save", entry={
            "vehicle_id": vid, "kind": "refuel", "date": "2026-11-10",
            "odometer": odo, "litres": litres, "total": litres * 3, "fuel_type": "LPG",
            "full_tank": True,
        })
    await hass.async_block_till_done()
    attrs = _state(hass, "sensor", f"{vid}_consumption").attributes
    assert attrs["lpg_l_per_100km"] == 10.0
    assert attrs["petrol_on_lpg_l_per_100km"] == 0.0


async def test_lpg_payback_sensor_needs_cost(hass, ws):
    vid, _ = await _lpg_car(hass, ws)
    assert float(_state(hass, "sensor", f"{vid}_lpg_savings").state) == 90.0
    assert _entity_id(hass, f"{vid}_lpg_payback") is None


async def test_no_lpg_sensors_without_install(hass, ws):
    vid = await save_vehicle(ws)
    await hass.async_block_till_done()
    assert _entity_id(hass, f"{vid}_lpg_savings") is None


async def test_lpg_sensors_follow_install_entry(hass, ws):
    vid, install = await _lpg_car(hass, ws, install_total=3000)
    await ws_call(ws, "vehicle_log/entry/delete", entry_id=install["id"])
    await hass.async_block_till_done()
    assert _entity_id(hass, f"{vid}_lpg_savings") is None
    assert _entity_id(hass, f"{vid}_lpg_payback") is None
    await ws_call(ws, "vehicle_log/entry/save", entry={
        **{k: install[k] for k in ("vehicle_id", "kind", "service_type", "name",
                                   "date", "odometer", "total")},
    })
    await hass.async_block_till_done()
    assert float(_state(hass, "sensor", f"{vid}_lpg_savings").state) == -2910.0
    assert _state(hass, "sensor", f"{vid}_lpg_payback").state == "3"
