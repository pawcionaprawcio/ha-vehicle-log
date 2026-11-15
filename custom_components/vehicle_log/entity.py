"""Shared data cache and base entity for Vehicle Log sensors."""

from __future__ import annotations

import logging
from collections.abc import Callable

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.util import dt as dt_util

from .calc import build_view
from .const import DOMAIN
from .store import VehicleLogStore

_LOGGER = logging.getLogger(__name__)

# Unique id suffixes of the entities created for each kind of object.
VEHICLE_KEYS = ("odometer", "forecast_odometer", "consumption", "odometer_update_due")
REMINDER_KEYS = ("remaining_km", "remaining_days", "progress", "due")


class VehicleLogCoordinator(DataUpdateCoordinator[dict]):
    """Holds one build_view result; there is no polling.

    The view is recomputed when the store changes and whenever
    ``async_refresh()`` is called (the daily tick uses that).
    """

    def __init__(
        self, hass: HomeAssistant, entry: ConfigEntry, store: VehicleLogStore
    ) -> None:
        super().__init__(hass, _LOGGER, config_entry=entry, name=DOMAIN)
        self.store = store

    async def _async_update_data(self) -> dict:
        return build_view(self.store.data, dt_util.now().date())

    @callback
    def async_start(self) -> Callable[[], None]:
        """Follow store changes; returns the unsubscribe callable."""
        return self.store.add_listener(self._store_changed)

    @callback
    def _store_changed(self) -> None:
        self.async_set_updated_data(
            build_view(self.store.data, dt_util.now().date())
        )
        self.async_sync_registries()

    def vehicle(self, vehicle_id: str) -> dict | None:
        return next(
            (v for v in self.data["vehicles"] if v["id"] == vehicle_id), None
        )

    def reminder(self, vehicle_id: str, reminder_id: str) -> dict | None:
        vehicle = self.vehicle(vehicle_id)
        if vehicle is None:
            return None
        return next((r for r in vehicle["reminders"] if r["id"] == reminder_id), None)

    @callback
    def async_sync_registries(self) -> None:
        """Drop entities and devices of deleted objects; follow vehicle renames."""
        wanted: set[str] = set()
        names: dict[str, str] = {}
        for v in self.data["vehicles"]:
            names[v["id"]] = v.get("name") or "?"
            wanted.update(f"{v['id']}_{k}" for k in VEHICLE_KEYS)
            for r in v["reminders"]:
                wanted.update(f"{r['id']}_{k}" for k in REMINDER_KEYS)

        ent_reg = er.async_get(self.hass)
        for ent in er.async_entries_for_config_entry(
            ent_reg, self.config_entry.entry_id
        ):
            if ent.unique_id not in wanted:
                ent_reg.async_remove(ent.entity_id)

        dev_reg = dr.async_get(self.hass)
        for device in dr.async_entries_for_config_entry(
            dev_reg, self.config_entry.entry_id
        ):
            vid = next((i for d, i in device.identifiers if d == DOMAIN), None)
            if vid not in names:
                dev_reg.async_remove_device(device.id)
            elif device.name != names[vid]:
                dev_reg.async_update_device(device.id, name=names[vid])


class VehicleLogEntity(Entity):
    """Base: reads from the coordinator cache, no polling."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(
        self, coordinator: VehicleLogCoordinator, vehicle_id: str, key: str,
        unique_prefix: str,
    ) -> None:
        self.coordinator = coordinator
        self._vehicle_id = vehicle_id
        self._attr_translation_key = key
        self._attr_unique_id = f"{unique_prefix}_{key}"
        vehicle = coordinator.vehicle(vehicle_id) or {}
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, vehicle_id)},
            name=vehicle.get("name"),
            entry_type=DeviceEntryType.SERVICE,
        )

    @property
    def _vehicle(self) -> dict | None:
        return self.coordinator.vehicle(self._vehicle_id)

    @property
    def available(self) -> bool:
        return self._vehicle is not None

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            self.coordinator.async_add_listener(self._handle_update)
        )

    @callback
    def _handle_update(self) -> None:
        self.async_write_ha_state()


class ReminderEntity(VehicleLogEntity):
    """Entity of one reminder; named after the reminder text."""

    def __init__(
        self, coordinator: VehicleLogCoordinator, vehicle_id: str,
        reminder_id: str, key: str,
    ) -> None:
        super().__init__(coordinator, vehicle_id, key, reminder_id)
        self._reminder_id = reminder_id
        self._refresh_placeholders()

    def _refresh_placeholders(self) -> None:
        # Assigning the _attr_ value also clears HA's cached property.
        text = (self._reminder or {}).get("text") or ""
        if getattr(self, "_attr_translation_placeholders", {}).get("reminder") != text:
            self._attr_translation_placeholders = {"reminder": text}
            # `name` is a cached property derived from the placeholders.
            self.__dict__.pop("name", None)

    @callback
    def _handle_update(self) -> None:
        self._refresh_placeholders()
        self.async_write_ha_state()

    @property
    def _reminder(self) -> dict | None:
        return self.coordinator.reminder(self._vehicle_id, self._reminder_id)

    @property
    def available(self) -> bool:
        return self._reminder is not None


@callback
def async_setup_dynamic(
    coordinator: VehicleLogCoordinator,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
    factory: Callable[[VehicleLogCoordinator, dict], list[Entity]],
) -> None:
    """Add entities now and for every vehicle/reminder that appears later.

    ``factory(coordinator, view)`` returns the entities for the whole view;
    those whose unique id is already known are skipped.
    """
    known: set[str] = set()

    @callback
    def _add() -> None:
        new: list[Entity] = []
        for ent in factory(coordinator, coordinator.data):
            if ent.unique_id not in known:
                known.add(ent.unique_id)
                new.append(ent)
        if new:
            async_add_entities(new)

    _add()
    entry.async_on_unload(coordinator.async_add_listener(_add))

