# Shelly ZEPRA for Homebridge

Shelly ZEPRA brings supported Shelly devices and solar shading into one Homebridge bridge. It provides separate device dashboards, local Scene automation with dew-point calculation, and a shared queue for Shelly Cloud requests.

**Your Shellys in your language: Deutsch · English · Français · Español.** The four languages cover the entire interface — device settings, live status, shading, Scenes, help texts and event history — with one shared language selection.

**Version `1.2.5` — HomeKit transport metadata and dependency corrections for Homebridge verification, including the WS90 and Scene improvements from 1.2.4.** Device and firmware capabilities vary. The latest Scene stages and reset behavior have automated coverage, but still need live device testing. This project does not claim Homebridge verification or Shelly endorsement.

## Features

- **Shading:** roller shutters and Venetian blinds, separate height and slat controls, daily sun-period timelines and live position visualizations.
- **Solar automation:** per-device orientation, independent left/right sun limits, signed start/end offsets, adjustable slat update interval and minimum change, and a configurable end position.
- **Manual control and protection:** automatic pause, optional wind-alarm controls for blinds, global controls and restoration after a wind alarm. Height and slat commands use the existing movement queue and position feedback.
- **Other Shelly devices:** supported relays, plugs, lights, inputs, energy meters, add-ons and BTHome readings, grouped by device model and channel. Plus 1 Mini, Pro 3EM and Pro 3EM-400 have separate model selections.
- **Four complete interface languages:** German, English, French and Spanish throughout all device areas and Scenes.
- **Scenes:** nested AND/OR conditions, confirmation durations, schedules, ordered actions, delays and intermediate conditions with timeouts.
- **Current source feedback:** read-only sensor values, On/Off states, dim levels and cover feedback below the chosen Scene measurement; stale or unavailable feedback is clearly marked.
- **Dew-point automation:** calculate dew point from selected temperature and relative-humidity readings, view the current result and use °C thresholds with hysteresis and confirmation durations in Scene conditions.
- **One cloud queue:** both device areas share request spacing, coalesced reads and rate-limit cooldowns per cloud server/key combination.
- **HomeKit visibility:** hide an individual device from Apple Home while retaining its plugin dashboard and configured automation.
- **Device configuration:** collapsible cards, copying and sorting. Common settings are edited once.

Devices are added manually; there is no automatic discovery. The plugin does not install scripts on Shelly devices.

## Requirements

The package declares Node.js 22, 24 or 26 and Homebridge 1.8+ or 2.x. The tested combinations are listed under [Testing](#testing).

For local access, Homebridge must be able to reach each device. Enter its host and the expected Shelly hardware ID; the permanent plugin ID is a separate identifier and should remain stable after pairing. For cloud access, enter the appropriate Shelly Cloud server, key and device ID for each device. Different cloud servers and keys are supported.

Shading requires original Shelly firmware with the Gen2+ Cover RPC interface, cover mode and calibration. Venetian blinds additionally require available and enabled slat control. A relay operating in switch mode belongs in **Other Shelly devices**, not in **Shading**.

## Compatibility

| Area | Support scope | Evidence and limits |
| --- | --- | --- |
| Shading | Gen2+ devices exposing the required cover and position APIs; slat control where available | Height/slat operation has been user-tested with Shelly Plus 2PM and 2PM Gen3. This does not validate every firmware or the latest Scene features. |
| Multiple cover channels | Separate configured entries for each cover channel | A dual-cover device uses the same host/hardware ID with different channel numbers and permanent plugin IDs. Pro Dual Cover hardware operation has not been confirmed by a live test. |
| General devices | Model templates for selected Gen1, Plus, Pro, Gen3 and Gen4 devices | Only functions exposed by the selected model and returned device data are available. Model selection is not a guarantee that every firmware feature is supported. |
| Energy meters | Selected EM/3EM and Pro/Gen3 meter models | Shelly EM Gen1 identification and its two measurement channels were checked read-only; its relay was not switched in that check. |
| BTHome | Configured sensor groups and supported readings supplied by the host device | IDs remain visible. Missing, stale and unsupported readings are not presented as fresh values. Raw BTHome button events are not Scene triggers. |

Gen1 cover control, including Shelly 2.5 in roller mode, is not supported by the shading engine. A Shelly 2.5 may still be used as a supported general relay in relay mode. The general-device engine deliberately excludes cover profiles.

Cloud access has additional restrictions: thermostat control, virtual components, button events and scheduled device reboots are not equivalent to their local counterparts. Supported functions depend on the model, firmware and data provided by Shelly Cloud. Matter commissioning, a Matter server and a dedicated iPhone app are not implemented.

## Installation

Install **homebridge-shelly-zepra** from the **Plugins** tab in Homebridge UI. Search for the exact package name, install it, then restart Homebridge through the web interface. New-package search indexing may take time.

The package is also available on [npm](https://www.npmjs.com/package/homebridge-shelly-zepra). For manual installation, download the `homebridge-shelly-zepra-1.2.5.tgz` asset from the [GitHub release](https://github.com/ZEPRA-SW/homebridge-shelly-zepra/releases/tag/v1.2.5) and follow [INSTALLATION.md](INSTALLATION.md).

The package has no installation hooks that enable or disable other plugins or rewrite the Homebridge configuration.

## Configuration

Use the Homebridge plugin UI. The top-level areas are **Shading**, **Other Shelly devices**, **Scene** and **General settings**. Shading and general devices each have a separate status view and device editor.

A minimal platform block is:

```json
{
  "platform": "ShellyZepra",
  "name": "Shelly ZEPRA",
  "language": "en",
  "pollInterval": 20,
  "devices": [],
  "shading": {
    "timeZone": "Europe/Berlin",
    "devices": []
  },
  "scenes": []
}
```

General devices are stored in `devices`; shading devices are stored in `shading.devices`. Configure the actual coordinates and time zone before enabling solar automation. The example configuration contains demonstration defaults, not a detected location.

A physical Shelly cannot be configured in both device areas at the same time. Multiple cover channels of one device are configured as separate shading entries. Keep permanent plugin IDs unique and stable. A cover ID identifies a channel, not the device hardware.

`pollInterval` controls status reads. It is separate from the minimum interval between automatic slat adjustments and the minimum required slat change. Raising the status interval can delay condition confirmation and position feedback. Cloud shading uses a minimum 30-second polling interval.

### HomeKit visibility and pairing

The **Show in Apple Home** option controls whether a device is published to HomeKit. Hiding it retains polling, dashboard data and configured plugin automation. Re-enabling preserves its plugin UUID, but Apple Home room assignments and automations may need review.

After adding a device, save the configuration and restart the ZEPRA child bridge. New accessories normally appear through the existing paired bridge; check Apple Home's default room. Removing and re-pairing the bridge is not required for ordinary additions.

### Languages

The entire custom interface supports **German, English, French and Spanish**, including general settings, both device areas, status views, Scenes, validation messages and Scene history. Choose the language once in **General settings**. Existing Scene history is translated when displayed; device identifiers, user-defined names and automation values are preserved. Save and restart the child bridge to apply the language to runtime logs and default HomeKit labels.

## BTHome sensors on a shading host

Add sensor mappings directly to the existing device under **Shading → Devices → BLU / BTHome** when that Shelly operates a blind or shutter. Do not add the same physical host again under **Other Shelly devices**. Sensor reads use the existing host connection and request queue. They do not create another cover, host accessory or output controller. The BTHome readings appear in the shading status card and are available as Scene sources under the existing shading device. Sensor freshness is independent of cover feedback.

This extension supports local read-only measurements and contact/motion states. BTHome button event streaming on shading hosts is not implemented; existing general-device button support is unchanged. Hiding the shading device from HomeKit also hides its attached sensor accessories while retaining plugin status and Scenes.

Scene source devices are grouped by device category, with Pro devices in their own categories, and sorted by name within each category. Stored device IDs, sources and Scene settings remain unchanged. A separate **Sensors** group lists configured BTHome groups, including the WS90, and available native/Add-on sensor components directly. Select the sensor first, then its measurement; the existing Shelly host and sensor ID are assigned automatically. For direct sensors, selecting a measurement sets the appropriate numeric or state comparison. Configured BTHome groups remain visible while offline without inventing readings. Direct sensor measurement names appear first, followed by their component ID. A read-only information line displays the current value or state using existing cached status updates. It never copies the live value into a condition threshold or changes an action. Missing, faulty, stale or future-dated feedback is unavailable.

## Ecowitt WS90 Powered by Shelly

Configure the Shelly-compatible WS90 weather station as a BTHome device on a supported Shelly host first. In the host's plugin settings choose **Add BLU / BTHome**, select **Ecowitt WS90 Powered by Shelly** and enter the BTHome device component actually configured on that host. The station is a host-connected BTHome device, not a separate IP-controlled relay. Existing **Other BTHome sensors** mappings continue to work.

The weather mapping covers wind speed, gust speed, wind direction, rain status, UV index, air pressure, reported dew point, capacitor voltage and reported precipitation, alongside battery, illumination, humidity and temperature. Object types and occurrence indices follow the [official Shelly WS90 specification](https://shelly-api-docs.shelly.cloud/docs-ble/Devices/BLU_ZB/wstation/). Wind and gust speed use km/h, converted once from Shelly's decoded m/s readings. Other measurements retain Shelly's decoded units. Reported precipitation is shown in mm without assuming an hourly or daily period.

The maintainer confirmed the WS90 update from local test build `1.2.1` in practical use.

Fresh decoded sensor packets remain valid when the host reports `paired: false`; pairing for direct Bluetooth access is separate from receiving broadcast measurements. Device errors, decoding errors and invalid or stale sensor values are still rejected.

Each weather reading retains its BTHome component identity. Invalid, stale, missing or faulty readings remain unavailable; a valid zero remains zero. New WS90 selections use a 120-second stale limit by default. BTHome confirmation durations and intermediate Scene conditions use the sensor measurement timestamp; repeatedly polling an unchanged host cache does not count as a new confirming sample. Weather values can be viewed in the status dashboard and used as Scene conditions. Additional weather values use custom read-only HomeKit characteristics; their display depends on the HomeKit app. Apple Home does not offer standard tiles for every weather measurement.

No scripts or peripherals are created on the station or its host. The plugin uses the existing configured component reads. The maintainer has confirmed the WS90 update in practical use. Automated checks cover the latest Scene editor feedback; practical coverage differs by model and function.

## Sensor Add-on inputs

For supported Sensor Add-ons, enable the required digital inputs for contact switches and select the configured analog input as a percentage or voltage reading. Component numbers must match the peripherals already configured on the Shelly; the plugin does not create or rewire those peripherals. The Pro Sensor Add-on supports two separately configured analog inputs.

Enabled analog inputs show their current value and unit in the device status view and can trigger Scene value conditions. Missing, faulty or stale measurements do not count as valid values. Analog measurements are read-only and use a custom HomeKit characteristic; Apple Home has no standard generic analog-value tile, so use the plugin dashboard, Scenes or a compatible HomeKit app for these readings. Live validation with the connected sensors is still required.

## Scenes

A Scene has one start-condition tree and one ordered sequence of action stages. AND requires all child conditions; OR requires at least one. Groups and stages are collapsible.

1. Add a Scene and select **Status**, **Value**, **Time** or **Dew point** conditions. Choose the Shelly first, then its state or sensor reading. BTHome identifiers are retained for assignment.
2. Use **Add condition** beside **Continue to action** to add conditions. Select AND/OR for the group; nested groups support more complex expressions.
3. Add action stages. Each stage runs its fixed delay, then its optional intermediate conditions, then its action. Intermediate conditions have a maximum wait, default 300 seconds.
4. Choose **Off**, **Always active** or a weekday/time activation window. New Scenes are off. Save and restart the child bridge to apply configuration changes.

Supported actions include output on/off, light brightness, shade height/slats and configured Auto, Auto Pause and Wind Alarm controls. For shading, **0% means closed and 100% means open**. For slats, **100% means horizontal**.

A status/value condition with zero confirmation duration triggers on a false-to-true transition; the first fresh value after startup or a data gap is the baseline. Positive durations require a continuously matching condition and a fresh confirming reading after the duration. Hysteresis is available for numeric thresholds. Time conditions match the configured local minute and weekdays, at most once per matching clock branch and local day; missed times are not replayed.

After the first command is accepted, the original trigger normally stays latched so a sequence such as light on, wait, light off can complete. Later stages may impose their own conditions. Failed stages, expired waits, activation-window expiry and shutdown stop remaining actions. Already accepted commands are not automatically retried. Waiting sequences are marked aborted after a restart and are not resumed.

### Dew-point conditions

Choose **Dew point** as a Scene condition, select a temperature source and a relative-humidity source, then set the comparison and dew-point threshold in °C. Both native and configured BTHome readings can be selected, with their device/sensor identifiers retained. The two readings must describe the same air; selecting unrelated locations does not yield a meaningful local dew point. A read-only preview shows the current result when both readings are valid and fresh.

The calculation uses the [NPL Magnus approximation over water](https://www.npl.co.uk/resources/q-a/dew-point-and-relative-humidity), with coefficients 17.62 and 243.12. Input temperature must be between −45 and 60 °C and relative humidity must be greater than 0 and no more than 100%. This is a dew-point estimate over water, not a frost-point calculation. Missing, faulty, stale or out-of-range readings are unavailable and cannot trigger or reset a Scene. Confirmation duration requires fresh samples from both sources. Dew-point conditions also work in nested AND/OR groups and between action stages.

### Optional return to the previous state

Enable **Restore previous state when the condition resets** to capture original target values before the first command. Once the entire start-condition expression becomes definitively false, the Scene attempts to restore its accepted changes to those original values. This is restoration, not simply inversion. Unknown original values block the Scene from starting; missing source data does not count as a reset.

For blinds, restoration includes height, slats and the previous automation-pause state where available. The existing motion buffer and position confirmation remain in use. Known later controls, changed targets, wind protection and recovery locks take precedence. Same-value external writes without identifiable provenance cannot always be distinguished. A partial or failed reset is recorded without automatic retries. Pending reset contexts are discarded and logged after a Homebridge restart.

### Status lamp and protocol

The green lamp in a Scene's collapsed header means its start conditions, including confirmation durations, are currently fulfilled and allowed by the Scene mode/schedule. False, unknown, stale or disabled conditions are gray. The lamp does not confirm that an actuator has reached its destination.

Each Scene retains its **last ten events**, newest first. These include triggers, waits, command handoffs, confirmed shade returns, skipped resets and abort reasons. A handoff entry is distinct from physical arrival. Status and protocol refresh roughly every five seconds while the Scene view is visible, without rebuilding focused input fields.

Scenes evaluate existing in-memory status snapshots and do not add regular Shelly reads. Limits include 100 Scenes, 20 action stages per Scene, five nested condition levels, at least five seconds between triggers and 30 Scene commands per minute in total. Actuator trigger cycles are rejected during validation.

## Cloud behavior and protection

Requests are spaced by at least two seconds per server/key combination. Duplicate queued reads are combined. Rate limiting sets a shared cooldown; repeated limiting increases the pause. Controls with ambiguous results are not blindly replayed.

Only requests inside this ZEPRA instance share its queue. Other plugins, applications and Homebridge installations using the same cloud account still contribute to cloud limits. Avoid duplicate control paths while testing.

Cloud feedback may be delayed. Wind and stop commands still depend on server limits and connectivity. **Cloud control must not be the only time-critical wind-protection mechanism.** Plugin locks cannot block commands sent directly to a Shelly by another system.

## Migration

This is a separate platform, `ShellyZepra`, combining the general-device and shading engines. It does not automatically replace existing Shelly plugins. Back up Homebridge and prevent parallel polling/control of the same devices during migration.

The optional `scripts/merge-config.cjs` helper merges exported `ShellyRaffstore` and `ShellyUniversal` platform blocks into a new ZEPRA block. It leaves its input files and the active Homebridge configuration unchanged, and refuses to overwrite an existing output file:

```bash
node scripts/merge-config.cjs old-shading.json old-devices.json zepra-config.json
```

The new ZEPRA child bridge must be paired in Apple Home. Room assignments, scenes and automations from separate old bridges are not automatically transferred. Runtime cache state such as current Auto, Pause and Wind Alarm values is not imported from configuration exports. Export files can contain credentials; keep them private.

## Testing

The pre-publication validation passed:

- **622 automated tests** with Node 24.22.3 / Homebridge 1.11.1 and Node 26.13.0 / Homebridge 2.5.0.
- **170 combined browser checks** using simulated Homebridge UI data, including desktop/mobile layout and the Homebridge URL/CSP restrictions.
- **70 Add-on editor checks**, plus four-language analog-status and dew-point editor/preview checks, including missing/faulty/stale samples and mobile layout.
- **189 WS90 browser checks** across all four languages, covering the complete decoder/status/UI path, weather values and units, sensor identity, stale/fault handling, source timestamps and mobile layout.
- **169 shading-BTHome browser checks** across all four languages for sensor mappings on shading hosts, grouped Scene source selection, stable device IDs, Save validation and independent sensor freshness.
- **180 direct-sensor browser checks** across all four languages for station-to-measurement selection, automatic host assignment, matching state/numeric comparisons, offline choices, duplicate IDs and stable saved scenes.
- **273 current-feedback browser checks** across all four languages for values and states, units, currentness, false/zero, status refresh, unchanged thresholds/actions and desktop/mobile display.

Tests include real Homebridge/HAP libraries and the existing movement controller with simulated transport. They are not proof of live operation across every listed device, firmware or cloud account. Live validation of the latest Scene stages and reset behavior remains outstanding.

For development:

```bash
npm install
npm test
npm run check
```

The browser suites are `node test/ui-browser.cjs`, `node test/scenes-i18n-browser.cjs`, `node test/addon-ui-browser.cjs`, `node test/addon-overview-browser.cjs` and `node test/scene-dewpoint-browser.cjs` and `node test/ws90-browser.cjs` and `node test/shading-bthome-browser.cjs` and `node test/scene-sensor-choices-browser.cjs` and `node test/scene-current-reading-browser.cjs`. They use Microsoft Edge by default. For bundled Chromium, install it with `npx playwright install chromium`, set the `PLAYWRIGHT_CHANNEL` environment variable to `bundled`, then run the suite. The CI workflow uses bundled Chromium. The GitHub CI matrix additionally checks Node 22, 24 and 26 against both installed Homebridge versions. Node 22 has not been validated locally.

## Feedback, suggestions and bug reports

Please send feedback, feature suggestions and bug reports to [pm@zepra-app.de](mailto:pm@zepra-app.de). You can also open a GitHub issue.

Include the plugin, Homebridge and Node.js versions, Shelly model/firmware, local or cloud connection, the relevant sanitized log excerpt and steps to reproduce. Describe whether the Shelly app or direct device interface still works at the same time.

Do not post cloud keys, passwords, full Homebridge backups or unredacted configuration exports. Keep configuration and backups private; the plugin uses the credentials configured there for local/cloud access.

## License

[MIT](LICENSE).
