"""Vehicle and reminder sensors."""

from __future__ import annotations

from math import floor

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import PERCENTAGE, UnitOfLength, UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import (
    ReminderEntity,
    VehicleLogCoordinator,
    VehicleLogEntity,
    async_setup_dynamic,
    lpg_keys,
)


class OdometerSensor(VehicleLogEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.DISTANCE
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = UnitOfLength.KILOMETERS

    def __init__(self, coordinator: VehicleLogCoordinator, vehicle_id: str) -> None:
        super().__init__(coordinator, vehicle_id, "odometer", vehicle_id)

    @property
    def native_value(self) -> int | None:
        return (self._vehicle or {}).get("odometer")


class ForecastOdometerSensor(VehicleLogEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.DISTANCE
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = UnitOfLength.KILOMETERS

    def __init__(self, coordinator: VehicleLogCoordinator, vehicle_id: str) -> None:
        super().__init__(coordinator, vehicle_id, "forecast_odometer", vehicle_id)

    @property
    def native_value(self) -> int | None:
        return (self._vehicle or {}).get("forecast_odometer")


class ConsumptionSensor(VehicleLogEntity, SensorEntity):
    """State = consumption of the last full-tank segment."""

    _attr_native_unit_of_measurement = "L/100km"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 1

    def __init__(self, coordinator: VehicleLogCoordinator, vehicle_id: str) -> None:
        super().__init__(coordinator, vehicle_id, "consumption", vehicle_id)

    @property
    def _summary(self) -> dict | None:
        return (self._vehicle or {}).get("consumption")

    @property
    def native_value(self) -> float | None:
        return (self._summary or {}).get("last_l_per_100km")

    @property
    def extra_state_attributes(self) -> dict:
        s = self._summary or {}
        return {
            "avg_l_per_100km": s.get("avg_l_per_100km"),
            "avg_cost_per_100km": s.get("avg_cost_per_100km"),
        }


class LpgSavingsSensor(VehicleLogEntity, SensorEntity):
    """Net LPG savings: fuel saved minus LPG install and service costs."""

    _attr_device_class = SensorDeviceClass.MONETARY
    _attr_suggested_display_precision = 2

    def __init__(self, coordinator: VehicleLogCoordinator, vehicle_id: str) -> None:
        super().__init__(coordinator, vehicle_id, "lpg_savings", vehicle_id)
        self._attr_native_unit_of_measurement = coordinator.hass.config.currency

    @property
    def _lpg(self) -> dict:
        return (self._vehicle or {}).get("lpg") or {}

    @property
    def native_value(self) -> float | None:
        value = self._lpg.get("net_savings")
        return None if value is None else round(value, 2)

    @property
    def extra_state_attributes(self) -> dict:
        lpg = self._lpg
        return {k: lpg.get(k) for k in (
            "fuel_savings", "lpg_cost", "baseline_l_per_100km", "baseline_source",
            "install_odometer", "km_since_install", "unpriced_count",
        )}


class LpgPaybackSensor(VehicleLogEntity, SensorEntity):
    """How much of the LPG cost the fuel savings have paid back, in %."""

    _attr_native_unit_of_measurement = PERCENTAGE

    def __init__(self, coordinator: VehicleLogCoordinator, vehicle_id: str) -> None:
        super().__init__(coordinator, vehicle_id, "lpg_payback", vehicle_id)

    @property
    def native_value(self) -> int | None:
        lpg = (self._vehicle or {}).get("lpg") or {}
        progress = lpg.get("progress_pct")
        return None if progress is None else floor(progress)

    @property
    def extra_state_attributes(self) -> dict:
        lpg = (self._vehicle or {}).get("lpg") or {}
        return {k: lpg.get(k) for k in (
            "remaining", "paid_back", "payback_odometer", "payback_month",
        )}


_LPG_SENSORS = {"lpg_savings": LpgSavingsSensor, "lpg_payback": LpgPaybackSensor}


class RemainingKmSensor(ReminderEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.DISTANCE
    _attr_native_unit_of_measurement = UnitOfLength.KILOMETERS

    def __init__(self, coordinator, vehicle_id, reminder_id) -> None:
        super().__init__(coordinator, vehicle_id, reminder_id, "remaining_km")

    @property
    def native_value(self) -> int | None:
        return (self._reminder or {}).get("km_left")


class RemainingDaysSensor(ReminderEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.DURATION
    _attr_native_unit_of_measurement = UnitOfTime.DAYS

    def __init__(self, coordinator, vehicle_id, reminder_id) -> None:
        super().__init__(coordinator, vehicle_id, reminder_id, "remaining_days")

    @property
    def native_value(self) -> int | None:
        return (self._reminder or {}).get("days_left")


class ProgressSensor(ReminderEntity, SensorEntity):
    _attr_native_unit_of_measurement = PERCENTAGE

    def __init__(self, coordinator, vehicle_id, reminder_id) -> None:
        super().__init__(coordinator, vehicle_id, reminder_id, "progress")

    @property
    def native_value(self) -> int | None:
        progress = (self._reminder or {}).get("progress")
        return None if progress is None else floor(progress)


def _entities(coordinator: VehicleLogCoordinator, view: dict) -> list:
    out: list = []
    for v in view["vehicles"]:
        out += [
            OdometerSensor(coordinator, v["id"]),
            ForecastOdometerSensor(coordinator, v["id"]),
            ConsumptionSensor(coordinator, v["id"]),
        ]
        out += [_LPG_SENSORS[k](coordinator, v["id"]) for k in lpg_keys(v)]
        for r in v["reminders"]:
            out += [
                RemainingKmSensor(coordinator, v["id"], r["id"]),
                RemainingDaysSensor(coordinator, v["id"], r["id"]),
                ProgressSensor(coordinator, v["id"], r["id"]),
            ]
    return out


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator = hass.data[DOMAIN]["coordinator"]
    async_setup_dynamic(coordinator, entry, async_add_entities, _entities)
