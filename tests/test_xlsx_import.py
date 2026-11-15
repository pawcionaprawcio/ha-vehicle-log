import io
import zipfile

import pytest

from custom_components.vehicle_log.xlsx_import import (
    XlsxFormatError,
    match_service_type,
    parse_car_notes_xlsx,
)
from tests.xlsx_factory import make_xlsx


def test_parses_two_vehicles():
    data = make_xlsx({"Auto A": {"purchase_date": "14.02.2024", "rows": [
        ["26.10.2026", 1500, "Koła", None, 250, 0, None, 0, 250, "", ""],
        ["8.09.2026", 1200, "Olej z filtrem", None, None, 0, None, 0, None, "", ""],
        ["24.06.2026", 1000, "Aktualizacja przebiegu", None, None, 0, None, 0, None, "", ""]]},
        "Auto B": {"purchase_date": None, "rows": [["6.01.2026", None, "Tarcza hamulcowa", None, None, 0, None, 0, 600, "", ""]]}})
    a, b = parse_car_notes_xlsx(data)
    assert a["name"] == "Auto A" and a["purchase_date"] == "2024-02-14"
    assert [e["service_type"] for e in a["entries"]] == ["wheels", "oil_filter", "odometer_update"]
    assert a["entries"][2]["kind"] == "odometer" and a["entries"][0]["total"] == 250 and a["entries"][0]["date"] == "2026-10-26"
    assert b["purchase_date"] is None and b["entries"][0]["odometer"] is None
    assert b["entries"][0]["service_type"] == "other" and b["entries"][0]["name"] == "Tarcza hamulcowa"


def test_entry_shape_and_columns():
    data = make_xlsx({"A": {"purchase_date": None, "rows": [
        ["1.02.2026", 1500, "Koła", 50, 60, 5, 2, 23, 120.5, "XY-1", "uwaga"]]}})
    (v,) = parse_car_notes_xlsx(data)
    assert v["entries"][0] == {
        "kind": "service", "service_type": "wheels", "name": "Koła",
        "date": "2026-02-01", "time": None, "odometer": 1500,
        "parts": 50, "labour": 60, "tax_pct": 23, "discount_pct": 5,
        "discount_amount": 2, "total": 120.5, "part_numbers": "XY-1",
        "comment": "uwaga", "accessory": False, "fuel_type": None,
        "litres": None, "price_per_litre": None, "full_tank": False,
    }


def test_inline_strings_supported():
    zin = zipfile.ZipFile(io.BytesIO(make_xlsx({"A": {"purchase_date": None, "rows": []}})))
    sheet = (
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Naprawy</t></is></c></row>'
        '<row r="2"><c r="A2" t="inlineStr"><is><t>Data</t></is></c>'
        '<c r="B2" t="inlineStr"><is><t>Naprawy</t></is></c>'
        '<c r="C2" t="inlineStr"><is><t>Razem, zł</t></is></c>'
        '<c r="D2" t="inlineStr"><is><t>Przebieg, km</t></is></c></row>'
        '<row r="3"><c r="A3" t="inlineStr"><is><t>1.02.2026</t></is></c>'
        '<c r="B3" t="inlineStr"><is><t>Koła</t></is></c><c r="C3"><v>7</v></c>'
        '<c r="D3"><v>900</v></c></row>'
        "</sheetData></worksheet>"
    )
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for n in zin.namelist():
            z.writestr(n, sheet if n == "xl/worksheets/sheet1.xml" else zin.read(n))
    (v,) = parse_car_notes_xlsx(out.getvalue())
    assert v["entries"][0]["service_type"] == "wheels"
    assert v["entries"][0]["total"] == 7 and v["entries"][0]["date"] == "2026-02-01"


def test_rejects_non_xlsx():
    with pytest.raises(XlsxFormatError):
        parse_car_notes_xlsx(b"not a zip")


def test_rejects_sheet_without_naprawy_and_empty_workbook():
    data = make_xlsx({"A": {"purchase_date": None, "rows": []}})
    zin = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for n in zin.namelist():
            c = zin.read(n)
            if n.startswith("xl/worksheets"):
                c = c.replace("Naprawy".encode(), b"Inne")
            z.writestr(n, c)
    # shared string "Naprawy" is in sharedStrings, not sheet; patch that
    out2 = io.BytesIO()
    zin2 = zipfile.ZipFile(io.BytesIO(out.getvalue()))
    with zipfile.ZipFile(out2, "w") as z:
        for n in zin2.namelist():
            c = zin2.read(n)
            if n == "xl/sharedStrings.xml":
                c = c.replace(b"<t>Naprawy</t>", b"<t>Inne</t>")
            z.writestr(n, c)
    with pytest.raises(XlsxFormatError):
        parse_car_notes_xlsx(out2.getvalue())
    with pytest.raises(XlsxFormatError):
        parse_car_notes_xlsx(make_xlsx({}))


def test_match_service_type():
    assert match_service_type("koła") == "wheels"
    assert match_service_type("Nieznane") == "other"


@pytest.mark.parametrize("bad", ["31.02.2026", "abc", 46000])
def test_rejects_unparsable_date_with_sheet_and_row(bad):
    data = make_xlsx({"Auto X": {"purchase_date": None, "rows": [
        ["1.02.2026", 10, "Koła", None, None, 0, None, 0, 5, "", ""],
        [bad, 10, "Koła", None, None, 0, None, 0, 5, "", ""]]}})
    with pytest.raises(XlsxFormatError, match=r"Auto X.*wiersz 7"):
        parse_car_notes_xlsx(data)


def _with_header(data: bytes, replacements: dict[bytes, bytes]) -> bytes:
    zin = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for n in zin.namelist():
            c = zin.read(n)
            if n == "xl/sharedStrings.xml":
                for old, new in replacements.items():
                    c = c.replace(old, new)
            z.writestr(n, c)
    return out.getvalue()


ROW = ["3.04.2024", 61200, "Koła", 120, 80, 10, 5, 23, 210.5, "AB-9", "ok"]


def test_real_header_spellings_populate_odometer_and_costs():
    (v,) = parse_car_notes_xlsx(make_xlsx({"A": {"purchase_date": None, "rows": [ROW]}}))
    e = v["entries"][0]
    assert e["odometer"] == 61200 and e["total"] == 210.5
    assert (e["parts"], e["labour"], e["discount_pct"]) == (120, 80, 10)
    assert (e["discount_amount"], e["tax_pct"]) == (5, 23)


def test_old_header_spellings_still_accepted():
    data = _with_header(make_xlsx({"A": {"purchase_date": None, "rows": [ROW]}}), {
        "Przebieg, km".encode(): "Przebieg km".encode(),
        "Rabat w procentach, %".encode(): "Rabat %".encode(),
        "Razem, zł".encode(): "Razem zł".encode(),
    })
    (v,) = parse_car_notes_xlsx(data)
    e = v["entries"][0]
    assert e["odometer"] == 61200 and e["discount_pct"] == 10 and e["total"] == 210.5


@pytest.mark.parametrize("column", ["Przebieg, km", "Data"])
def test_missing_required_column_is_polish_error(column):
    data = _with_header(make_xlsx({"A": {"purchase_date": None, "rows": [ROW]}}),
                        {column.encode(): b"Cos innego"})
    with pytest.raises(XlsxFormatError, match="Arkusz"):
        parse_car_notes_xlsx(data)


def test_blank_rows_inside_table_are_skipped():
    data = make_xlsx({"A": {"purchase_date": None, "rows": [
        ROW, [], ["4.05.2024", 61900, "Koła", None, None, None, None, None, 9, "", ""]]}})
    (v,) = parse_car_notes_xlsx(data)
    assert [e["odometer"] for e in v["entries"]] == [61200, 61900]
