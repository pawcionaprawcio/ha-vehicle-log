import { LitElement, html, css, nothing, haStyles, fmtDate, fmtKm, errorText } from "./ui.js";
import { t, fuelLabel } from "./i18n.js";

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
    lang: { attribute: false },
    _settingsError: { state: true },
    _importError: { state: true },
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
      .se { padding: 8px 16px 12px; }
      .ok { font-size: 14px; }
      input[type="file"] { display: none; }
    `,
  ];

  constructor() {
    super();
    this._settingsError = "";
    this._importError = "";
    this._msg = "";
    this._busy = false;
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  async _run(msg, errKey) {
    this._busy = true;
    this[errKey] = "";
    try {
      const res = await this.hass.callWS(msg);
      this._emit("saved", res.view || res);
      return res;
    } catch (err) {
      this[errKey] = errorText(err);
      return null;
    } finally {
      this._busy = false;
    }
  }

  _setting(patch) {
    this._msg = "";
    return this._run({ type: "vehicle_log/settings/save", settings: patch }, "_settingsError");
  }

  _saveDays(e) {
    const text = e.target.value.trim();
    const n = Number(text);
    if (!/^\d+$/.test(text) || n < 1 || n > 3650) {
      this._settingsError = t("days_range");
      e.target.value = this.view.settings.odometer_reminder_days;
      return;
    }
    if (n !== this.view.settings.odometer_reminder_days) this._setting({ odometer_reminder_days: n });
    else this._settingsError = "";
  }

  async _import(e) {
    const input = e.target;
    const file = input.files?.[0];
    input.value = "";
    this._msg = "";
    this._importError = "";
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      this._importError = t("file_too_big");
      return;
    }
    let content_b64;
    try {
      content_b64 = toBase64(await file.arrayBuffer());
    } catch (err) {
      this._importError = t("file_read_error", { error: errorText(err) });
      return;
    }
    const res = await this._run({ type: "vehicle_log/import_xlsx", content_b64 }, "_importError");
    if (res) {
      const r = res.result;
      this._msg =
        t("import_done", { added: r.entries_added, skipped: r.entries_skipped }) +
        (r.vehicles_added ? t("import_vehicles", { n: r.vehicles_added }) : "");
    }
  }

  render() {
    const vehicles = this.view?.vehicles ?? [];
    const s = this.view?.settings;
    if (!s) return nothing;
    return html`<div class="col">
      <div class="card">
        <div class="card-h">${t("vehicles")}</div>
        ${vehicles.length ? nothing : html`<div class="empty">${t("no_vehicles")}</div>`}
        ${vehicles.map(
          (v) => html`<button class="li" @click=${() => this._emit("edit-vehicle", v)}>
            <div class="badge b-primary"><ha-icon icon=${v.icon || "mdi:car"}></ha-icon></div>
            <div class="m">
              <div class="t1">${v.name}</div>
              <div class="t2 sub ${v.error ? "err" : ""}">
                ${v.error
                  ? t("data_error")
                  : [
                      (v.fuel_types || []).map(fuelLabel).join(" + ") || t("no_fuel"),
                      v.purchase_date ? t("bought", { date: fmtDate(v.purchase_date) }) : null,
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
          <ha-icon icon="mdi:plus"></ha-icon><span>${t("add_vehicle")}</span>
        </button>
      </div>
      <div class="card">
        <div class="card-h">${t("settings")}</div>
        <label class="li">
          <div class="m">
            <div class="t1">${t("forecast_setting")}</div>
            <div class="hint">${t("forecast_hint")}</div>
          </div>
          <input type="checkbox" class="switch" role="switch" .checked=${s.forecast_enabled} ?disabled=${this._busy}
            @change=${(e) => this._setting({ forecast_enabled: e.target.checked })} />
        </label>
        <label class="li">
          <div class="m">
            <div class="t1">${t("odo_reminder_setting")}</div>
            <div class="hint">${t("odo_reminder_hint")}</div>
          </div>
          <input type="checkbox" class="switch" role="switch" .checked=${s.odometer_reminder_enabled} ?disabled=${this._busy}
            @change=${(e) => this._setting({ odometer_reminder_enabled: e.target.checked })} />
        </label>
        ${s.odometer_reminder_enabled
          ? html`<label class="li days">
              <div class="m"><div class="t1">${t("days_without")}</div></div>
              <input class="num" inputmode="numeric" aria-label=${t("days_without_aria")}
                .value=${String(s.odometer_reminder_days)} @change=${(e) => this._saveDays(e)} />
            </label>`
          : nothing}
        ${this._settingsError ? html`<div class="error se" role="alert">${this._settingsError}</div>` : nothing}
      </div>
      <div class="card">
        <div class="card-h">${t("import")}</div>
        <div class="imp">
          <div class="t2">${t("import_hint")}</div>
          <div class="act">
            <button class="btn text" ?disabled=${this._busy} @click=${(e) => this.renderRoot.querySelector('input[type=file]').click()}>
              <ha-icon icon="mdi:upload"></ha-icon>${t("choose_file")}
            </button>
          </div>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change=${(e) => this._import(e)} />
          ${this._importError ? html`<div class="error" role="alert">${this._importError}</div>` : nothing}
          ${this._msg ? html`<div class="ok" role="status">${this._msg}</div>` : nothing}
        </div>
      </div>
    </div>`;
  }
}
customElements.define("vl-garage", VlGarage);
