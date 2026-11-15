import { LitElement, html, css, nothing, storage, errorText } from "./ui.js";
import "./view-entries.js";
import "./form-entry.js";
import "./form-refuel.js";
import "./form-odometer.js";
import "./form-reminder.js";
import "./form-vehicle.js";
import "./view-reminders.js";
import "./view-garage.js";

const KEY_VEHICLE = "vehicle_log.vehicle";
const KEY_TAB = "vehicle_log.tab";
const TABS = [
  ["entries", "Wpisy", "mdi:format-list-bulleted"],
  ["reminders", "Przypomnienia", "mdi:bell-outline"],
  ["garage", "Garaż", "mdi:car-multiple"],
];
const MAX_BACKOFF_MS = 30000;

class VehicleLogPanel extends LitElement {
  static properties = {
    // Re-render only when the connection changes, not on every state update.
    hass: { attribute: false, hasChanged: (value, old) => value?.connection !== old?.connection },
    narrow: { type: Boolean, reflect: true },
    panel: { attribute: false },
    _view: { state: true },
    _vehicleId: { state: true },
    _tab: { state: true },
    _sheet: { state: true },
    _connError: { state: true },
  };

  static styles = css`
    :host {
      display: flex; flex-direction: column; height: 100vh; height: 100dvh; position: relative;
      background: var(--primary-background-color); color: var(--primary-text-color);
      font-family: var(--paper-font-body1_-_font-family, inherit);
    }
    * { box-sizing: border-box; }
    .bar {
      display: flex; align-items: center; gap: 4px; height: 56px; padding: 0 12px; flex: none;
      background: var(--app-header-background-color, var(--primary-color));
      color: var(--app-header-text-color, var(--text-primary-color, #fff));
    }
    .bar h1 { margin: 0; font-size: 20px; font-weight: 400; }
    button { font: inherit; color: inherit; cursor: pointer; }
    .icon-btn { background: none; border: none; width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
    .chips { display: flex; gap: 8px; padding: 8px 12px; overflow-x: auto; flex: none; }
    .chip {
      flex: none; min-height: 48px; padding: 0 20px; border-radius: 24px; white-space: nowrap;
      background: var(--card-background-color, #fff); border: 1px solid var(--divider-color);
    }
    .chip[aria-pressed="true"] { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: transparent; }
    main { flex: 1; min-height: 0; overflow-y: auto; }
    nav {
      display: flex; flex: none; border-top: 1px solid var(--divider-color);
      background: var(--card-background-color, #fff); padding-bottom: env(safe-area-inset-bottom);
    }
    nav button {
      flex: 1; min-height: 56px; background: none; border: none; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 2px; font-size: 12px; color: var(--secondary-text-color);
    }
    nav button[aria-current="page"] { color: var(--primary-color); }
    .fab {
      position: absolute; right: 16px; bottom: 80px; width: 56px; height: 56px; border-radius: 50%; border: none;
      background: var(--primary-color); color: var(--text-primary-color, #fff); font-size: 28px;
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3); z-index: 5;
    }
    .center { padding: 32px 16px; text-align: center; color: var(--secondary-text-color); }
    .add { margin-top: 16px; min-height: 48px; padding: 0 24px; border: none; border-radius: 24px; background: var(--primary-color); color: var(--text-primary-color, #fff); }
    .error { color: var(--error-color, #db4437); }
    .overlay { position: fixed; inset: 0; z-index: 30; background: rgba(0, 0, 0, 0.45); display: flex; align-items: flex-end; justify-content: center; }
    .menu {
      width: 100%; max-width: 520px; background: var(--card-background-color, #fff); border-radius: 12px 12px 0 0;
      padding: 8px 0 16px;
    }
    .menu button {
      display: flex; align-items: center; gap: 16px; width: 100%; min-height: 56px; padding: 0 20px; font-size: 16px;
      background: none; border: none; text-align: left;
    }
    .menu ha-icon { color: var(--secondary-text-color); }
  `;

  constructor() {
    super();
    this._view = null;
    this._sheet = null;
    this._connError = "";
    this._vehicleId = storage.get(KEY_VEHICLE);
    this._tab = TABS.some((t) => t[0] === storage.get(KEY_TAB)) ? storage.get(KEY_TAB) : "entries";
    this._token = 0;
    this._retries = 0;
    this._conn = null;
    this._unsub = null;
    this._timer = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._connect();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._teardown();
  }

  updated(changed) {
    // A new hass.connection (HA reconnected) needs a fresh subscription.
    if (changed.has("hass") && this.hass?.connection && this.hass.connection !== this._conn) {
      this._connect();
    }
  }

  _teardown() {
    this._token++;
    clearTimeout(this._timer);
    this._timer = null;
    const unsub = this._unsub;
    this._unsub = null;
    this._conn = null;
    if (unsub) {
      try {
        Promise.resolve(unsub()).catch(() => {});
      } catch (_) {
        /* connection already closed */
      }
    }
  }

  _connect() {
    const conn = this.hass?.connection;
    if (!conn || !this.isConnected) return;
    this._teardown();
    this._conn = conn;
    const token = this._token;
    conn
      .subscribeMessage((event) => {
        if (token === this._token) this._setView(event.view);
      }, { type: "vehicle_log/subscribe" })
      .then((unsub) => {
        if (token !== this._token) {
          unsub();
          return;
        }
        this._unsub = unsub;
        this._retries = 0;
        this._connError = "";
      })
      .catch((err) => {
        if (token !== this._token) return;
        this._connError = errorText(err);
        // Keep _conn so hass updates do not bypass the backoff below.
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this._retries++);
        this._timer = setTimeout(() => {
          this._conn = null;
          this._connect();
        }, delay);
      });
  }

  _setView(view) {
    const known = new Set(this._view?.vehicles.map((v) => v.id));
    const fresh = this._view ? view.vehicles.find((v) => !known.has(v.id)) : null;
    this._view = view;
    if (fresh) this._selectVehicle(fresh.id);
    const ids = view.vehicles.map((v) => v.id);
    if (!ids.includes(this._vehicleId)) this._vehicleId = ids[0] ?? null;
  }

  get _vehicle() {
    return this._view?.vehicles.find((v) => v.id === this._vehicleId) ?? null;
  }

  _selectVehicle(id) {
    this._vehicleId = id;
    storage.set(KEY_VEHICLE, id);
  }

  _selectTab(tab) {
    this._tab = tab;
    storage.set(KEY_TAB, tab);
  }

  _toggleMenu() {
    this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }));
  }

  _openEdit(entry) {
    this._sheet = { type: entry.kind, entry };
  }

  _onFab() {
    this._sheet = this._tab === "reminders" ? { type: "reminder" } : { type: "menu" };
  }

  _onSaved(e) {
    this._setView(e.detail);
  }

  _renderSheet() {
    const s = this._sheet;
    if (!s) return nothing;
    const close = () => (this._sheet = null);
    if (s.type === "menu") {
      const choices = [
        ["service", "Dodaj serwis", "mdi:wrench"],
        ["refuel", "Dodaj tankowanie", "mdi:gas-station"],
        ["odometer", "Aktualizuj przebieg", "mdi:counter"],
      ];
      return html`<div class="overlay" @click=${close}>
        <div class="menu" @click=${(e) => e.stopPropagation()}>
          ${choices.map(
            ([type, label, icon]) => html`<button @click=${() => (this._sheet = { type })}>
              <ha-icon icon=${icon}></ha-icon>${label}
            </button>`,
          )}
        </div>
      </div>`;
    }
    const p = { hass: this.hass, view: this._view, vehicle: this._vehicle, entry: s.entry };
    const on = { close, saved: (e) => this._onSaved(e) };
    switch (s.type) {
      case "refuel":
        return html`<vl-refuel-form .hass=${p.hass} .view=${p.view} .vehicle=${p.vehicle} .entry=${p.entry}
          ?narrow=${this.narrow} @close=${on.close} @saved=${on.saved}></vl-refuel-form>`;
      case "odometer":
        return html`<vl-odometer-form .hass=${p.hass} .view=${p.view} .vehicle=${p.vehicle} .entry=${p.entry}
          ?narrow=${this.narrow} @close=${on.close} @saved=${on.saved}></vl-odometer-form>`;
      case "reminder":
        return html`<vl-reminder-form .hass=${p.hass} .view=${p.view} .vehicle=${p.vehicle} .entry=${p.entry}
          ?narrow=${this.narrow} @close=${on.close} @saved=${on.saved}></vl-reminder-form>`;
      case "vehicle":
        return html`<vl-vehicle-form .hass=${p.hass} .view=${p.view} .vehicle=${p.vehicle} .entry=${p.entry}
          ?narrow=${this.narrow} @close=${on.close} @saved=${on.saved}></vl-vehicle-form>`;
      default:
        return html`<vl-entry-form .hass=${p.hass} .view=${p.view} .vehicle=${p.vehicle} .entry=${p.entry}
          ?narrow=${this.narrow} @close=${on.close} @saved=${on.saved}></vl-entry-form>`;
    }
  }

  _renderContent() {
    if (!this._view) {
      return html`<div class="center">
        ${this._connError
          ? html`<div class="error" role="alert">Nie można połączyć z integracją: ${this._connError}</div>
              <div>Ponawiam próbę…</div>`
          : "Ładowanie…"}
      </div>`;
    }
    if (this._tab === "garage") {
      return html`<vl-garage
        .hass=${this.hass}
        .view=${this._view}
        @saved=${(e) => this._onSaved(e)}
        @add-vehicle=${() => (this._sheet = { type: "vehicle" })}
        @edit-vehicle=${(e) => (this._sheet = { type: "vehicle", entry: e.detail })}
      ></vl-garage>`;
    }
    const v = this._vehicle;
    if (!v) {
      return html`<div class="center">
        Brak pojazdów.<br />
        <button class="add" @click=${() => (this._sheet = { type: "vehicle" })}>Dodaj pojazd</button>
      </div>`;
    }
    if (this._tab === "reminders") {
      return html`<vl-reminders
        .hass=${this.hass}
        .vehicle=${v}
        .serviceTypes=${this._view.service_types}
        ?narrow=${this.narrow}
        @saved=${(e) => this._onSaved(e)}
        @add-odometer=${() => (this._sheet = { type: "odometer" })}
        @edit-reminder=${(e) => (this._sheet = { type: "reminder", entry: e.detail })}
      ></vl-reminders>`;
    }
    return html`<vl-entries
      .vehicle=${v}
      .serviceTypes=${this._view.service_types}
      @edit-entry=${(e) => this._openEdit(e.detail)}
    ></vl-entries>`;
  }

  render() {
    const vehicles = this._view?.vehicles ?? [];
    const showFab = this._view && this._vehicle && this._tab !== "garage";
    return html`
      <div class="bar">
        ${this.narrow
          ? html`<button class="icon-btn" aria-label="Menu" @click=${() => this._toggleMenu()}>
              <ha-icon icon="mdi:menu"></ha-icon>
            </button>`
          : nothing}
        <h1>Dziennik pojazdu</h1>
      </div>
      ${vehicles.length > 1
        ? html`<div class="chips" role="group" aria-label="Pojazd">
            ${vehicles.map(
              (v) => html`<button class="chip" aria-pressed=${v.id === this._vehicleId} @click=${() => this._selectVehicle(v.id)}>
                ${v.name}
              </button>`,
            )}
          </div>`
        : nothing}
      <main>${this._renderContent()}</main>
      ${showFab ? html`<button class="fab" aria-label="Dodaj" @click=${() => this._onFab()}>+</button>` : nothing}
      <nav>
        ${TABS.map(
          ([id, label, icon]) => html`<button aria-current=${this._tab === id ? "page" : "false"} @click=${() => this._selectTab(id)}>
            <ha-icon icon=${icon}></ha-icon>${label}
          </button>`,
        )}
      </nav>
      ${this._renderSheet()}
    `;
  }
}

if (!customElements.get("vehicle-log-panel")) {
  customElements.define("vehicle-log-panel", VehicleLogPanel);
}
