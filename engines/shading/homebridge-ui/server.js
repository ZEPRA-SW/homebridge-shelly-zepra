'use strict';
const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');
const { loadStatus } = require('../lib/status-store');
const { Overview } = require('../lib/overview');

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    const overview = new Overview();
    this.onRequest('/overview', async payload => {
      try {
        return overview.build(payload?.config, payload?.date, await loadStatus(this.homebridgeStoragePath));
      } catch (error) { throw new RequestError(error.message); }
    });
    this.ready();
  }
}
new UiServer();
