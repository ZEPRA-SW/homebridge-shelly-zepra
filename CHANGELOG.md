# Changelog

## 1.2.5

- Declare HomeKit/HAP support with the `supports-hap` keyword.
- Keep Homebridge only in development dependencies; installations use the existing Homebridge host without automatically installing a peer copy.
- Check transport declarations, dependency placement and package/lockfile versions before release.
- Retain the WS90, sensor-selection and Scene current-value improvements from 1.2.4.

## 1.0.3

- Validate the shared time zone before either device engine starts, preventing an uncaught scheduled-reboot initialization error.
- Report invalid time zones in all four languages without starting devices or modifying existing state.
- Includes the safe configuration rejection introduced in 1.0.2.

## 1.0.2

- Catch malformed shared device lists and invalid general-device settings before initialization.
- Report the configuration error in the selected language and remain inactive without modifying cached accessories or persisted state.

## 1.0.1

- Complete German, English, French and Spanish language support across the shared interface, general devices and Scenes.
- Translate existing Scene history at display time while retaining user names, IDs and automation values.
- Fill remaining shading translations, accessibility labels, date/time formats and generated HomeKit labels.
- Add four-language catalog and browser regression checks, including switching languages with an existing configuration.

## 1.0.0 — initial public release

- Combine supported Shelly general devices and solar shading in one Homebridge bridge.
- Keep device editors and status dashboards separate, with shared general settings.
- Share cloud scheduling across device areas, independently per server/key combination.
- Add configurable HomeKit visibility and retain device identification checks.
- Provide solar shading timelines, slat following, wind controls and manual pauses.
- Provide local Scenes with nested AND/OR trees, ordered stages, delays and intermediate condition gates.
- Provide optional restoration of prior target values, a fulfilled-condition indicator and a ten-event protocol per Scene.
- Put Add condition beside Continue to action and expose AND/OR directly.
- Prepare English public documentation and sanitized, reproducible source and release assets.
- Publish version 1.0.0 to npm for standard Homebridge installation.

This is the first public release. See README.md for tested combinations, model evidence and limitations. The public preparation does not add npm publication or certify untested devices.
