import { LitElement, html, css, nothing, fmtDate, fmtKm, errorText, plural } from "./ui.js";

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
    view: { attribute: false },
    _error: { state: true },
    _msg: { state: true },
    _busy: { state: true },
  };
  static styles = css`
    :host { display: block; color: var(--primary-text-color); padding-bottom: 24px; }
    * { box-sizing: border-box; }
    h3 { margin: 16px 16px 4px; font-size: 13px; font-weight: 500; color: var(--secondary-text-color); }
    button, label.check { font: inherit; color: inherit; }
    .row {
      display: flex; align-items: center; gap: 16px; width: 100%; min-height: 56px; padding: 6px 16px;
      background: var(--card-background-color, #fff); border: none; border-bottom: 1px solid var(--divider-color);
      text-align: left; cursor: pointer;
    }
    .row ha-icon { color: var(--secondary-text-color); flex: none; }
    .main { flex: 1; min-width: 0; }
    .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub { font-size: 12px; color: var(--secondary-text-color); }
    .empty { padding: 24px 16px; text-align: center; color: var(--secondary-text-color); }
    .btn {
      min-height: 48px; padding: 0 16px; margin: 12px 16px 0; border-radius: 8px; cursor: pointer;
      border: 1px solid var(--divider-color); background: transparent;
    }
    .btn.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: transparent; }
    .btn:disabled { opacity: 0.5; }
    .check { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 0 16px; font-size: 16px; }
    input[type="checkbox"] { width: 24px; height: 24px; accent-color: var(--primary-color); }
    .days { display: flex; align-items: center; gap: 12px; padding: 0 16px; min-height: 48px; }
    .days input {
      font: inherit; font-size: 16px; width: 96px; min-height: 48px; padding: 8px 12px; color: var(--primary-text-color);
      background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-radius: 8px;
    }
    input[type="file"] { display: none; }
    .error { color: var(--error-color, #db4437); padding: 8px 16px 0; font-size: 14px; word-break: break-word; }
    .ok { padding: 8px 16px 0; font-size: 14px; }
  `;

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
    return html`<h3>Pojazdy</h3>
      ${vehicles.length
        ? vehicles.map(
            (v) => html`<button class="row" @click=${() => this._emit("edit-vehicle", v)}>
              <ha-icon icon=${v.icon || "mdi:car"}></ha-icon>
              <div class="main">
                <div class="name">${v.name}</div>
                <div class="sub">
                  ${[
                    (v.fuel_types || []).join(" + ") || "paliwo: nie wybrano",
                    v.purchase_date ? `zakup ${fmtDate(v.purchase_date)}` : null,
                    v.odometer !== null ? fmtKm(v.odometer) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "brak danych"}
                </div>
              </div>
            </button>`,
          )
        : html`<div class="empty">Brak pojazdów.</div>`}
      <button class="btn primary" @click=${() => this._emit("add-vehicle")}>Dodaj pojazd</button>
      <h3>Ustawienia</h3>
      <label class="check"
        ><input type="checkbox" .checked=${s.forecast_enabled} ?disabled=${this._busy}
          @change=${(e) => this._setting({ forecast_enabled: e.target.checked })} />
        Szacuj przebieg na podstawie dotychczasowej jazdy</label
      >
      <label class="check"
        ><input type="checkbox" .checked=${s.odometer_reminder_enabled} ?disabled=${this._busy}
          @change=${(e) => this._setting({ odometer_reminder_enabled: e.target.checked })} />
        Przypominaj o aktualizacji przebiegu</label
      >
      ${s.odometer_reminder_enabled
        ? html`<label class="days"
            >po
            <input inputmode="numeric" aria-label="Dni bez odczytu przebiegu" .value=${String(s.odometer_reminder_days)}
              @change=${(e) => this._saveDays(e)} />
            dniach bez odczytu</label
          >`
        : nothing}
      <h3>Import</h3>
      <button class="btn" ?disabled=${this._busy} @click=${(e) => e.target.nextElementSibling.click()}>
        Import z Car Notes (.xlsx)
      </button>
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change=${(e) => this._import(e)} />
      ${this._error ? html`<div class="error" role="alert">${this._error}</div>` : nothing}
      ${this._msg ? html`<div class="ok" role="status">${this._msg}</div>` : nothing}`;
  }
}
customElements.define("vl-garage", VlGarage);
