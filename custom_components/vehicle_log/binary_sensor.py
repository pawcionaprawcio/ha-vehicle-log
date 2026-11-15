"""Vehicle and reminder binary sensors."""

from __future__ import annotations

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import (
    ReminderEntity,
    VehicleLogCoordinator,
    VehicleLogEntity,
    async_setup_dynamic,
)


class OdometerUpdateDueSensor(VehicleLogEntity, BinarySensorEntity):
    _attr_device_class = BinarySensorDeviceClass.PROBLEM

    def __init__(self, coordinator: VehicleLogCoordinator, vehicle_id: str) -> None:
        super().__init__(coordinator, vehicle_id, "odometer_update_due", vehicle_id)

    @property
    def is_on(self) -> bool | None:
        status = (self._vehicle or {}).get("odometer_update")
        return None if status is None else bool(status["is_due"])


class ReminderDueSensor(ReminderEntity, BinarySensorEntity):
    _attr_device_class = BinarySensorDeviceClass.PROBLEM

    def __init__(self, coordinator, vehicle_id, reminder_id) -> None:
        super().__init__(coordinator, vehicle_id, reminder_id, "due")

    @property
    def is_on(self) -> bool | None:
        reminder = self._reminder
        return None if reminder is None else bool(reminder["is_due"])

    @property
    def extra_state_attributes(self) -> dict:
        r = self._reminder or {}
        return {"due_date": r.get("due_date"), "due_odometer": r.get("due_odometer")}


def _entities(coordinator: VehicleLogCoordinator, view: dict) -> list:
    out: list = []
    for v in view["vehicles"]:
        out.append(OdometerUpdateDueSensor(coordinator, v["id"]))
        out += [ReminderDueSensor(coordinator, v["id"], r["id"]) for r in v["reminders"]]
    return out


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator = hass.data[DOMAIN]["coordinator"]
    async_setup_dynamic(coordinator, entry, async_add_entities, _entities)
