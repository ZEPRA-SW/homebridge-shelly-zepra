# Contributing

Send feedback, suggestions and bug reports to [pm@zepra-app.de](mailto:pm@zepra-app.de), or use GitHub issues. Include the plugin, Node.js and Homebridge versions, Shelly model and firmware, connection type and a sanitized log excerpt. Never include cloud keys, passwords or configuration backups.

Install development dependencies with npm ci, then run npm run check and npm test. Set SHELLY_HOMEBRIDGE_VERSION to 1 or 2 to select the corresponding installed Homebridge test library. For browser checks, install Playwright Chromium, set PLAYWRIGHT_CHANNEL to bundled and run node test/ui-browser.cjs.

Keep fixture devices and credentials synthetic. Preserve existing accessory identities and the local/cloud command guards. Update documentation and relevant behavior tests when changing device support or Scene semantics.
