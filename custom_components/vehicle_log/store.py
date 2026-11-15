"""Persistent storage for Vehicle Log: CRUD, reminder auto-reset, import merge."""

from __future__ import annotations

import copy
import logging
import math
import re
import uuid
from collections import Counter
from collections.abc import Callable
from datetime import date as _date
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .calc import YEAR_MAX, YEAR_MIN, entry_is_valid, entry_total, last_reading, normalize_refuel
from .const import DEFAULT_SETTINGS, DOMAIN, SERVICE_TYPES
from .xlsx_import import ParsedVehicle

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
SAVE_DELAY = 1

ENTRY_KINDS = ("service", "odometer", "refuel")
NAME_MAX = 70
PART_NUMBERS_MAX = 300
COMMENT_MAX = 1000
REMINDER_TEXT_MAX = 70
EXTRA_TEXT_MAX = 300
INTERVAL_MONTHS_MAX = 1200
INTERVAL_KM_MAX = 1_000_000
ODOMETER_MAX = 10_000_000
REMINDER_DAYS_MAX = 3650
AMOUNT_MAX = 1e9

_INT_FIELDS = frozenset({"odometer", "baseline_odometer", "interval_km", "interval_months"})
_ENTRY_DEFAULTS: dict[str, Any] = {
    "kind": "service", "service_type": "other", "name": "", "date": None,
    "time": None, "odometer": None, "parts": None, "labour": None,
    "tax_pct": None, "discount_pct": None, "discount_amount": None,
    "total": None, "part_numbers": "", "comment": "", "accessory": False,
    "fuel_type": None, "litres": None, "price_per_litre": None, "full_tank": False,
}


def _new_id() -> str:
    return uuid.uuid4().hex


def _check_len(label: str, value: Any, limit: int) -> None:
    if value is None:
        return
    if not isinstance(value, str):
        raise ValueError(f"{label} must be text")
    if len(value) > limit:
        raise ValueError(f"{label} is longer than {limit} characters")


def _check_date(label: str, value: Any) -> str | None:
    """None/'' -> None; otherwise a real ISO date (YYYY-MM-DD) in a sane range."""
    if value is None or value == "":
        return None
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError(f"{label} must be an ISO date (YYYY-MM-DD)")
    try:
        parsed = _date.fromisoformat(value)
    except ValueError as err:
        raise ValueError(f"{label} is not a valid date") from err
    if not YEAR_MIN <= parsed.year <= YEAR_MAX:
        raise ValueError(f"{label} year must be {YEAR_MIN}-{YEAR_MAX}")
    return value


def _check_time(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str) or not re.fullmatch(r"\d{2}:\d{2}(:\d{2})?", value):
        raise ValueError("time must be HH:MM")
    return value


def _check_int(label: str, value: Any, lo: int, hi: int) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a whole number")
    if isinstance(value, float):
        if not math.isfinite(value) or not value.is_integer():
            raise ValueError(f"{label} must be a whole number")
        value = int(value)
    if not lo <= value <= hi:
        raise ValueError(f"{label} must be between {lo} and {hi}")
    return value


def _check_odometer(label: str, value: Any) -> int | None:
    return _check_int(label, value, 0, ODOMETER_MAX)


def _check_amount(label: str, value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a number")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"{label} is out of range")
    if abs(value) > AMOUNT_MAX:
        raise ValueError(f"{label} is out of range")
    return value


def _check_bool(label: str, value: Any) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{label} must be true or false")
    return value


_AMOUNT_FIELDS = (
    "parts", "labour", "tax_pct", "discount_pct", "discount_amount", "total",
    "litres", "price_per_litre",
)


def _check_settings(partial: dict) -> dict:
    out: dict[str, Any] = {}
    for key, value in partial.items():
        if key == "odometer_reminder_days":
            if value is None:
                raise ValueError("odometer_reminder_days must be a whole number")
            out[key] = _check_int(key, value, 1, REMINDER_DAYS_MAX)
        else:
            out[key] = _check_bool(key, value)
    return out


def _sanitize_settings(settings: Any) -> dict:
    """Merge stored settings over the defaults, dropping invalid values."""
    merged = dict(DEFAULT_SETTINGS)
    if not isinstance(settings, dict):
        return merged
    for key in DEFAULT_SETTINGS:
        if key in settings:
            try:
                merged.update(_check_settings({key: settings[key]}))
            except ValueError:
                _LOGGER.warning("Ignoring invalid stored setting %s", key)
    return merged


def _clean_reminder(r: dict) -> dict:
    """Validated reminder fields shared by the write path and load-time checks."""
    if not isinstance(r.get("service_type"), str) or r["service_type"] not in SERVICE_TYPES:
        raise ValueError(f"unknown service_type: {r.get('service_type')!r}")
    text = r.get("text") or ""
    extra = r.get("extra_text") or ""
    _check_len("text", text, REMINDER_TEXT_MAX)
    _check_len("extra_text", extra, EXTRA_TEXT_MAX)
    return {
        "text": text,
        "extra_text": extra,
        "baseline_date": _check_date("baseline_date", r.get("baseline_date")),
        "baseline_odometer": _check_odometer("baseline_odometer", r.get("baseline_odometer")),
        "interval_km": _check_int("interval_km", r.get("interval_km"), 1, INTERVAL_KM_MAX),
        "interval_months": _check_int(
            "interval_months", r.get("interval_months"), 1, INTERVAL_MONTHS_MAX
        ),
    }


class _VehicleLogStorage(Store):
    """HA Store with a migration hook for future storage versions."""

    async def _async_migrate_func(self, old_major_version, old_minor_version, old_data):
        if old_major_version > STORAGE_VERSION:
            raise NotImplementedError(
                f"Storage version {old_major_version}.{old_minor_version} is newer "
                "than this Vehicle Log release"
            )
        if old_major_version != STORAGE_VERSION:
            _LOGGER.warning(
                "Unknown storage version %s.%s, loading data as is",
                old_major_version, old_minor_version,
            )
        # Future versions: transform old_data step by step here.
        return old_data


def _empty() -> dict:
    return {
        "vehicles": [], "entries": [], "reminders": [],
        "settings": dict(DEFAULT_SETTINGS), "notified": [], "quarantine": [],
    }


class VehicleLogStore:
    """Owns all Vehicle Log data and persists it with a delayed save."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._store: Store = _VehicleLogStorage(hass, STORAGE_VERSION, DOMAIN)
        self._data: dict = _empty()
        self._listeners: list[Callable[[], None]] = []
        # Notified keys removed by edits since the last due check; their
        # persistent notifications still have to be dismissed.
        self._dropped: set[str] = set()

    async def async_load(self) -> None:
        stored = await self._store.async_load()
        data = _empty()
        if stored:
            data.update({k: stored[k] for k in data if k in stored})
            data["settings"] = _sanitize_settings(data["settings"])
            if not isinstance(data["quarantine"], list):
                data["quarantine"] = []
            self._drop_invalid(data)
            if not isinstance(data["notified"], list):
                data["notified"] = []
        self._data = data

    def _drop_invalid(self, data: dict) -> None:
        """Validate stored records without losing data.

        Valid records stay untouched. A bad optional field is reset to its
        default; a record that cannot be repaired moves to ``quarantine`` (the
        original dict plus a ``reason``), which nothing else reads.
        """
        quarantine = data["quarantine"]

        def park(item: Any, reason: str) -> None:
            _LOGGER.warning(
                "Quarantining stored record %r: %s",
                item.get("id") if isinstance(item, dict) else None, reason,
            )
            parked = {**item, "reason": reason} if isinstance(item, dict) else {
                "raw": item, "reason": reason,
            }
            if parked not in quarantine:
                quarantine.append(parked)

        def repair(item: dict, fixes: dict[str, Callable[[Any], Any]], defaults: dict) -> dict:
            """Copy of item with each failing optional field reset to its default."""
            fixed = item
            for field, check in fixes.items():
                if field not in item:
                    continue
                try:
                    result = check(item[field])
                    if field in _INT_FIELDS and type(result) is int and type(item[field]) is float:
                        if fixed is item:
                            fixed = dict(item)
                        fixed[field] = result
                    continue
                except (ValueError, TypeError, ArithmeticError) as err:
                    if fixed is item:
                        fixed = dict(item)
                    _LOGGER.warning(
                        "Resetting invalid %s of stored record %r: %s",
                        field, item.get("id"), err,
                    )
                    fixed[field] = defaults.get(field)
            return fixed

        def sweep(items: Any, handle: Callable[[dict], dict]) -> list[dict]:
            good = []
            for item in items if isinstance(items, list) else []:
                try:
                    if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                        raise ValueError("not a record with an id")
                    good.append(handle(item))
                except (ValueError, TypeError, KeyError, AttributeError, ArithmeticError) as err:
                    park(item, str(err))
            return good

        def handle_vehicle(v: dict) -> dict:
            if not isinstance(v.get("name"), str):
                raise ValueError("vehicle name is required")
            if not v["name"].strip():
                v = {**v, "name": f"Pojazd {v['id'][:6]}"}
            elif len(v["name"]) > NAME_MAX:
                v = {**v, "name": v["name"][:NAME_MAX]}
            return repair(v, {
                "purchase_date": lambda x: _check_date("purchase_date", x),
                "icon": lambda x: _check_len("icon", x, NAME_MAX),
            }, {})

        data["vehicles"] = sweep(data["vehicles"], handle_vehicle)
        ids = {v["id"] for v in data["vehicles"]}

        entry_fixes: dict[str, Callable[[Any], Any]] = {
            f: (lambda x, f=f: _check_len(f, x, m))
            for f, m in (("name", NAME_MAX), ("part_numbers", PART_NUMBERS_MAX),
                         ("comment", COMMENT_MAX), ("fuel_type", NAME_MAX))
        }
        entry_fixes["time"] = _check_time
        entry_fixes["odometer"] = lambda x: _check_odometer("odometer", x)
        for f in _AMOUNT_FIELDS:
            entry_fixes[f] = lambda x, f=f: _check_amount(f, x)
        entry_fixes["accessory"] = lambda x: _check_bool("accessory", x)
        entry_fixes["full_tank"] = lambda x: _check_bool("full_tank", x)

        def handle_entry(e: dict) -> dict:
            if "kind" not in e:
                raise ValueError("kind is missing")
            fixed = repair(e, entry_fixes, _ENTRY_DEFAULTS)
            self._normalize_entry(fixed, ids)
            if not entry_is_valid(fixed):
                raise ValueError("entry values are out of range")
            return fixed

        reminder_fixes: dict[str, Callable[[Any], Any]] = {
            "text": lambda x: _check_len("text", x or "", REMINDER_TEXT_MAX),
            "extra_text": lambda x: _check_len("extra_text", x or "", EXTRA_TEXT_MAX),
            "baseline_odometer": lambda x: _check_odometer("baseline_odometer", x),
            "interval_km": lambda x: _check_int("interval_km", x, 1, INTERVAL_KM_MAX),
            "interval_months": lambda x: _check_int(
                "interval_months", x, 1, INTERVAL_MONTHS_MAX
            ),
        }
        reminder_defaults = {"text": "", "extra_text": ""}

        def handle_reminder(r: dict) -> dict:
            if r.get("vehicle_id") not in ids:
                raise ValueError("unknown vehicle_id")
            fixed = repair(r, reminder_fixes, reminder_defaults)
            if _clean_reminder(fixed)["baseline_date"] is None:
                raise ValueError("baseline_date is missing")
            return fixed

        data["entries"] = sweep(data["entries"], handle_entry)
        data["reminders"] = sweep(data["reminders"], handle_reminder)

    async def async_flush(self) -> None:
        """Write pending changes now (cancels any delayed save)."""
        await self._store.async_save(self._data)

    @property
    def data(self) -> dict:
        return self._data

    @property
    def notified(self) -> set[str]:
        return set(self._data["notified"])

    def pop_dropped_notified(self) -> set[str]:
        dropped, self._dropped = self._dropped, set()
        return dropped

    def add_listener(self, cb: Callable[[], None]) -> Callable[[], None]:
        self._listeners.append(cb)

        def unsub() -> None:
            if cb in self._listeners:
                self._listeners.remove(cb)

        return unsub

    def _changed(self) -> None:
        self._store.async_delay_save(lambda: self._data, SAVE_DELAY)
        for cb in list(self._listeners):
            cb()

    # -- helpers ---------------------------------------------------------

    def _vehicle_ids(self) -> set[str]:
        return {v["id"] for v in self._data["vehicles"]}

    def _entry_for_vehicle(self, vehicle_id: str) -> list[dict]:
        return [e for e in self._data["entries"] if e["vehicle_id"] == vehicle_id]

    @staticmethod
    def _upsert(items: list[dict], item: dict) -> None:
        for i, existing in enumerate(items):
            if existing["id"] == item["id"]:
                items[i] = item
                return
        items.append(item)

    def _normalize_entry(self, raw: dict, vehicle_ids: set[str]) -> dict:
        e = {**_ENTRY_DEFAULTS, **raw}
        e["id"] = raw.get("id") or _new_id()
        if not isinstance(e["id"], str):
            raise ValueError("id must be text")
        if not isinstance(e.get("vehicle_id"), str) or e["vehicle_id"] not in vehicle_ids:
            raise ValueError("unknown vehicle_id")
        if not isinstance(e["kind"], str) or e["kind"] not in ENTRY_KINDS:
            raise ValueError(f"unknown entry kind: {e['kind']}")
        _check_len("name", e["name"], NAME_MAX)
        _check_len("part_numbers", e["part_numbers"], PART_NUMBERS_MAX)
        _check_len("comment", e["comment"], COMMENT_MAX)
        _check_len("fuel_type", e["fuel_type"], NAME_MAX)
        e["date"] = _check_date("date", e["date"])
        e["time"] = _check_time(e["time"])
        e["odometer"] = _check_odometer("odometer", e["odometer"])
        for field in _AMOUNT_FIELDS:
            e[field] = _check_amount(field, e[field])
        e["accessory"] = _check_bool("accessory", e["accessory"])
        e["full_tank"] = _check_bool("full_tank", e["full_tank"])
        if e["kind"] == "refuel":
            e["service_type"] = "refuel"
            e["total"], e["litres"], e["price_per_litre"] = normalize_refuel(
                e["total"], e["litres"], e["price_per_litre"]
            )
        elif e["kind"] == "odometer":
            e["service_type"] = "odometer_update"
        else:
            if not isinstance(e["service_type"], str) or e["service_type"] not in SERVICE_TYPES:
                raise ValueError(f"unknown service_type: {e['service_type']}")
            has_cost = any(
                e[k] is not None
                for k in ("parts", "labour", "discount_pct", "discount_amount")
            )
            if e["total"] is None and has_cost:
                e["total"] = entry_total(
                    e["parts"], e["labour"], e["tax_pct"],
                    e["discount_pct"], e["discount_amount"],
                )
        return {k: e[k] for k in ("id", "vehicle_id", *_ENTRY_DEFAULTS)}

    def _apply_reminder_resets(self, entry: dict) -> None:
        if entry["kind"] != "service" or not entry["date"]:
            return
        fallback = last_reading(self._entry_for_vehicle(entry["vehicle_id"]))
        for r in self._data["reminders"]:
            if (
                r.get("vehicle_id") == entry["vehicle_id"]
                and r.get("service_type") == entry["service_type"]
                and isinstance(r.get("baseline_date"), str)
                and entry["date"] >= r["baseline_date"]
            ):
                r["baseline_date"] = entry["date"]
                if entry["odometer"] is not None:
                    r["baseline_odometer"] = entry["odometer"]
                elif fallback:
                    r["baseline_odometer"] = fallback[1]
                self._drop_notified(f"reminder:{r['id']}")

    def _drop_notified(self, key: str) -> None:
        if key in self._data["notified"]:
            self._data["notified"].remove(key)
            self._dropped.add(key)

    # -- vehicles --------------------------------------------------------

    async def async_save_vehicle(self, v: dict) -> dict:
        _check_len("name", v.get("name"), NAME_MAX * 4)
        name = (v.get("name") or "").strip()
        if not name:
            raise ValueError("vehicle name is required")
        _check_len("name", name, NAME_MAX)
        vehicle = {
            "id": v.get("id") or _new_id(),
            "name": name,
            "purchase_date": _check_date("purchase_date", v.get("purchase_date")),
            "icon": v.get("icon"),
        }
        if not isinstance(vehicle["id"], str):
            raise ValueError("id must be text")
        _check_len("icon", vehicle["icon"], NAME_MAX)
        self._upsert(self._data["vehicles"], vehicle)
        self._changed()
        return copy.deepcopy(vehicle)

    async def async_delete_vehicle(self, vehicle_id: str) -> None:
        d = self._data
        d["vehicles"] = [v for v in d["vehicles"] if v["id"] != vehicle_id]
        d["entries"] = [e for e in d["entries"] if e["vehicle_id"] != vehicle_id]
        gone = {r["id"] for r in d["reminders"] if r["vehicle_id"] == vehicle_id}
        d["reminders"] = [r for r in d["reminders"] if r["vehicle_id"] != vehicle_id]
        keep = [
            k for k in d["notified"]
            if k != f"odometer:{vehicle_id}"
            and not (k.startswith("reminder:") and k[9:] in gone)
        ]
        self._dropped.update(set(d["notified"]) - set(keep))
        d["notified"] = keep
        self._changed()

    # -- entries ---------------------------------------------------------

    async def async_save_entry(self, e: dict) -> dict:
        entry = self._normalize_entry(e, self._vehicle_ids())
        existing = next((x for x in self._data["entries"] if x["id"] == entry["id"]), None)
        if existing and (
            existing.get("vehicle_id") != entry["vehicle_id"]
            or existing.get("kind") != entry["kind"]
        ):
            raise ValueError("entry id belongs to a different vehicle or kind")
        # All-or-nothing: roll back if the reminder reset fails half-way.
        snapshot = (
            copy.deepcopy(self._data["entries"]),
            copy.deepcopy(self._data["reminders"]),
            list(self._data["notified"]),
            set(self._dropped),
        )
        try:
            self._upsert(self._data["entries"], entry)
            self._apply_reminder_resets(entry)
        except Exception:
            (self._data["entries"], self._data["reminders"],
             self._data["notified"], self._dropped) = snapshot
            raise
        self._changed()
        return copy.deepcopy(entry)

    async def async_delete_entry(self, entry_id: str) -> None:
        self._data["entries"] = [
            e for e in self._data["entries"] if e["id"] != entry_id
        ]
        self._changed()

    # -- reminders -------------------------------------------------------

    async def async_save_reminder(self, r: dict) -> dict:
        vehicle_id = r.get("vehicle_id")
        if not isinstance(vehicle_id, str) or vehicle_id not in self._vehicle_ids():
            raise ValueError("unknown vehicle_id")
        clean = _clean_reminder(r)
        text, extra = clean["text"], clean["extra_text"]
        baseline_date = clean["baseline_date"]
        baseline_odo = clean["baseline_odometer"]
        interval_km, interval_months = clean["interval_km"], clean["interval_months"]
        if r.get("id") is not None and not isinstance(r["id"], str):
            raise ValueError("id must be text")
        existing = next(
            (x for x in self._data["reminders"] if x["id"] == r.get("id")), None
        )
        if existing and existing.get("vehicle_id") != vehicle_id:
            raise ValueError("reminder id belongs to another vehicle")
        if existing and not baseline_date:
            # Editing: keep the stored baseline unless the payload provides one.
            baseline_date = existing["baseline_date"]
            if baseline_odo is None:
                baseline_odo = existing["baseline_odometer"]
        elif not baseline_date:
            baseline_date = dt_util.now().date().isoformat()
            if baseline_odo is None:
                last = last_reading(self._entry_for_vehicle(r["vehicle_id"]))
                baseline_odo = last[1] if last else None
        reminder = {
            "id": r.get("id") or _new_id(),
            "vehicle_id": r["vehicle_id"],
            "service_type": r["service_type"],
            "text": text,
            "extra_text": extra,
            "interval_km": interval_km,
            "interval_months": interval_months,
            "baseline_odometer": baseline_odo,
            "baseline_date": baseline_date,
        }
        self._upsert(self._data["reminders"], reminder)
        self._changed()
        return copy.deepcopy(reminder)

    async def async_delete_reminder(self, reminder_id: str) -> None:
        self._data["reminders"] = [
            r for r in self._data["reminders"] if r["id"] != reminder_id
        ]
        self._drop_notified(f"reminder:{reminder_id}")
        self._changed()

    async def async_reset_reminder(
        self, reminder_id: str, date: str, odometer: int | None
    ) -> None:
        date = _check_date("date", date)
        if date is None:
            raise ValueError("date is required")
        odometer = _check_odometer("odometer", odometer)
        for r in self._data["reminders"]:
            if r["id"] == reminder_id:
                r["baseline_date"] = date
                r["baseline_odometer"] = odometer
                self._drop_notified(f"reminder:{reminder_id}")
                self._changed()
                return
        raise ValueError("unknown reminder id")

    # -- settings / notified ---------------------------------------------

    async def async_save_settings(self, partial: dict) -> None:
        unknown = set(partial) - set(DEFAULT_SETTINGS)
        if unknown:
            raise ValueError(f"unknown settings: {sorted(unknown)}")
        self._data["settings"].update(_check_settings(partial))
        self._changed()

    async def async_mark_notified(self, keys: set[str]) -> None:
        for key in sorted(keys):
            if key not in self._data["notified"]:
                self._data["notified"].append(key)
        self._changed()

    async def async_set_notified(self, keys: set[str]) -> None:
        """Replace the notified set (drops keys that are no longer due)."""
        self._data["notified"] = sorted(keys)
        self._changed()

    # -- import ----------------------------------------------------------

    async def async_import(self, parsed: list[ParsedVehicle]) -> dict:
        """Merge parsed vehicles; all-or-nothing if any entry is invalid."""
        work = copy.deepcopy(self._data)
        by_name = {v["name"].casefold(): v for v in work["vehicles"]}
        counts = {"vehicles_added": 0, "entries_added": 0, "entries_skipped": 0}
        # Count pre-existing entries only, so identical rows inside one file are
        # all imported the first time but none is duplicated on re-import.
        seen = Counter(
            (e["vehicle_id"], e.get("date"), e.get("name"), e.get("odometer"))
            for e in work["entries"]
        )
        vehicle_ids = {v["id"] for v in work["vehicles"]}
        for pv in parsed:
            vehicle = by_name.get(pv["name"].casefold())
            if vehicle is None:
                _check_len("name", pv["name"], NAME_MAX)
                vehicle = {
                    "id": _new_id(), "name": pv["name"],
                    "purchase_date": pv["purchase_date"], "icon": None,
                }
                work["vehicles"].append(vehicle)
                by_name[pv["name"].casefold()] = vehicle
                vehicle_ids.add(vehicle["id"])
                counts["vehicles_added"] += 1
            elif not vehicle["purchase_date"]:
                vehicle["purchase_date"] = _check_date("purchase_date", pv["purchase_date"])
            for raw in pv["entries"]:
                key = (vehicle["id"], raw["date"], raw["name"], raw["odometer"])
                if seen[key] > 0:
                    seen[key] -= 1
                    counts["entries_skipped"] += 1
                    continue
                entry = self._normalize_entry(
                    {**raw, "id": None, "vehicle_id": vehicle["id"]}, vehicle_ids
                )
                work["entries"].append(entry)
                counts["entries_added"] += 1
        self._data = work
        self._changed()
        return counts
