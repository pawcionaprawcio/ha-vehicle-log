// Shared helpers, styles and the form base class for the Vehicle Log panel.
import { LitElement, html, css, nothing } from "./lit-core.min.js";

export const LIMITS = { name: 70, part_numbers: 300, comment: 1000 };

const NBSP = " ";

/** Parse "5,79" / "1 000.5" / 12 -> number; empty or invalid -> null. */
export function parseNum(str) {
  if (str === null || str === undefined) return null;
  if (typeof str === "number") return Number.isFinite(str) ? str : null;
  const text = String(str).trim().replace(/\s/g, "").replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** True when the field has text that is not a valid number. */
export function badNum(str) {
  return String(str ?? "").trim() !== "" && parseNum(str) === null;
}

export const ODOMETER_MAX = 10_000_000;

/**
 * Polish message when an odometer/interval field is not a whole non-negative
 * number (digits and whitespace only), else "". Empty is fine.
 */
export function intError(str, label = "Przebieg") {
  const text = String(str ?? "").trim();
  if (!text) return "";
  if (!/^[\d\s]+$/.test(text)) return `${label}: tylko cyfry, bez przecinka i znaków.`;
  if (parseNum(text) > ODOMETER_MAX) return `${label}: wartość jest zbyt duża.`;
  return "";
}

/** Random 32-char hex id; crypto.randomUUID is missing on plain http. */
export function newId() {
  const bytes = new Uint8Array(16);
  const c = globalThis.crypto;
  if (c && c.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Polish plural: 1 -> one, 2-4 (not 12-14) -> few, otherwise many. */
export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (n === 1) return one;
  return m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14) ? few : many;
}

export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${Number(m[3])}.${m[2]}.${m[1]}` : iso || "";
}

function group(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

export function fmtKm(n) {
  return n === null || n === undefined ? "" : `${group(n)}${NBSP}km`;
}

export function fmtMoney(n) {
  if (n === null || n === undefined) return "";
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  const text = whole
    ? group(n)
    : n.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
  return `${text}${NBSP}zł`;
}

/** Decimal with comma, between min and max fraction digits, no grouping. */
export function fmtDec(n, min = 0, max = 2) {
  if (n === null || n === undefined) return "";
  return n.toLocaleString("pl-PL", {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    useGrouping: false,
  });
}

/** Number -> text for an input field ("" when unset). */
export function toField(n) {
  return n === null || n === undefined ? "" : String(n).replace(".", ",");
}

/** Mirror of calc.entry_total. */
export function entryTotal(parts, labour, taxPct, discountPct, discountAmount) {
  let base = (parts || 0) + (labour || 0);
  base = base * (1 - (discountPct || 0) / 100) - (discountAmount || 0);
  return Math.round(base * (1 + (taxPct || 0) / 100) * 100) / 100;
}

/**
 * Which refuel amount to recompute when total, price and litres are all filled
 * and `edited` was just changed: keep the edited field and the total
 * (edited litres -> recompute price; edited total or price -> recompute litres).
 */
export function refuelDerivedKey(edited) {
  return edited === "litres" ? "price_per_litre" : "litres";
}

/** Mirror of calc.add_months (day clamped to the end of the target month). */
export function addMonths(iso, months) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return null;
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + months;
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  const day = Math.min(Number(m[3]), new Date(year, month, 0).getDate());
  const p = (n) => String(n).padStart(2, "0");
  return `${year}-${p(month)}-${p(day)}`;
}

export function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function nowTime() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const storage = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (_) {
      /* storage unavailable: ignore */
    }
  },
};

export function errorText(err) {
  if (err && typeof err === "object" && err.message) return String(err.message);
  return String(err || "Nieznany błąd");
}

export const sheetStyles = css`
  :host {
    color: var(--primary-text-color);
    font-family: var(--paper-font-body1_-_font-family, inherit);
  }
  * { box-sizing: border-box; }
  .overlay {
    position: fixed; inset: 0; z-index: 30; background: rgba(0, 0, 0, 0.45);
    display: flex; align-items: center; justify-content: center;
  }
  .sheet {
    background: var(--card-background-color, #fff); width: 100%; max-width: 520px;
    max-height: 92vh; display: flex; flex-direction: column; border-radius: 12px; overflow: hidden;
  }
  :host([narrow]) .sheet { max-width: none; height: 100%; max-height: none; border-radius: 0; }
  header {
    display: flex; align-items: center; gap: 8px; padding: 4px 8px 4px 16px; min-height: 56px;
    border-bottom: 1px solid var(--divider-color);
  }
  header h2 { flex: 1; margin: 0; font-size: 18px; font-weight: 500; }
  .body { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
  footer { padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid var(--divider-color); display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; gap: 12px; }
  .row > * { flex: 1; min-width: 0; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--secondary-text-color); }
  input, select, textarea {
    font: inherit; font-size: 16px; min-height: 48px; padding: 8px 12px; width: 100%;
    color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-radius: 8px;
  }
  textarea { min-height: 80px; resize: vertical; }
  input:focus, select:focus, textarea:focus { outline: 2px solid var(--primary-color); border-color: transparent; }
  input[type="checkbox"] { width: 24px; min-height: 24px; height: 24px; accent-color: var(--primary-color); }
  input::placeholder { color: var(--disabled-text-color, #999); font-style: italic; }
  .check { flex-direction: row; align-items: center; gap: 12px; min-height: 48px; font-size: 16px; color: var(--primary-text-color); }
  button {
    font: inherit; min-height: 48px; min-width: 48px; padding: 0 16px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--divider-color); background: transparent; color: var(--primary-text-color);
  }
  button.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: transparent; font-weight: 500; }
  button.danger { color: var(--error-color, #db4437); border-color: var(--error-color, #db4437); }
  button.danger.solid { background: var(--error-color, #db4437); color: #fff; }
  button.link { border: none; color: var(--primary-color); justify-content: flex-start; text-align: left; padding: 0; }
  button:disabled { opacity: 0.5; cursor: default; }
  .close { border: none; font-size: 22px; padding: 0; }
  .error { color: var(--error-color, #db4437); font-size: 14px; word-break: break-word; }
  .hint { font-size: 12px; color: var(--secondary-text-color); }
  .count { text-align: right; font-size: 12px; color: var(--secondary-text-color); }
`;

/**
 * Base class for the entry forms. Subclasses implement `heading`, `renderBody()`
 * and `buildEntry()`, which returns the entry payload or throws an Error with
 * a Polish validation message.
 */
export class VlForm extends LitElement {
  static properties = {
    hass: { attribute: false },
    view: { attribute: false },
    vehicle: { attribute: false },
    entry: { attribute: false },
    narrow: { type: Boolean, reflect: true },
    _error: { state: true },
    _busy: { state: true },
    _confirmDelete: { state: true },
  };
  static styles = sheetStyles;

  constructor() {
    super();
    this._error = "";
    this._busy = false;
    this._confirmDelete = false;
    // One id per opened form: a retry after a lost response upserts, not duplicates.
    this._newId = newId();
  }

  get editing() {
    return Boolean(this.entry && this.entry.id);
  }

  get heading() {
    return "";
  }

  renderBody() {
    return nothing;
  }

  get deleteWarning() {
    return "Na pewno usunąć ten wpis?";
  }

  renderExtraHeader() {
    return nothing;
  }

  showFooter() {
    return true;
  }

  close() {
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  _saved(view) {
    this.dispatchEvent(new CustomEvent("saved", { detail: view, bubbles: true, composed: true }));
  }

  async _call(msg) {
    this._busy = true;
    this._error = "";
    try {
      const view = await this.hass.callWS(msg);
      this._saved(view);
      this.close();
    } catch (err) {
      this._error = errorText(err);
    } finally {
      this._busy = false;
    }
  }

  async save() {
    let entry;
    try {
      entry = this.buildEntry();
    } catch (err) {
      this._error = err.message;
      return;
    }
    await this._call({ type: "vehicle_log/entry/save", entry: { ...entry, id: entry.id || this._newId } });
  }

  async _delete() {
    await this._call({ type: "vehicle_log/entry/delete", entry_id: this.entry.id });
  }

  field(label, value, onInput, opts = {}) {
    const { type = "text", maxlength, inputmode, placeholder = "", disabled = false } = opts;
    return html`<label
      >${label}
      <input
        type=${type}
        .value=${value}
        maxlength=${maxlength ?? nothing}
        inputmode=${inputmode ?? nothing}
        placeholder=${placeholder}
        ?disabled=${disabled}
        @input=${(e) => onInput(e.target.value)}
    /></label>`;
  }

  num(label, value, onInput, placeholder = "") {
    return this.field(label, value, onInput, { inputmode: "decimal", placeholder });
  }

  textArea(label, value, max, onInput) {
    return html`<label
      >${label}
      <textarea .value=${value} maxlength=${max} @input=${(e) => onInput(e.target.value)}></textarea>
      <span class="count">${value.length}/${max}</span></label
    >`;
  }

  render() {
    return html`<div class="overlay">
      <div class="sheet" role="dialog" aria-label=${this.heading}>
        <header>
          <h2>${this.heading}</h2>
          ${this.renderExtraHeader()}
          <button class="close" aria-label="Zamknij" @click=${() => this.close()}>✕</button>
        </header>
        ${this.renderBody()}
        ${this.showFooter() ? this._renderFooter() : nothing}
      </div>
    </div>`;
  }

  _renderFooter() {
    return html`<footer>
      ${this._error ? html`<div class="error" role="alert">${this._error}</div>` : nothing}
      ${this._confirmDelete
        ? html`<div>${this.deleteWarning}</div>
            <div class="row">
              <button @click=${() => (this._confirmDelete = false)}>Anuluj</button>
              <button class="danger solid" ?disabled=${this._busy} @click=${() => this._delete()}>Usuń</button>
            </div>`
        : html`<div class="row">
            ${this.editing
              ? html`<button class="danger" @click=${() => (this._confirmDelete = true)}>Usuń</button>`
              : nothing}
            <button class="primary" ?disabled=${this._busy} @click=${() => this.save()}>
              ${this._busy ? "Zapisywanie…" : "Zapisz"}
            </button>
          </div>`}
    </footer>`;
  }
}

export { LitElement, html, css, nothing };
