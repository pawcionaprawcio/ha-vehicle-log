"""Build minimal Car Notes style .xlsx workbooks for tests."""
from __future__ import annotations

import io
import zipfile
from xml.sax.saxutils import escape

HEADER = [
    "Data", "Przebieg, km", "Naprawy", "Części, zł", "Robocizna, zł",
    "Rabat w procentach, %", "Kwota rabatu, zł", "Podatek, %", "Razem, zł",
    "Numery części", "Komentarz",
]
COLS = "ABCDEFGHIJKLMNOP"


def make_xlsx(sheets: dict[str, dict]) -> bytes:
    """sheets: name -> {"purchase_date": str|None, "rows": [[...11 cells...]]}."""
    strings: list[str] = [""]

    def sidx(s: str) -> int:
        if s not in strings:
            strings.append(s)
        return strings.index(s)

    def cell(ref: str, v) -> str:
        if v is None:
            return f'<c r="{ref}"/>'
        if isinstance(v, str):
            return f'<c r="{ref}" t="s"><v>{sidx(v)}</v></c>'
        return f'<c r="{ref}" t="n"><v>{float(v)}</v></c>'

    def row(n: int, vals: list) -> str:
        return f'<row r="{n}">' + "".join(
            cell(f"{COLS[i]}{n}", v) for i, v in enumerate(vals)
        ) + "</row>"

    sheet_xml = []
    for spec in sheets.values():
        rows = [
            ["Rodzaj pojazdu", "Samochód"],
            ["Jednostka odległości", "km"],
        ]
        if spec.get("purchase_date"):
            rows.append(["Data zakupu pojazdu", spec["purchase_date"]])
        rows.append([])
        rows.append(["Naprawy"])
        rows.append(HEADER)
        rows.extend(spec["rows"])
        body = "".join(row(i + 1, r) for i, r in enumerate(rows))
        sheet_xml.append(
            '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns='
            '"http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f"<sheetData>{body}</sheetData></worksheet>"
        )

    names = list(sheets)
    wb = (
        '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns='
        '"http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r='
        '"http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        + "".join(
            f'<sheet name="{escape(n)}" sheetId="{i + 1}" r:id="rId{i + 1}"/>'
            for i, n in enumerate(names)
        )
        + "</sheets></workbook>"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns='
        '"http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(
            f'<Relationship Id="rId{i + 1}" Type="x" Target="worksheets/sheet{i + 1}.xml"/>'
            for i in range(len(names))
        )
        + "</Relationships>"
    )
    sst = (
        '<?xml version="1.0" encoding="UTF-8"?><sst xmlns='
        '"http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + "".join(f"<si><t>{escape(s)}</t></si>" for s in strings)
        + "</sst>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml", wb)
        z.writestr("xl/_rels/workbook.xml.rels", rels)
        z.writestr("xl/sharedStrings.xml", sst)
        for i, x in enumerate(sheet_xml):
            z.writestr(f"xl/worksheets/sheet{i + 1}.xml", x)
    return buf.getvalue()
