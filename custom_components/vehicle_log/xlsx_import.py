"""Parser for the Car Notes (Android app) Excel export. Pure Python, stdlib only."""
from __future__ import annotations

import io
import posixpath
import re
import zipfile
from datetime import date
from typing import Any, TypedDict
from xml.etree import ElementTree as ET

from .const import SERVICE_TYPES

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"

_ROW_KEY = -1
_ODOMETER_NAME = "Aktualizacja przebiegu"
# Keys are normalised header texts (see _norm_header): the real export writes
# "Części, zł" and "Rabat w procentach, %", older spellings have no commas.
_NUMERIC = {
    "części zł": "parts",
    "robocizna zł": "labour",
    "rabat w procentach %": "discount_pct",
    "rabat %": "discount_pct",
    "kwota rabatu zł": "discount_amount",
    "podatek %": "tax_pct",
    "razem zł": "total",
}
_TEXT = {"numery części": "part_numbers", "komentarz": "comment"}
_REQUIRED = {"data": "Data", "naprawy": "Naprawy", "przebieg km": "Przebieg, km"}


class XlsxFormatError(ValueError):
    """The file is not a readable Car Notes Excel export."""


class ParsedVehicle(TypedDict):
    name: str
    purchase_date: str | None
    entries: list[dict[str, Any]]


def match_service_type(name: str) -> str:
    """Case-insensitive exact match on catalog labels, else "other"."""
    key = name.strip().casefold()
    for type_id, meta in SERVICE_TYPES.items():
        if meta["label"].casefold() == key:
            return type_id
    return "other"


def _parse_date(text: str) -> str | None:
    m = re.fullmatch(r"\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*", text or "")
    if not m:
        return None
    try:
        return date(int(m[3]), int(m[2]), int(m[1])).isoformat()
    except ValueError:
        return None


def _col_index(ref: str) -> int:
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group():
        n = n * 26 + ord(ch) - 64
    return n - 1


def _number(text: str | None) -> int | float | None:
    if text is None or text == "":
        return None
    f = float(text)
    return int(f) if f.is_integer() else f


def _shared_strings(zf: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    return ["".join(t.text or "" for t in si.iter(f"{NS}t")) for si in root.iter(f"{NS}si")]


def _sheet_rows(xml: bytes, strings: list[str]) -> list[dict[int, Any]]:
    """Rows as {column index: str | float}, plus _ROW_KEY -> 1-based row number."""
    rows: list[dict[int, Any]] = []
    for pos, row in enumerate(ET.fromstring(xml).iter(f"{NS}row"), start=1):
        cells: dict[int, Any] = {_ROW_KEY: int(row.get("r") or pos)}
        for c in row.findall(f"{NS}c"):
            t = c.get("t")
            if t == "inlineStr":
                val: Any = "".join(x.text or "" for x in c.iter(f"{NS}t"))
            else:
                v = c.find(f"{NS}v")
                if v is None or v.text is None:
                    continue
                if t == "s":
                    val = strings[int(v.text)]
                elif t in ("str", "b", "e"):
                    val = v.text
                else:
                    val = float(v.text)
            cells[_col_index(c.get("r"))] = val
        rows.append(cells)
    return rows


def _norm_header(v: Any) -> str:
    """Casefold, drop commas and collapse whitespace so spellings compare equal."""
    return re.sub(r"\s+", " ", _text(v).replace(",", " ")).strip().casefold()


def _text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else str(v)
    return str(v)


def _parse_sheet(name: str, rows: list[dict[int, Any]]) -> ParsedVehicle:
    purchase_date = None
    start = None
    for i, r in enumerate(rows):
        a = _text(r.get(0))
        if a == "Naprawy":
            start = i
            break
        if a == "Data zakupu pojazdu":
            purchase_date = _parse_date(_text(r.get(1)))
    if start is None:
        raise XlsxFormatError(f"Arkusz '{name}' nie ma sekcji 'Naprawy'")
    header_i = next(
        (i for i in range(start + 1, len(rows)) if _norm_header(rows[i].get(0)) == "data"),
        None,
    )
    if header_i is None:
        raise XlsxFormatError(
            f"Arkusz '{name}' nie ma wiersza nagłówka po sekcji 'Naprawy'"
        )
    cols = {
        _norm_header(v): idx for idx, v in rows[header_i].items() if idx != _ROW_KEY
    }
    for key, label in _REQUIRED.items():
        if key not in cols:
            raise XlsxFormatError(f"Arkusz '{name}': brak kolumny '{label}'")

    entries: list[dict[str, Any]] = []
    for r in rows[header_i + 1:]:
        if _text(r.get(0)) == "":
            continue  # blank row inside or after the table
        iso = _parse_date(r.get(0)) if isinstance(r.get(0), str) else None
        if iso is None:
            raise XlsxFormatError(
                f"Arkusz '{name}', wiersz {r[_ROW_KEY]}: nieprawidłowa data '{_text(r.get(0))}'"
            )

        def get(header: str) -> Any:
            return r.get(cols[header]) if header in cols else None

        title = _text(get("naprawy")).strip()
        is_odo = title == _ODOMETER_NAME
        odo = _number(None if get("przebieg km") is None else str(get("przebieg km")))
        entry: dict[str, Any] = {
            "kind": "odometer" if is_odo else "service",
            "service_type": "odometer_update" if is_odo else match_service_type(title),
            "name": title,
            "date": iso,
            "time": None,
            "odometer": None if odo is None else int(odo),
        }
        for key in _NUMERIC.values():  # aliases: the first present header wins
            entry[key] = None
        for header, key in _NUMERIC.items():
            v = get(header)
            if v is not None:
                entry[key] = _number(str(v))
        for header, key in _TEXT.items():
            entry[key] = _text(get(header))
        entry.update(
            accessory=False, fuel_type=None, litres=None,
            price_per_litre=None, full_tank=False,
        )
        entries.append(entry)
    return {"name": name, "purchase_date": purchase_date, "entries": entries}


def parse_car_notes_xlsx(content: bytes) -> list[ParsedVehicle]:
    """Parse a Car Notes export; one ParsedVehicle per sheet."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
        wb = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = {
            r.get("Id"): r.get("Target")
            for r in ET.fromstring(zf.read("xl/_rels/workbook.xml.rels")).iter(f"{REL_NS}Relationship")
        }
        strings = _shared_strings(zf)
        vehicles: list[ParsedVehicle] = []
        for sheet in wb.iter(f"{NS}sheet"):
            target = rels[sheet.get(f"{RNS}id")]
            path = target.lstrip("/") if target.startswith("/") else posixpath.join("xl", target)
            vehicles.append(
                _parse_sheet(sheet.get("name"), _sheet_rows(zf.read(path), strings))
            )
    except XlsxFormatError:
        raise
    except (zipfile.BadZipFile, KeyError, ET.ParseError, ValueError, IndexError, TypeError) as err:
        raise XlsxFormatError(f"To nie jest poprawny eksport Car Notes: {err}") from err
    if not vehicles:
        raise XlsxFormatError("Skoroszyt nie zawiera arkuszy z pojazdami")
    return vehicles
