"""Constants for the Vehicle Log integration."""

from __future__ import annotations

DOMAIN = "vehicle_log"


def is_polish(language: str | None) -> bool:
    """True for a Polish HA language ("pl", "pl-PL"); everything else gets English."""
    return str(language or "").lower().split("-")[0] == "pl"


def panel_title(language: str | None) -> str:
    return "Dziennik pojazdu" if is_polish(language) else "Vehicle Log"

# Order = picker order.
SERVICE_TYPES: dict[str, dict] = {
    "periodic_service": {"label": "Serwis okresowy", "icon": "mdi:calendar-check"},
    "oil_filter": {"label": "Olej z filtrem", "icon": "mdi:oil"},
    "air_filter": {"label": "Filtr powietrza", "icon": "mdi:air-filter"},
    "cabin_filter": {"label": "Filtr kabinowy", "icon": "mdi:fan"},
    "brake_pads": {"label": "Klocki hamulcowe", "icon": "mdi:car-brake-alert"},
    "brake_discs_pads": {
        "label": "Tarcze i klocki hamulcowe",
        "icon": "mdi:car-brake-abs",
    },
    "brake_fluid": {"label": "Płyn hamulcowy", "icon": "mdi:car-brake-fluid-level"},
    "spark_plugs": {"label": "Świece zapłonowe", "icon": "mdi:flash"},
    "wipers": {"label": "Wycieraczki", "icon": "mdi:wiper"},
    "tyre_change": {"label": "Wymiana opon", "icon": "mdi:car-tire-alert"},
    "wheels": {"label": "Koła", "icon": "mdi:tire"},
    "engine": {"label": "Silnik", "icon": "mdi:engine"},
    "suspension": {"label": "Zawieszenie", "icon": "mdi:car-esp"},
    "gearbox": {"label": "Skrzynia biegów", "icon": "mdi:car-shift-pattern"},
    "fluids": {"label": "Płyny", "icon": "mdi:water"},
    "fuel_filter": {"label": "Filtr paliwa", "icon": "mdi:filter"},
    "timing_belt": {"label": "Pasek rozrządu", "icon": "mdi:cog"},
    "accessory_belt": {"label": "Pasek osprzętu", "icon": "mdi:cog-outline"},
    "coolant": {"label": "Płyn chłodniczy", "icon": "mdi:coolant-temperature"},
    "car_wash": {"label": "Myjnia", "icon": "mdi:car-wash"},
    "tyre_repair": {"label": "Naprawa opony", "icon": "mdi:tire"},
    "electrical": {"label": "Elektryka", "icon": "mdi:car-battery"},
    "bodywork": {"label": "Naprawa karoserii", "icon": "mdi:car-door"},
    "towing": {"label": "Holowanie", "icon": "mdi:tow-truck"},
    "odometer_update": {"label": "Aktualizacja przebiegu", "icon": "mdi:counter"},
    "other": {"label": "Inna obsługa", "icon": "mdi:wrench"},
    "lpg_install": {"label": "Montaż instalacji LPG", "icon": "mdi:propane-tank"},
    "lpg_service": {"label": "Serwis LPG", "icon": "mdi:propane-tank-outline"},
    "refuel": {"label": "Tankowanie", "icon": "mdi:gas-station"},
}

REMINDER_TEMPLATES: dict[str, dict] = {
    "oil_filter": {"interval_months": 12, "interval_km": 10000},
    "periodic_service": {"interval_months": 12, "interval_km": 15000},
    "tyre_change": {"interval_months": 6, "interval_km": None},
    "cabin_filter": {"interval_months": 24, "interval_km": 30000},
    "air_filter": {"interval_months": 24, "interval_km": 30000},
    "brake_fluid": {"interval_months": 24, "interval_km": None},
    "spark_plugs": {"interval_months": 48, "interval_km": 60000},
    "gearbox": {"interval_months": 60, "interval_km": 90000},
    "timing_belt": {"interval_months": 60, "interval_km": 90000},
    "coolant": {"interval_months": 60, "interval_km": None},
    "fuel_filter": {"interval_months": 48, "interval_km": 60000},
}

FUEL_TYPES: list[str] = ["Pb95", "Pb98", "ON", "LPG"]

DEFAULT_SETTINGS: dict = {
    "forecast_enabled": True,
    "odometer_reminder_enabled": True,
    "odometer_reminder_days": 120,
}

VERSION = "0.4.6"
