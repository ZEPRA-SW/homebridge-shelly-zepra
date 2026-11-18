'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RaffstoreDeviceCopy = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function cloneDevice(source, devices, copyLabel = 'Kopie') {
    const result = JSON.parse(JSON.stringify(source));
    const ids = new Set(devices.map(device => device.id));
    const base = (source.id || 'device') + '-copy';
    let id = base, suffix = 2;
    while (ids.has(id)) id = base + '-' + suffix++;
    result.id = id;
    result.name = (source.name || source.id || '') + ' ' + copyLabel;
    result.host = '';
    result.shellyDeviceId = '';
    if (result.connection === 'cloud') result.cloudDeviceId = '';
    return result;
  }
  return { cloneDevice };
});
