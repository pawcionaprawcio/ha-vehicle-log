"""Vehicle Log: a car service log with its own sidebar panel."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from .const import DOMAIN, VERSION
from .due_check import async_check_due, async_start_due_checks
from .entity import VehicleLogCoordinator
from .store import VehicleLogStore
from .websocket_api import async_register_websocket_api

PANEL_URL_PATH = "vehicle-log"
# The version is part of the path, so relative ES-module imports inherit it and
# a release invalidates every cached module (a bump is needed for dev edits too).
STATIC_URL = f"/vehicle_log_static/{VERSION}"
_STATIC_FLAG = f"{DOMAIN}_static_registered"
_WS_FLAG = f"{DOMAIN}_ws_registered"
PLATFORMS = [Platform.SENSOR, Platform.BINARY_SENSOR]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store = VehicleLogStore(hass)
    await store.async_load()
    coordinator = VehicleLogCoordinator(hass, entry, store)
    hass.data[DOMAIN] = {"store": store, "coordinator": coordinator}

    if not hass.data.get(_WS_FLAG):
        async_register_websocket_api(hass)
        hass.data[_WS_FLAG] = True

    # HA cannot unregister static paths, so register once per process.
    if not hass.data.get(_STATIC_FLAG):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    STATIC_URL,
                    str(Path(__file__).parent / "frontend"),
                    cache_headers=True,
                )
            ]
        )
        hass.data[_STATIC_FLAG] = True

    await panel_custom.async_register_panel(
        hass,
        webcomponent_name="vehicle-log-panel",
        frontend_url_path=PANEL_URL_PATH,
        module_url=f"{STATIC_URL}/vehicle-log-panel.js",
        sidebar_title="Dziennik pojazdu",
        sidebar_icon="mdi:car-wrench",
        require_admin=False,
        config={},
    )

    await coordinator.async_config_entry_first_refresh()
    # Sweep entities/devices left behind by objects deleted while we were not loaded.
    coordinator.async_sync_registries()
    entry.async_on_unload(coordinator.async_start())
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(async_start_due_checks(hass, store))
    await async_check_due(hass, store, dt_util.now().date())
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    store: VehicleLogStore = hass.data.pop(DOMAIN)["store"]
    await store.async_flush()
    return True
