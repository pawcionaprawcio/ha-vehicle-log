"""Pure calculation helpers for Vehicle Log."""

from __future__ import annotations

import calendar
import logging
import math
from datetime import date, timedelta
from typing import Any

from .const import DEFAULT_SETTINGS, FUEL_TYPES, REMINDER_TEMPLATES, SERVICE_TYPES

_LOGGER = logging.getLogger(__name__)

# What a reminder looks like when its status could not be computed.
_ERROR_STATUS: dict[str, Any] = {
    "due_date": None, "due_odometer": None, "days_left": None, "km_left": None,
    "progress_time": None, "progress_km": None, "progress_forecast": None,
    "progress": None, "is_due": False,
}


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _is_num(v: Any) -> bool:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    # Huge ints cannot be converted to float, so only floats need the finite test.
    return isinstance(v, int) or math.isfinite(v)


YEAR_MIN, YEAR_MAX = 1900, 2200


def entry_is_valid(e: dict) -> bool:
    """Whether an entry can safely take part in calculations.

    Storage is validated on write, but a hand-edited or older file must never
    be able to break the whole view.
    """
    d = e.get("date")
    if d is not None:
        if not isinstance(d, str):
            return False
        try:
            parsed = date.fromisoformat(d)
        except ValueError:
            return False
        if not YEAR_MIN <= parsed.year <= YEAR_MAX:
            return False
    if e.get("odometer") is not None and not _is_int(e["odometer"]):
        return False
    if not isinstance(e.get("time") or "", str):
        return False
    return all(e.get(k) is None or _is_num(e[k]) for k in ("litres", "total"))


def add_months(d: date, months: int) -> date:
    """Add months to a date, clamping the day to the end of the target month."""
    index = d.year * 12 + (d.month - 1) + months
    year, month = divmod(index, 12)
    month += 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def parse_date(s: str) -> date:
    """Parse an ISO (YYYY-MM-DD) date string."""
    return date.fromisoformat(s)


def entry_total(
    parts: float | None,
    labour: float | None,
    tax_pct: float | None,
    discount_pct: float | None,
    discount_amount: float | None,
) -> float:
    """Total cost: (parts + labour) less discounts, plus tax, rounded to 2 dp."""
    base = (parts or 0) + (labour or 0)
    base = base * (1 - (discount_pct or 0) / 100) - (discount_amount or 0)
    return round(base * (1 + (tax_pct or 0) / 100), 2)


def normalize_refuel(
    total: float | None, litres: float | None, price_per_litre: float | None
) -> tuple[float, float, float]:
    """Return (total, litres, price_per_litre), deriving the missing one.

    Raises ValueError if fewer than two are given or a divisor is zero.
    """
    if sum(v is not None for v in (total, litres, price_per_litre)) < 2:
        raise ValueError("at least two of total, litres, price_per_litre required")
    if total is not None and litres is not None and price_per_litre is not None:
        return total, litres, price_per_litre
    if total is None:
        return round(litres * price_per_litre, 2), litres, price_per_litre
    if litres is None:
        if not price_per_litre:
            raise ValueError("price_per_litre must be non-zero")
        return total, round(total / price_per_litre, 3), price_per_litre
    if not litres:
        raise ValueError("litres must be non-zero")
    return total, litres, round(total / litres, 3)


def consumption_segments(refuels: list[dict]) -> list[dict]:
    """Full-tank to full-tank consumption segments, ordered by odometer."""
    entries = sorted(
        (r for r in refuels if r.get("odometer") is not None and entry_is_valid(r)),
        key=lambda r: (r["odometer"], r.get("date") or "", r.get("time") or ""),
    )
    segments: list[dict] = []
    start_odo: int | None = None
    litres = 0.0
    cost = 0.0
    for r in entries:
        if start_odo is not None:
            litres += r.get("litres") or 0
            cost += r.get("total") or 0
        if not r.get("full_tank"):
            continue
        if start_odo is not None:
            km = r["odometer"] - start_odo
            if km > 0:
                segments.append(
                    {
                        "from_odometer": start_odo,
                        "to_odometer": r["odometer"],
                        "to_date": r.get("date"),
                        "km": km,
                        "litres": litres,
                        "cost": cost,
                        "l_per_100km": litres / km * 100,
                        "cost_per_100km": cost / km * 100,
                    }
                )
        start_odo = r["odometer"]
        litres = 0.0
        cost = 0.0
    return segments


def consumption_summary(segments: list[dict]) -> dict | None:
    """Last and average consumption over segments (average = sum / sum)."""
    if not segments:
        return None
    km = sum(s["km"] for s in segments)
    return {
        "last_l_per_100km": segments[-1]["l_per_100km"],
        "avg_l_per_100km": sum(s["litres"] for s in segments) / km * 100,
        "avg_cost_per_100km": sum(s["cost"] for s in segments) / km * 100,
    }


def readings(entries: list[dict]) -> list[tuple[date, int]]:
    """(date, odometer) for every entry with an odometer, sorted."""
    return sorted(
        (parse_date(e["date"]), e["odometer"])
        for e in entries
        if e.get("odometer") is not None and e.get("date") and entry_is_valid(e)
    )


def last_reading(entries: list[dict]) -> tuple[date, int] | None:
    """The reading with the highest odometer (latest date breaks ties)."""
    rs = readings(entries)
    if not rs:
        return None
    return max(rs, key=lambda r: (r[1], r[0]))


def forecast_odometer(entries: list[dict], today: date) -> int | None:
    """Extrapolate the odometer to today from the recent driving rate."""
    last = last_reading(entries)
    if last is None:
        return None
    last_date, last_odo = last
    rs = readings(entries)
    chosen = [r for r in rs if r[0] >= last_date - timedelta(days=365)]
    if (chosen[-1][0] - chosen[0][0]).days < 14:
        chosen = rs
    span = (chosen[-1][0] - chosen[0][0]).days
    if len(chosen) < 2 or span < 14:
        return last_odo
    odos = [r[1] for r in chosen]
    rate = (max(odos) - min(odos)) / span
    return last_odo + round(rate * max(0, (today - last_date).days))


def _pct(done: float, total: float) -> float:
    return max(0.0, done / total * 100)


def reminder_status(
    reminder: dict, entries: list[dict], today: date, forecast_enabled: bool
) -> dict:
    """Due date/odometer, remaining time/km and progress for one reminder."""
    base_date = parse_date(reminder["baseline_date"])
    base_odo = reminder["baseline_odometer"]
    months = reminder.get("interval_months")
    km = reminder.get("interval_km")
    last = last_reading(entries)
    current = last[1] if last else None
    forecast = forecast_odometer(entries, today) if forecast_enabled else None

    due_date = add_months(base_date, months) if months else None
    due_odo = base_odo + km if km and base_odo is not None else None

    days_left = (due_date - today).days if due_date else None
    progress_time = (
        _pct((today - base_date).days, (due_date - base_date).days)
        if due_date
        else None
    )
    km_left = due_odo - current if due_odo is not None and current is not None else None
    progress_km = (
        _pct(current - base_odo, km)
        if km and current is not None and base_odo is not None
        else None
    )
    progress_forecast = (
        _pct(forecast - base_odo, km)
        if km and forecast is not None and base_odo is not None
        else None
    )
    values = [
        v for v in (progress_time, progress_km, progress_forecast) if v is not None
    ]
    return {
        "due_date": due_date.isoformat() if due_date else None,
        "due_odometer": due_odo,
        "days_left": days_left,
        "km_left": km_left,
        "progress_time": progress_time,
        "progress_km": progress_km,
        "progress_forecast": progress_forecast,
        "progress": max(values) if values else None,
        "is_due": any(v >= 100 for v in values),
    }


def _reminder_days(settings: dict) -> int:
    days = settings.get("odometer_reminder_days")
    if not _is_int(days):
        return DEFAULT_SETTINGS["odometer_reminder_days"]
    return days


def odometer_update_status(entries: list[dict], today: date, settings: dict) -> dict:
    """Whether the odometer has gone too long without a reading."""
    rs = readings(entries)
    if not rs:
        return {"last_date": None, "days_since": None, "is_due": False}
    last_date = rs[-1][0]
    days_since = (today - last_date).days
    return {
        "last_date": last_date.isoformat(),
        "days_since": days_since,
        "is_due": bool(settings.get("odometer_reminder_enabled"))
        and days_since > _reminder_days(settings),
    }


def _entry_sort_key(e: dict) -> tuple:
    if e.get("error"):
        return ("", "", 0)
    return (e.get("date") or "", e.get("time") or "", e.get("odometer") or 0)


def _reminder_view(
    r: dict, entries: list[dict], today: date, forecast_enabled: bool
) -> dict:
    """Reminder plus its status; a broken record is flagged, never raised."""
    try:
        return {**r, **reminder_status(r, entries, today, forecast_enabled)}
    except Exception:  # noqa: BLE001 - one bad record must not brick the view
        _LOGGER.exception("Cannot compute reminder %s, flagging it", r.get("id"))
        return {**r, **_ERROR_STATUS, "error": True}


def _vehicle_view(vehicle: dict, data: dict, today: date, settings: dict) -> dict:
    vid = vehicle["id"]
    entries = [e for e in data["entries"] if e["vehicle_id"] == vid]
    last = last_reading(entries)
    segments = consumption_segments([e for e in entries if e["kind"] == "refuel"])
    reminders = [
        _reminder_view(r, entries, today, settings["forecast_enabled"])
        for r in data["reminders"]
        if r["vehicle_id"] == vid
    ]
    reminders.sort(
        key=lambda r: r["progress"] if r["progress"] is not None else -1,
        reverse=True,
    )
    return {
        **vehicle,
        "odometer": last[1] if last else None,
        "forecast_odometer": forecast_odometer(entries, today),
        "consumption": consumption_summary(segments),
        "segments": segments,
        "odometer_update": odometer_update_status(entries, today, settings),
        "entries": sorted(
            (
                e if entry_is_valid(e) else {**e, "error": True}
                for e in entries
            ),
            key=_entry_sort_key,
            reverse=True,
        ),
        "reminders": reminders,
    }


def build_view(data: dict, today: date) -> dict:
    """Assemble the per-vehicle view model sent to the frontend."""
    settings = {**DEFAULT_SETTINGS, **data["settings"]}
    vehicles = []
    for vehicle in data["vehicles"]:
        try:
            vehicles.append(_vehicle_view(vehicle, data, today, settings))
        except Exception:  # noqa: BLE001 - one bad vehicle must not break the rest
            _LOGGER.exception("Could not build view for vehicle %r", vehicle.get("id"))
            vehicles.append(
                {**vehicle, "error": True, "entries": [], "reminders": [], "segments": [],
                 "odometer": None, "forecast_odometer": None, "consumption": None,
                 "odometer_update": {"last_date": None, "days_since": None,
                                     "is_due": False}}
            )
    return {
        "vehicles": vehicles,
        "settings": settings,
        "service_types": SERVICE_TYPES,
        "reminder_templates": REMINDER_TEMPLATES,
        "fuel_types": FUEL_TYPES,
    }
