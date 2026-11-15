"""Due notifications: persistent notification plus a bus event per new due item."""

from __future__ import annotations

from collections.abc import Callable
from datetime import date

from homeassistant.components import persistent_notification
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_time_change
from homeassistant.util import dt as dt_util

from .calc import build_view
from .const import DOMAIN
from .store import VehicleLogStore

EVENT_REMINDER_DUE = "vehicle_log_reminder_due"
NOTIFICATION_TITLE = "Dziennik pojazdu"


def _notification_id(key: str) -> str:
    kind, _, ident = key.partition(":")
    return f"vehicle_log_odometer_{ident}" if kind == "odometer" else f"vehicle_log_{ident}"


def _reminder_message(vehicle: str, r: dict) -> str:
    parts = []
    if r["due_date"]:
        parts.append(f"termin {r['due_date']}")
    if r["due_odometer"] is not None:
        parts.append(f"{r['due_odometer']} km")
    suffix = f" — {' / '.join(parts)}" if parts else ""
    return f"{vehicle}: {r.get('text') or r.get('service_type') or '?'}{suffix}"


async def async_check_due(
    hass: HomeAssistant, store: VehicleLogStore, today: date
) -> list[str]:
    """Notify about newly due items; returns the newly notified keys."""
    view = build_view(store.data, today)
    due: dict[str, tuple[str, dict, dict]] = {}
    for v in view["vehicles"]:
        for r in v["reminders"]:
            if r["is_due"]:
                due[f"reminder:{r['id']}"] = ("reminder", v, r)
        if (v.get("odometer_update") or {}).get("is_due"):
            due[f"odometer:{v['id']}"] = ("odometer", v, v["odometer_update"])

    notified = store.notified
    new = [k for k in due if k not in notified]
    # Only write when the set really changes, so store listeners do not loop.
    if set(due) != notified:
        await store.async_set_notified(set(due))
    # Items that stopped being due (reset, edited, deleted) lose their notification.
    for key in sorted((notified | store.pop_dropped_notified()) - set(due)):
        persistent_notification.async_dismiss(hass, _notification_id(key))

    for key in new:
        kind, v, item = due[key]
        if kind == "reminder":
            message = _reminder_message((v.get("name") or "?"), item)
            data = {
                "kind": "reminder", "vehicle_id": v["id"],
                "vehicle_name": (v.get("name") or "?"), "reminder_id": item["id"],
                "text": (item.get("text") or ""), "due_date": item["due_date"],
                "due_odometer": item["due_odometer"],
            }
            notification_id = f"vehicle_log_{item['id']}"
        else:
            message = (
                f"{(v.get('name') or '?')}: zaktualizuj przebieg "
                f"(ostatni wpis {item['last_date']})"
            )
            data = {
                "kind": "odometer", "vehicle_id": v["id"],
                "vehicle_name": (v.get("name") or "?"), "last_date": item["last_date"],
            }
            notification_id = f"vehicle_log_odometer_{v['id']}"
        persistent_notification.async_create(
            hass, message, title=NOTIFICATION_TITLE,
            notification_id=notification_id,
        )
        hass.bus.async_fire(EVENT_REMINDER_DUE, data)
    return new


@callback
def async_start_due_checks(hass: HomeAssistant, store: VehicleLogStore) -> Callable[[], None]:
    """Check on store changes and daily at 09:00; returns the unsubscribe callable."""

    async def _check() -> None:
        await async_check_due(hass, store, dt_util.now().date())

    @callback
    def _on_store_change() -> None:
        hass.async_create_task(_check())

    async def _on_tick(_now) -> None:
        await hass.data[DOMAIN]["coordinator"].async_refresh()
        await _check()

    unsub_store = store.add_listener(_on_store_change)
    unsub_time = async_track_time_change(hass, _on_tick, hour=9, minute=0, second=0)

    def unsub() -> None:
        unsub_store()
        unsub_time()

    return unsub
