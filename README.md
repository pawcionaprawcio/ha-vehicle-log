# Vehicle Log

A car service journal for Home Assistant, with its own sidebar panel.

Keep a log of service entries, refuels and odometer readings for one or more vehicles. Set reminders by date and/or mileage and get notified when they are due. Everything is stored locally in Home Assistant; no cloud, no account.

> Screenshots: _coming soon_.

## Features

- Several vehicles, each with its own odometer, entries and reminders.
- Service entries (oil, filters, brakes, tyres, ...), refuels and odometer updates.
- Fuel consumption (L/100 km) calculated from full-tank refuels.
- Reminders by date, mileage or both (for example "every 12 months or 10 000 km"), with ready-made templates.
- Forecast odometer based on your driving history, so mileage-based reminders can warn you in advance.
- Home Assistant sensors, a persistent notification and an event for every due item.
- Import of vehicles, service entries and odometer readings from a Car Notes Excel export (see below).

## Installation (HACS)

1. In HACS open the three-dot menu, then **Custom repositories**.
2. Add `https://github.com/pawcionaprawcio/ha-vehicle-log` with category **Integration**.
3. Install **Vehicle Log** and restart Home Assistant.
4. Go to **Settings > Devices & services > Add integration** and add **Vehicle Log**. No configuration is needed; only one instance is allowed.

A **Vehicle Log** entry appears in the sidebar. The panel has three tabs: entries, reminders and garage (vehicles, settings and import).

## Importing from Car Notes

The garage tab can import the `.xlsx` file exported by the Car Notes Android app (vehicles, with their service entries and odometer readings; each vehicle's purchase date is taken when present). Refuels and reminders are not imported: log refuels in the panel and re-create reminders in the Reminders tab. Choose the file in the garage tab and confirm. This integration is an independent project and is not affiliated with or endorsed by the Car Notes app or its authors.

## Settings

Available in the garage tab:

| Setting | Default | Meaning |
|---|---|---|
| Forecast odometer | on | Estimate the current mileage from the history, used for mileage reminders. |
| Odometer update reminder | on | Notify when no odometer reading was logged for a while. |
| Days without a reading | 120 | How long to wait before the odometer reminder. |

## Entities

Per vehicle (the vehicle is a device; entity ids follow the device name, e.g. `sensor.my_car_odometer`):

| Entity | Type | Description |
|---|---|---|
| Odometer | sensor, km | Latest known odometer reading. |
| Forecast odometer | sensor, km | Estimated current mileage. |
| Fuel consumption | sensor, L/100km | Last full-tank segment; attributes `avg_l_per_100km`, `avg_cost_per_100km`. |
| Odometer update due | binary sensor (problem) | On when an odometer reading is overdue. |

Per reminder:

| Entity | Type | Description |
|---|---|---|
| `<reminder>` remaining distance | sensor, km | Kilometres left until due. |
| `<reminder>` remaining days | sensor, days | Days left until due. |
| `<reminder>` progress | sensor, % | How much of the interval is used. |
| `<reminder>` due | binary sensor (problem) | On when due; attributes `due_date`, `due_odometer`. |

Entities are created and removed automatically as you add or delete vehicles and reminders.

## Notifications and the `vehicle_log_reminder_due` event

When a reminder (or an overdue odometer update) becomes due, Vehicle Log creates a persistent notification and fires the event `vehicle_log_reminder_due` once. It is checked whenever data changes and every day at 09:00.

Event data:

| Field | Reminder | Odometer update | Notes |
|---|---|---|---|
| `kind` | `reminder` | `odometer` | |
| `vehicle_id` | yes | yes | |
| `vehicle_name` | yes | yes | |
| `reminder_id` | yes | - | |
| `text` | yes | - | Reminder text. |
| `due_date` | yes | - | ISO date or null. |
| `due_odometer` | yes | - | km or null. |
| `last_date` | - | yes | Date of the last odometer entry. |

### Example: push notification to your phone

```yaml
automation:
  - alias: "Vehicle Log: reminder due"
    triggers:
      - trigger: event
        event_type: vehicle_log_reminder_due
        event_data:
          kind: reminder
    actions:
      - action: notify.mobile_app_your_phone
        data:
          title: "{{ trigger.event.data.vehicle_name }}"
          message: >-
            {{ trigger.event.data.text }}
            {% if trigger.event.data.due_date %}(by {{ trigger.event.data.due_date }}){% endif %}
            {% if trigger.event.data.due_odometer %}(at {{ trigger.event.data.due_odometer }} km){% endif %}
```

Replace `notify.mobile_app_your_phone` with your own notify service. To also handle odometer reminders, drop the `event_data` filter and use `kind` in a template.

## Development

```bash
uv sync
uv run pytest -q
```

CI runs hassfest, the HACS validation and the test suite.

## License

MIT, see [LICENSE](LICENSE).
