# Installing Shelly ZEPRA

Install through Homebridge UI using the npm package, or use the GitHub release archive as a manual alternative.

## Before installing

1. Create a Homebridge backup.
2. Check the requirements and compatibility notes in [README.md](README.md).
3. If another plugin or automation system already controls the same Shellys, disable its duplicate polling/control for the migration test. Keep its configuration so you can return to it if needed. The ZEPRA package does not enable or disable other plugins.

## Install through Homebridge UI

1. Open the **Plugins** tab in Homebridge UI.
2. Search for **homebridge-shelly-zepra** and choose **Install**.
3. Restart Homebridge through its web interface, then open the plugin settings.

If the new package is not indexed in search yet, use the GitHub release archive below. On installations using `/var/lib/homebridge`, the Homebridge web terminal can also install the exact npm release:

```bash
npm install --prefix /var/lib/homebridge homebridge-shelly-zepra@1.0.0
```

## Install the release archive

1. Download `homebridge-shelly-zepra-1.0.0.tgz` from this repository's release assets.
2. Copy that archive to `/tmp/` on the Homebridge host using your usual SSH/SFTP file transfer.
3. In the **Homebridge web terminal** on an installation using `/var/lib/homebridge`, run:

   ```bash
   npm install --prefix /var/lib/homebridge /tmp/homebridge-shelly-zepra-1.0.0.tgz
   ```

4. Restart Homebridge **through the Homebridge web interface**. The installation command contains no restart command.
5. Open the Shelly ZEPRA plugin settings. If an old UI is cached, reload the page with a hard refresh, for example Ctrl+F5 on Windows.

If your Homebridge installation uses a different plugin directory, use its corresponding installation path rather than copying this prefix unchanged.

## First configuration

1. Add the `ShellyZepra` platform and configure it as a child bridge in Homebridge. Let Homebridge generate its bridge identity and port.
2. Use **Shading** for calibrated Gen2+ cover-mode devices and **Other Shelly devices** for supported relays, lights, inputs, meters and sensors. Select the model/profile that matches the actual firmware mode.
3. Enter each permanent plugin ID and device connection details. A permanent plugin ID, hardware ID and cover channel ID are different identifiers. Do not reuse a permanent ID for a different physical device.
4. For local devices, enter the host and expected hardware ID. For cloud devices, enter the appropriate cloud server, key and device ID. Keep credentials and configuration backups private.
5. Configure the actual coordinates and time zone before enabling solar automation. Review per-device orientation, sun limits, end positions and protection options.
6. Save and restart the ZEPRA child bridge to apply the configuration.
7. Pair the new child bridge with Apple Home. Look for newly published accessories in the default room, then assign rooms and review automations.

Start by checking status data and individual controls. Test solar automation and Scenes separately before relying on combined workflows. Hidden HomeKit devices remain available to the plugin's dashboards and automation.

## Updating an existing ZEPRA installation

Transfer the new release archive and repeat the installation command with its exact filename, then restart Homebridge using the web interface. Retain your existing platform configuration and permanent device IDs. Do not replace a working configuration with the empty example.

New accessories should appear through the existing paired bridge after a restart. Ordinary plugin updates do not require removing and pairing the bridge again. Apple Home may retain user-assigned names or room assignments independently of the plugin.

## Configuring Scenes

Open **Scene**. New Scenes are off. Start conditions offer UND/ODER (AND/OR) directly; **Bedingung hinzufügen** is beside **Weiter zur Aktion**. Add conditions first, then configure the shared ordered action stages. Continue only changes the editor view and never sends a device command.

Each stage can have a fixed delay and optional intermediate conditions with a maximum wait. The execution order is delay, intermediate conditions, action. Save and restart the child bridge when Scene configuration changes.

The optional **Bei Rücksetzen der Bedingung vorherigen Zustand wiederherstellen** checkbox is off by default. It captures current original target values before the first command and attempts to restore the Scene's accepted changes after the full start expression becomes false. Missing original values prevent that Scene from starting. Recognized later changes and protective locks take precedence. Pending reset contexts are discarded and logged after a restart.

The green lamp in the collapsed Scene header means its start conditions are currently fulfilled and allowed by its mode/schedule. It is gray for false, unknown, stale or disabled state. It does not confirm actuator arrival. The protocol retains the latest ten events per Scene; **Status aktualisieren** reloads it manually, and the visible Scene view also refreshes status automatically.

## Migrating from separate plugins

A ZEPRA configuration contains general devices in `devices` and shading devices in `shading.devices`. Optional conversion instructions are in the [migration section](README.md#migration).

Pair ZEPRA as a new child bridge. Existing room assignments, HomeKit scenes/automations and runtime accessory-cache state from the former bridges are not automatically migrated. Check these explicitly. Avoid running old and new control paths for the same devices at the same time.

## Returning to the previous setup

Disable the ZEPRA child bridge in Homebridge, re-enable the previous plugin/control path and restart Homebridge through its web interface. ZEPRA does not rewrite those older platform blocks. Review any changes made in Apple Home separately.

To roll back only the ZEPRA version, reinstall the earlier release archive using the same installation method and your backed-up configuration. Configuration compatibility should be checked before downgrading.
