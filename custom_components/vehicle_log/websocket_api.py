"""Websocket API used by the Vehicle Log panel."""

from __future__ import annotations

import base64
import binascii
import math
import re
from collections.abc import Awaitable, Callable
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.util import dt as dt_util

from .calc import build_view
from .const import DOMAIN
from .store import VehicleLogStore
from .xlsx_import import parse_car_notes_xlsx

NUMERIC_FIELDS = (
    "odometer", "parts", "labour", "tax_pct", "discount_pct", "discount_amount",
    "total", "litres", "price_per_litre", "interval_km", "interval_months",
    "baseline_odometer",
)
INT_FIELDS = ("odometer", "interval_km", "interval_months", "baseline_odometer")


def num(value: Any) -> float | None:
    """Parse a finite number; accept ',' or '.' decimals; ''/None -> None."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise vol.Invalid("not a number")
    try:
        if isinstance(value, (int, float)):
            result = float(value)
        elif isinstance(value, str):
            # \s also covers NBSP and thin spaces used as thousands separators.
            text = re.sub(r"\s", "", value).replace(",", ".")
            if not text:
                return None
            result = float(text)
        else:
            raise vol.Invalid("not a number")
    except (ValueError, OverflowError) as err:
        raise vol.Invalid(f"not a number: {value!r}") from err
    if not math.isfinite(result):
        raise vol.Invalid(f"not a finite number: {value!r}")
    return result


def _whole(key: str, value: float) -> int:
    if not value.is_integer():
        raise vol.Invalid(f"{key} must be a whole number")
    return int(value)


def _numbers(payload: dict) -> dict:
    out = dict(payload)
    for key in NUMERIC_FIELDS:
        if key in out:
            value = num(out[key])
            if value is not None and key in INT_FIELDS:
                value = _whole(key, value)
            out[key] = value
    return out


def _entry(value: Any) -> dict:
    if not isinstance(value, dict):
        raise vol.Invalid("expected an object")
    return _numbers(value)


def _reminder(value: Any) -> dict:
    return _entry(value)


def _store(hass: HomeAssistant) -> VehicleLogStore:
    return hass.data[DOMAIN]["store"]


def _view(hass: HomeAssistant) -> dict:
    return build_view(_store(hass).data, dt_util.now().date())


def _mutation(
    command: str,
    schema: dict,
    action: Callable[[VehicleLogStore, dict], Awaitable[None]],
):
    """Build a command that runs `action` and replies with the new view."""

    @websocket_api.websocket_command({vol.Required("type"): command, **schema})
    @websocket_api.async_response
    async def handler(hass: HomeAssistant, connection, msg: dict) -> None:
        try:
            await action(_store(hass), msg)
        except (ValueError, ArithmeticError) as err:
            connection.send_error(msg["id"], "invalid_input", str(err))
            return
        connection.send_result(msg["id"], _view(hass))

    return handler


async def _vehicle_save(store, msg):
    await store.async_save_vehicle(msg["vehicle"])


async def _vehicle_delete(store, msg):
    await store.async_delete_vehicle(msg["vehicle_id"])


async def _entry_save(store, msg):
    await store.async_save_entry(msg["entry"])


async def _entry_delete(store, msg):
    await store.async_delete_entry(msg["entry_id"])


async def _reminder_save(store, msg):
    await store.async_save_reminder(msg["reminder"])


async def _reminder_delete(store, msg):
    await store.async_delete_reminder(msg["reminder_id"])


async def _reminder_reset(store, msg):
    await store.async_reset_reminder(
        msg["reminder_id"], msg["date"], msg.get("odometer")
    )


async def _settings_save(store, msg):
    await store.async_save_settings(msg["settings"])


def _int_or_none(value: Any) -> int | None:
    parsed = num(value)
    return None if parsed is None else _whole("odometer", parsed)


@websocket_api.websocket_command({vol.Required("type"): "vehicle_log/get"})
@websocket_api.async_response
async def ws_get(hass: HomeAssistant, connection, msg: dict) -> None:
    connection.send_result(msg["id"], _view(hass))


@websocket_api.websocket_command({vol.Required("type"): "vehicle_log/subscribe"})
@websocket_api.async_response
async def ws_subscribe(hass: HomeAssistant, connection, msg: dict) -> None:
    msg_id = msg["id"]

    @callback
    def push() -> None:
        connection.send_message(
            websocket_api.event_message(msg_id, {"view": _view(hass)})
        )

    connection.subscriptions[msg_id] = _store(hass).add_listener(push)
    connection.send_result(msg_id)
    push()


@websocket_api.websocket_command(
    {vol.Required("type"): "vehicle_log/import_xlsx", vol.Required("content_b64"): str}
)
@websocket_api.async_response
async def ws_import(hass: HomeAssistant, connection, msg: dict) -> None:
    try:
        content = base64.b64decode(msg["content_b64"], validate=True)
    except (binascii.Error, ValueError) as err:
        connection.send_error(msg["id"], "invalid_input", f"invalid base64: {err}")
        return
    try:
        parsed = await hass.async_add_executor_job(parse_car_notes_xlsx, content)
        result = await _store(hass).async_import(parsed)
    except ValueError as err:  # includes XlsxFormatError
        connection.send_error(msg["id"], "invalid_input", str(err))
        return
    connection.send_result(msg["id"], {"result": result, "view": _view(hass)})


def async_register_websocket_api(hass: HomeAssistant) -> None:
    commands = [
        ws_get,
        ws_subscribe,
        ws_import,
        _mutation("vehicle_log/vehicle/save", {vol.Required("vehicle"): dict}, _vehicle_save),
        _mutation("vehicle_log/vehicle/delete", {vol.Required("vehicle_id"): str}, _vehicle_delete),
        _mutation("vehicle_log/entry/save", {vol.Required("entry"): _entry}, _entry_save),
        _mutation("vehicle_log/entry/delete", {vol.Required("entry_id"): str}, _entry_delete),
        _mutation("vehicle_log/reminder/save", {vol.Required("reminder"): _reminder}, _reminder_save),
        _mutation("vehicle_log/reminder/delete", {vol.Required("reminder_id"): str}, _reminder_delete),
        _mutation(
            "vehicle_log/reminder/reset",
            {
                vol.Required("reminder_id"): str,
                vol.Required("date"): str,
                vol.Optional("odometer"): vol.Any(None, _int_or_none),
            },
            _reminder_reset,
        ),
        _mutation("vehicle_log/settings/save", {vol.Required("settings"): dict}, _settings_save),
    ]
    for command in commands:
        websocket_api.async_register_command(hass, command)
