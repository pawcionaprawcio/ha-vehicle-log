import { LitElement, html, css, nothing, haStyles, fmtDate, fmtKm, errorText, plural } from "./ui.js";

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export class VlGarage extends LitElement {
  static properties = {
    hass: { attribute: false },
    wide: { type: Boolean, reflect: true },
    view: { attribute: false },
    _error: { state: true },
    _msg: { state: true },
    _busy: { state: true },
  };
  static styles = [
    haStyles,
    css`
      :host { display: block; color: var(--primary-text-color); }
      .col { display: flex; flex-direction: column; gap: 12px; }
      :host([wide]) .col { max-width: 640px; margin: 0 auto; }
      .card-h { padding-bottom: 4px; }
      .sub { color: var(--secondary-text-color, #727272); }
      .sub.err { color: var(--error-color, #db4437); }
      .li .chev { color: var(--secondary-text-color, #727272); flex: none; }
      .li.add { color: var(--primary-color, #03a9f4); font-weight: 500; }
      .li.add ha-icon { flex: none; }
      label.li { cursor: pointer; }
      label.li.days { cursor: default; }
      .days input.num {
        font: inherit; font-size: 16px; width: 72px; min-height: 48px; box-sizing: border-box; padding: 8px 12px;
        text-align: center; color: var(--primary-text-color); background: transparent;
        border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3)); border-radius: 8px;
      }
      .imp { padding: 8px 16px 12px; }
      .imp .t2 { font-size: 13px; color: var(--secondary-text-color, #727272); }
      .imp .act { display: flex; justify-content: flex-end; margin-top: 4px; }
      .imp .btn { height: 48px; }
      .imp .error, .imp .ok { margin-top: 8px; }
      .ok { font-size: 14px; }
      input[type="file"] { display: none; }
    `,
  ];

  constructor() {
    super();
    this._error = "";
    this._msg = "";
    this._busy = false;
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  async _run(msg) {
    this._busy = true;
    this._error = "";
    try {
      const res = await this.hass.callWS(msg);
      this._emit("saved", res.view || res);
      return res;
    } catch (err) {
      this._error = errorText(err);
      return null;
    } finally {
      this._busy = false;
    }
  }

  _setting(patch) {
    this._msg = "";
    return this._run({ type: "vehicle_log/settings/save", settings: patch });
  }

  _saveDays(e) {
    const text = e.target.value.trim();
    const n = Number(text);
    if (!/^\d+$/.test(text) || n < 1 || n > 3650) {
      this._error = "Liczba dni musi być od 1 do 3650.";
      e.target.value = this.view.settings.odometer_reminder_days;
      return;
    }
    if (n !== this.view.settings.odometer_reminder_days) this._setting({ odometer_reminder_days: n });
    else this._error = "";
  }

  async _import(e) {
    const input = e.target;
    const file = input.files?.[0];
    input.value = "";
    this._msg = "";
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      this._error = "Plik jest za duży (limit 2 MB).";
      return;
    }
    let content_b64;
    try {
      content_b64 = toBase64(await file.arrayBuffer());
    } catch (err) {
      this._error = `Nie można odczytać pliku: ${errorText(err)}`;
      return;
    }
    const res = await this._run({ type: "vehicle_log/import_xlsx", content_b64 });
    if (res) {
      const r = res.result;
      const wpis = plural(r.entries_added, "wpis", "wpisy", "wpisów");
      this._msg =
        `Dodano ${r.entries_added} ${wpis}, pominięto ${r.entries_skipped}.` +
        (r.vehicles_added
          ? ` Dodano ${r.vehicles_added} ${plural(r.vehicles_added, "nowy pojazd", "nowe pojazdy", "nowych pojazdów")}.`
          : "");
    }
  }

  render() {
    const vehicles = this.view?.vehicles ?? [];
    const s = this.view?.settings;
    if (!s) return nothing;
    return html`<div class="col">
      <div class="card">
        <div class="card-h">Pojazdy</div>
        ${vehicles.map(
          (v) => html`<button class="li" @click=${() => this._emit("edit-vehicle", v)}>
            <div class="badge b-primary"><ha-icon icon=${v.icon || "mdi:car"}></ha-icon></div>
            <div class="m">
              <div class="t1">${v.name}</div>
              <div class="t2 sub ${v.error ? "err" : ""}">
                ${v.error
                  ? "Błąd danych"
                  : [
                      (v.fuel_types || []).join(" + ") || "Paliwo nie wybrane",
                      v.purchase_date ? `zakup ${fmtDate(v.purchase_date)}` : null,
                      v.odometer !== null && v.odometer !== undefined ? fmtKm(v.odometer) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </div>
            </div>
            <ha-icon class="chev" icon="mdi:chevron-right"></ha-icon>
          </button>`,
        )}
        <button class="li add" @click=${() => this._emit("add-vehicle")}>
          <ha-icon icon="mdi:plus"></ha-icon><span>Dodaj pojazd</span>
        </button>
      </div>
      <div class="card">
        <div class="card-h">Ustawienia</div>
        <label class="li">
          <div class="m">
            <div class="t1">Szacuj przebieg</div>
            <div class="hint">Na podstawie dotychczasowej jazdy</div>
          </div>
          <input type="checkbox" class="switch" .checked=${s.forecast_enabled} ?disabled=${this._busy}
            @change=${(e) => this._setting({ forecast_enabled: e.target.checked })} />
        </label>
        <label class="li">
          <div class="m">
            <div class="t1">Przypominaj o przebiegu</div>
            <div class="hint">Gdy brak odczytu przez podaną liczbę dni</div>
          </div>
          <input type="checkbox" class="switch" .checked=${s.odometer_reminder_enabled} ?disabled=${this._busy}
            @change=${(e) => this._setting({ odometer_reminder_enabled: e.target.checked })} />
        </label>
        ${s.odometer_reminder_enabled
          ? html`<label class="li days">
              <div class="m"><div class="t1">Dni bez odczytu</div></div>
              <input class="num" inputmode="numeric" aria-label="Dni bez odczytu przebiegu"
                .value=${String(s.odometer_reminder_days)} @change=${(e) => this._saveDays(e)} />
            </label>`
          : nothing}
      </div>
      <div class="card">
        <div class="card-h">Import</div>
        <div class="imp">
          <div class="t2">Wczytaj eksport .xlsx z aplikacji Car Notes. Istniejące wpisy nie zostaną zdublowane.</div>
          <div class="act">
            <button class="btn text" ?disabled=${this._busy} @click=${(e) => e.currentTarget.parentElement.nextElementSibling.click()}>
              <ha-icon icon="mdi:upload"></ha-icon>Wybierz plik
            </button>
          </div>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change=${(e) => this._import(e)} />
          ${this._error ? html`<div class="error" role="alert">${this._error}</div>` : nothing}
          ${this._msg ? html`<div class="ok" role="status">${this._msg}</div>` : nothing}
        </div>
      </div>
    </div>`;
  }
}
customElements.define("vl-garage", VlGarage);
