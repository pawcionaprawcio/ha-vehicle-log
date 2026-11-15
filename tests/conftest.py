"""Shared pytest fixtures."""
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.vehicle_log.const import DOMAIN


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Allow Home Assistant to load custom_components in every test."""
    yield


@pytest.fixture
async def setup_entry(hass):
    entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, title="Vehicle Log")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


@pytest.fixture
async def ws(hass, setup_entry, hass_ws_client):
    return await hass_ws_client(hass)


async def ws_raw(ws, type_, **kw):
    await ws.send_json({"id": _next(ws), "type": type_, **kw})
    return await ws.receive_json()


def _next(ws):
    ws._vl_id = getattr(ws, "_vl_id", 0) + 1
    return ws._vl_id


async def ws_call(ws, type_, **kw):
    msg = await ws_raw(ws, type_, **kw)
    assert msg["success"], msg
    return msg["result"]


async def save_vehicle(ws, name="Testowe"):
    view = await ws_call(ws, "vehicle_log/vehicle/save", vehicle={"name": name})
    return next(v["id"] for v in view["vehicles"] if v["name"] == name)
