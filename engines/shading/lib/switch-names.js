'use strict';
const { translate } = require('./i18n');
function configureSwitchName(service, key, defaultName, language, accessory, api) {
  const C = api.hap.Characteristic;
  const custom = accessory.context.switchNames?.[key]?.[language];
  let name = typeof custom === 'string' && custom.trim() ? custom.trim() : defaultName;
  service.displayName = name;
  service.updateCharacteristic(C.Name, name);
  if (!service.testCharacteristic(C.ConfiguredName)) service.addOptionalCharacteristic(C.ConfiguredName);
  service.updateCharacteristic(C.ConfiguredName, name);
  service.getCharacteristic(C.ConfiguredName).onGet(() => name).onSet(value => {
    if (typeof value !== 'string' || !value.trim() || value.length > 64) throw new Error(translate('Ungültiger Schaltername.', language));
    name = value.trim();
    accessory.context.switchNames ??= {};
    accessory.context.switchNames[key] ??= {};
    accessory.context.switchNames[key][language] = name;
    service.displayName = name;
    service.updateCharacteristic(C.Name, name);
    service.updateCharacteristic(C.ConfiguredName, name);
    api.updatePlatformAccessories([accessory]);
  });
  return service;
}
module.exports = { configureSwitchName };
