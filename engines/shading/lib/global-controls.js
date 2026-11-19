'use strict';
const { configureSwitchName } = require('./switch-names');
class GlobalControls {
  constructor(accessory, devices, api, language, t) {
    this.devices = devices;
    this.api = api;
    this.switches = [];
    accessory.context.role = 'global-controls';
    accessory.getService(api.hap.Service.AccessoryInformation)
      .setCharacteristic(api.hap.Characteristic.Manufacturer, 'Homebridge Shelly Raffstore')
      .setCharacteristic(api.hap.Characteristic.Model, t('Globale Steuerung'))
      .setCharacteristic(api.hap.Characteristic.SerialNumber, 'shelly-raffstore-global-controls');
    for (const [key, label, eligible, value, command] of [
      ['auto', 'Auto', d => !!d.automation, d => d.automation.enabled, (d, v) => d.setAutomation(v)],
      ['wind', t('Windalarm'), d => d.windConfigured, d => d.controller.windAlarm, (d, v) => d.setWindAlarm(v)],
      ['pause', t('Automatik Pause'), d => !!d.automation, d => d.automation.manualPaused, (d, v) => d.setPause(v)],
    ]) {
      const targets = devices.filter(eligible);
      let service = accessory.getServiceById(api.hap.Service.Switch, key);
      if (!targets.length) { if (service) accessory.removeService(service); continue; }
      service ||= accessory.addService(api.hap.Service.Switch, label, key);
      configureSwitchName(service, key, label, language, accessory, api);
      // Auto requires all enabled; wind and pause show whether any eligible device is affected.
      const get = () => key === 'auto' ? targets.every(value) : targets.some(value);
      service.getCharacteristic(api.hap.Characteristic.On).onGet(get).onSet(async enabled => {
        const results = await Promise.allSettled(targets.map(d => Promise.resolve().then(() => command(d, !!enabled))));
        this.refresh();
        if (results.some(r => r.status === 'rejected')) {
          throw new api.hap.HapStatusError(api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
      });
      this.switches.push({ service, get });
    }
    this.refresh();
  }
  refresh() {
    for (const { service, get } of this.switches) service.updateCharacteristic(this.api.hap.Characteristic.On, get());
  }
}
module.exports = { GlobalControls };
