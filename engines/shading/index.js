'use strict';
const { ShellyClient } = require('./lib/client');
const { ShellyCloudClient } = require('./lib/cloud-client');
const { CoverController, toAngle, toPercent } = require('./lib/controller');
const { SunAutomation, solarConfig } = require('./lib/solar');
const { WindRecovery, captureWindPosition } = require('./lib/wind-recovery');
const { StatusStore } = require('./lib/status-store');
const { translate } = require('./lib/i18n');
const { configureSwitchName } = require('./lib/switch-names');
const { GlobalControls } = require('./lib/global-controls');
const { RebootSchedule, validateReboot } = require('./lib/reboot-schedule');
const { diagnosticKey } = require('./lib/rpc-diagnostics');
const PLUGIN = 'homebridge-shelly-raffstore';
const PLATFORM = 'ShellyRaffstore';

module.exports = api => api.registerPlatform(PLUGIN, PLATFORM, ShellyPlatform);

class ShellyPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.t = message => translate(message, this.config.language ?? 'de');
    this.statusStore = new StatusStore(api.user?.storagePath?.(), message => log.warn(this.t(message)));
    this.cached = [];
    this.devices = [];
    api.on('didFinishLaunching', () => this.launch());
    api.on('shutdown', () => { this.rebootScheduler?.stop(); this.devices.forEach(d => { clearTimeout(d.timer); d.controller.dispose(); d.client?.stop?.(); }); this.statusStore.close(); });
  }
  configureAccessory(accessory) { this.cached.push(accessory); }
  launch() {
    if (!Array.isArray(this.config.devices)) {
      this.log.error(this.t('Bitte eine Geräteliste devices konfigurieren.'));
      return;
    }
    const used = new Set();
    const ids = new Set();
    let successfulDevices = 0;
    for (const device of this.config.devices || []) {
      try {
        if (!device.name || (device.connection !== 'cloud' && !device.host) || !device.id || ids.has(device.id)) {
          throw new Error('Jedes Gerät benötigt Name, Host und eine eindeutige ID.');
        }
        ids.add(device.id);
        if (device.coverId !== undefined && (!Number.isInteger(device.coverId) || device.coverId < 0)) {
          throw new Error('Cover-ID muss eine nichtnegative Ganzzahl sein.');
        }
        if (device.deviceType !== undefined && !['raffstore', 'roller'].includes(device.deviceType)) {
          throw new Error('Gerätetyp muss Raffstore oder Rollladen sein.');
        }
        for (const [key, minimum, maximum] of [['positionWaitTimeout', 30, 900], ['positionTolerance', 0.1, 5]]) {
          if (device[key] !== undefined && (!Number.isFinite(device[key]) || device[key] < minimum || device[key] > maximum)) {
            throw new Error(key + ' ist außerhalb des gültigen Bereichs.');
          }
        }
        validateReboot(device.dailyReboot);
        const windConfigured = device.deviceType !== 'roller' && device.windProtection === true;
        const sunConfig = solarConfig(this.config, device);
        if (device.connection !== undefined && !['local', 'cloud'].includes(device.connection)) throw new Error('Ungültige Verbindungsart.');
        if (device.connection === 'cloud' && device.dailyReboot?.enabled === true) throw new Error('Geplanter Neustart ist nur lokal verfügbar.');
        const client = device.connection === 'cloud' ? new ShellyCloudClient(device) : new ShellyClient(device);
        const uuid = this.api.hap.uuid.generate(PLUGIN + ':' + device.id);
        let accessory = this.cached.find(a => a.UUID === uuid);
        const fresh = !accessory || accessory.context.zepraUnpublished === true;
        if(accessory)delete accessory.context.zepraUnpublished;
        if (!accessory) accessory = new this.api.platformAccessory(device.name, uuid);
        accessory.displayName = device.name;
        accessory.context = { ...accessory.context, deviceId: device.id };
        let slatAccessory;
        let slatFresh = false;
        if (device.deviceType !== 'roller' && device.separateSlatControl === true) {
          const slatUuid = this.api.hap.uuid.generate(JSON.stringify([PLUGIN, 'slats', device.id]));
          slatAccessory = this.cached.find(a => a.UUID === slatUuid);
          slatFresh = !slatAccessory || slatAccessory.context.zepraUnpublished === true;
          if(slatAccessory)delete slatAccessory.context.zepraUnpublished;
          const slatName = device.slatName || device.name + ' ' + this.t('Lamellen');
          if (!slatAccessory) slatAccessory = new this.api.platformAccessory(slatName, slatUuid);
          slatAccessory.displayName = slatName;
          slatAccessory.context = { deviceId: device.id, role: 'slats' };
        }
        let autoAccessory;
        let autoFresh = false;
        if (sunConfig || windConfigured) {
          const autoUuid = this.api.hap.uuid.generate(JSON.stringify([PLUGIN, 'sun', device.id]));
          autoAccessory = this.cached.find(a => a.UUID === autoUuid);
          autoFresh = !autoAccessory || autoAccessory.context.zepraUnpublished === true;
          if(autoAccessory)delete autoAccessory.context.zepraUnpublished;
          const autoName = device.name + ' ' + this.t('Steuerung');
          if (!autoAccessory) autoAccessory = new this.api.platformAccessory(autoName, autoUuid);
          autoAccessory.displayName = autoName;
          autoAccessory.context = { ...autoAccessory.context, deviceId: device.id, role: 'controls' };
        }
        const runtime = this.setup(accessory, device, client, slatAccessory, autoAccessory, sunConfig);
        runtime.config = device;
        runtime.client = client;
        runtime.rebootState = accessory.context.dailyRebootState;
        runtime.persistReboot = state => { accessory.context.dailyRebootState = state; this.api.updatePlatformAccessories([accessory]); };
        this.devices.push(runtime);
        used.add(uuid);
        if (fresh) this.api.registerPlatformAccessories(PLUGIN, PLATFORM, [accessory]);
        else this.api.updatePlatformAccessories([accessory]);
        if (slatAccessory) {
          used.add(slatAccessory.UUID);
          if (slatFresh) this.api.registerPlatformAccessories(PLUGIN, PLATFORM, [slatAccessory]);
          else this.api.updatePlatformAccessories([slatAccessory]);
        }
        if (autoAccessory) {
          used.add(autoAccessory.UUID);
          if (autoFresh) this.api.registerPlatformAccessories(PLUGIN, PLATFORM, [autoAccessory]);
          else this.api.updatePlatformAccessories([autoAccessory]);
        }
        successfulDevices++;
        runtime.initialPoll = runtime.poll();
      } catch (error) { this.log.error(this.t('Gerätekonfiguration') + ': ' + this.t(error.message)); }
    }
    if (this.devices.some(d => d.config.dailyReboot?.enabled === true)) {
      this.rebootScheduler = new RebootSchedule(this.devices.filter(d => d.config.connection !== 'cloud'), {
        timeZone: this.config.timeZone ?? 'Europe/Berlin',
        log: (name, message) => (this.log.info || this.log.warn).call(this.log, name + ': ' + this.t(message)),
      });
      this.rebootScheduler.start();
    }
    if (this.config.globalControls !== false && this.devices.some(d => d.automation || d.windConfigured)) {
      const uuid = this.api.hap.uuid.generate(JSON.stringify([PLUGIN, 'global-controls']));
      let accessory = this.cached.find(a => a.UUID === uuid);
      const fresh = !accessory;
      if (fresh) accessory = new this.api.platformAccessory(this.t('Beschattung Gesamt'), uuid);
      this.globalControls = new GlobalControls(accessory, this.devices, this.api, this.config.language ?? 'de', this.t);
      used.add(uuid);
      if (fresh) this.api.registerPlatformAccessories(PLUGIN, PLATFORM, [accessory]);
      else this.api.updatePlatformAccessories([accessory]);
    }
    // Invalid configurations must not delete previously paired accessories.
    if (successfulDevices === this.config.devices.length) {
      const removed = this.cached.filter(a => !used.has(a.UUID));
      if (removed.length) this.api.unregisterPlatformAccessories(PLUGIN, PLATFORM, removed);
    }
  }
  setup(accessory, config, client, slatAccessory, autoAccessory, sunConfig) {
    const { Service, Characteristic: C, HapStatusError, HAPStatus } = this.api.hap;
    const supportsSlats = config.deviceType !== 'roller';
    let automation;
    let autoSwitch;
    let pauseSwitch;
    let windSwitch;
    let recovery;
    const info = accessory.getService(Service.AccessoryInformation);
    info.setCharacteristic(C.Manufacturer, 'Shelly')
      .setCharacteristic(C.Model, this.t(supportsSlats ? '2PM / Raffstore' : '2PM / Rollladen'))
      .setCharacteristic(C.SerialNumber, config.id);
    const service = accessory.getService(Service.WindowCovering) ||
      accessory.addService(Service.WindowCovering, config.name);
    service.setCharacteristic(C.Name, config.name);
    if (!supportsSlats) {
      for (const type of [C.CurrentHorizontalTiltAngle, C.TargetHorizontalTiltAngle]) {
        if (service.testCharacteristic(type)) service.removeCharacteristic(service.getCharacteristic(type));
      }
    }
    let slatService;
    if (slatAccessory) {
      const slatName = config.slatName || config.name + ' ' + this.t('Lamellen');
      slatAccessory.getService(Service.AccessoryInformation)
        .setCharacteristic(C.Manufacturer, 'Shelly')
        .setCharacteristic(C.Model, this.t('Lamellensteuerung'))
        .setCharacteristic(C.SerialNumber, config.id + '-slats');
      slatService = slatAccessory.getService(Service.WindowCovering) ||
        slatAccessory.addService(Service.WindowCovering, slatName);
      slatService.setCharacteristic(C.Name, slatName);
    }
    const feedbackTypes = [C.CurrentPosition, C.TargetPosition, C.PositionState];
    if (supportsSlats) feedbackTypes.push(C.CurrentHorizontalTiltAngle, C.TargetHorizontalTiltAngle);
    let identityMismatch = false;
    let lastErrorMessage = '';
    let lastErrorAt = 0;
    let online = false;
    let lastGoodStatusAt = 0;
    let status;
    let externalFingerprint,sceneRevision=0,sceneWriter;
    const recordControl = source => {
      sceneRevision++;sceneWriter=source.startsWith('scene-reset:')?source.slice(12):undefined;if(source.startsWith('scene-reset:'))source='scene';
      accessory.context.lastControl = { source: ['apple-home','solar','wind','wind-recovery','external','scene'].includes(source) ? source : 'unknown', at: Date.now() };
      this.api.updatePlatformAccessories([accessory]);
    };
    const publish = () => {
      this.globalControls?.refresh();
      this.statusStore.update(config.id, {
      lastControl: accessory.context.lastControl,
      online, checkedAt:lastGoodStatusAt, identityMismatch, position: status?.current_pos, slatPosition: supportsSlats ? status?.slat_pos : undefined,
      automationConfigured: !!automation, automationEnabled: automation?.enabled ?? false,
      shadingActive: automation?.active ?? false, manualPaused: automation?.manualPaused ?? false,
      automationPending: automation?.pendingSchedule?.action ?? (automation?.candidate === true ? 'start' : automation?.candidate === false ? 'end' : null),
      automationPendingUntil: automation?.pendingSchedule?.until ?? (automation?.candidate !== null && automation?.candidate !== undefined
        ? automation.pendingSince + (automation.candidate ? automation.config.startOffsetSeconds : automation.config.endOffsetSeconds) * 1000 : null),
      solarExposure: automation?.lastExposure,
      pausedUntil: automation?.pausedUntil ?? 0,
      windAlarm: controller.windAlarm, recovering: controller.recovering ?? false,
      recoveryPhase: recovery?.state?.phase ?? null,
      recoveryFailed: controller.recoveryFailed ?? false,
      recoveryDiagnostic: accessory.context.windRecovery?.failed ? {
        target: accessory.context.windRecovery.target, actual: accessory.context.windRecovery.actual,
      } : null,
    });
    };
    const fail = error => {
      if (['COMMAND_CANCELLED','SHELLY_CLOUD_CANCELLED'].includes(error.code)) return;
      const cloudCommandRejected = config.connection === 'cloud' &&
        ['Cloud.SetCover', 'Cloud.SetGroups'].includes(error.rpcDiagnostic?.operation) &&
        [200, 400].includes(error.rpcDiagnostic?.httpStatus) &&
        error.rpcDiagnostic?.cloudError !== 'DEVICE_OFFLINE' &&
        !error.rpcDiagnostic?.cloudErrors?.includes('DEVICE_OFFLINE');
      const freshStatus = Date.now() - lastGoodStatusAt <= Math.max(120000,
        (Number.isFinite(this.config.pollInterval) ? this.config.pollInterval : 30) * 4000);
      online = cloudCommandRejected && online && freshStatus;
      identityMismatch = error.code === 'SHELLY_ID_MISMATCH';
      const details = identityMismatch ? ' [' + config.host + '] expected=' + error.expectedId + ', reported=' + error.actualId : error.recoveryDiagnostic ? ' ' + JSON.stringify(error.recoveryDiagnostic) : '';
      const text = config.name + ': ' + this.t(error.message) + details +
        (error.rpcDiagnostic ? ' ' + JSON.stringify(error.rpcDiagnostic) : '');
      const logKey = config.name + ': ' + error.message + details + diagnosticKey(error);
      if (logKey !== lastErrorMessage || Date.now() - lastErrorAt >= 60000) {
        if (identityMismatch) this.log.error(text);
        else this.log.warn(text);
        lastErrorMessage = logKey;
        lastErrorAt = Date.now();
      }
      publish();
      if (cloudCommandRejected && online) return;
      const hapError = new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      for (const type of feedbackTypes) {
        service.getCharacteristic(type).updateValue(hapError);
      }
      if (slatService) {
        for (const type of [C.CurrentPosition, C.TargetPosition, C.PositionState]) {
          slatService.getCharacteristic(type).updateValue(hapError);
        }
      }
    };
    const controller = new CoverController(client, config.coverId ?? 0, value => {
      online = true;
      lastGoodStatusAt = Date.now();
      identityMismatch = false;
      lastErrorMessage = '';
      status = value;
      if (value.source && !['init','limit_switch'].includes(value.source) && value.tag !== 'hb-raffstore') {
        const fingerprint = JSON.stringify([value.source, value.move_started_at, value.target_pos, value.state]);
        if (fingerprint !== externalFingerprint) { externalFingerprint = fingerprint; recordControl('external'); }
      }
      service.updateCharacteristic(C.CurrentPosition, Math.round(value.current_pos));
      if (supportsSlats) service.updateCharacteristic(C.CurrentHorizontalTiltAngle, toAngle(value.slat_pos));
      const moving = value.state === 'opening' || value.state === 'closing';
      service.updateCharacteristic(C.PositionState, value.state === 'opening' ? C.PositionState.INCREASING :
        value.state === 'closing' ? C.PositionState.DECREASING : C.PositionState.STOPPED);
      service.updateCharacteristic(C.ObstructionDetected, false);
      if (slatService) {
        slatService.updateCharacteristic(C.CurrentPosition, Math.round(value.slat_pos));
        // Shelly does not report an independent slat movement direction.
        slatService.updateCharacteristic(C.PositionState, C.PositionState.STOPPED);
        slatService.updateCharacteristic(C.ObstructionDetected, false);
      }
      // Polling must not overwrite a target currently being submitted.
      if (!controller.submitting && !controller.waitingSlat && !controller.waitingMove && !Object.keys(controller.pending).length) {
        service.updateCharacteristic(C.TargetPosition, Math.round(moving && typeof value.target_pos === 'number' ? value.target_pos : value.current_pos));
        if (supportsSlats) service.updateCharacteristic(C.TargetHorizontalTiltAngle, toAngle(value.slat_pos));
        if (slatService) slatService.updateCharacteristic(C.TargetPosition, Math.round(value.slat_pos));
      }
      automation?.observe(value);
    }, 200, {
      kind: config.deviceType ?? 'raffstore',
      tag: 'hb-raffstore',
      windAlarm: supportsSlats && config.windProtection === true && accessory.context.windAlarm === true,
      positionWaitTimeout: config.positionWaitTimeout,
      positionTolerance: config.positionTolerance,
      onError: fail,
      onCommand: recordControl,
    });
    const get = fn => () => {
      if (!online || !status) throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      return fn(status);
    };
    const set = field => async value => {
      recovery?.cancel();
      if (!controller.windAlarm) automation?.manual();
      try {
        await controller.set(field, field === 'slat_pos' ? toPercent(value) : value);
        service.updateCharacteristic(field === 'slat_pos' ? C.TargetHorizontalTiltAngle : C.TargetPosition, value);
        if (slatService && field === 'slat_pos') {
          slatService.updateCharacteristic(C.TargetPosition, toPercent(value));
        }
      }
      catch (error) { fail(error); throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE); }
    };
    service.getCharacteristic(C.CurrentPosition).onGet(get(s => Math.round(s.current_pos)));
    service.getCharacteristic(C.TargetPosition).onSet(set('pos'));
    if (supportsSlats) {
      service.getCharacteristic(C.CurrentHorizontalTiltAngle).setProps({ minValue: -90, maxValue: 0, minStep: 1 })
        .onGet(get(s => toAngle(s.slat_pos)));
      service.getCharacteristic(C.TargetHorizontalTiltAngle).setProps({ minValue: -90, maxValue: 0, minStep: 1 })
        .onSet(set('slat_pos'));
    }
    service.getCharacteristic(C.PositionState).onGet(get(s => s.state === 'opening' ? C.PositionState.INCREASING :
      s.state === 'closing' ? C.PositionState.DECREASING : C.PositionState.STOPPED));
    service.getCharacteristic(C.HoldPosition).onSet(async value => {
      if (value) {
        recovery?.cancel();
      automation?.manual();
        try { await controller.stop(); }
        catch (error) { fail(error); throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE); }
      }
    });
    if (slatService) {
      slatService.getCharacteristic(C.CurrentPosition).onGet(get(s => Math.round(s.slat_pos)));
      slatService.getCharacteristic(C.PositionState).onGet(get(() => C.PositionState.STOPPED));
      slatService.getCharacteristic(C.TargetPosition).onSet(async value => {
        recovery?.cancel();
      automation?.manual();
        try {
          await controller.set('slat_pos', value);
          slatService.updateCharacteristic(C.TargetPosition, value);
          service.updateCharacteristic(C.TargetHorizontalTiltAngle, toAngle(value));
        } catch (error) {
          fail(error);
          throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
      });
      slatService.getCharacteristic(C.HoldPosition).onSet(async value => {
        if (!value) return;
        recovery?.cancel();
      automation?.manual();
        try { await controller.stop(); }
        catch (error) {
          fail(error);
          throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
      });
    }
    if (sunConfig) {
      automation = new SunAutomation(sunConfig, controller, accessory.context.sunState, state => {
        accessory.context.sunState = state;
        autoSwitch?.updateCharacteristic(C.On, state.enabled);
        pauseSwitch?.updateCharacteristic(C.On, state.manualPaused === true);
        this.globalControls?.refresh();
        this.api.updatePlatformAccessories([accessory]);
      });
    }
    recovery = new WindRecovery(controller, accessory.context.windRecovery, state => {
      accessory.context.windRecovery = state;
      this.api.updatePlatformAccessories([accessory]);
    }, () => {
      delete accessory.context.windRestore;
      automation?.resumeAfterWind();
      this.api.updatePlatformAccessories([accessory]);
    });
    const setAutomation = value => { sceneRevision++;sceneWriter=undefined; if (value && controller.recoveryFailed) recovery.cancel(); automation.setEnabled(!!value); publish(); };
    const setPause = value => {
      sceneRevision++;sceneWriter=undefined;
      // Explicitly resuming automation acknowledges a previous failed restoration,
      // just like enabling Auto, but never cancels an active recovery or wind alarm.
      if (!value && controller.recoveryFailed && !controller.windAlarm) recovery.cancel();
      automation.setPaused(!!value);
      publish();
    };
    const setWindAlarm = async value => {
      sceneRevision++;sceneWriter=undefined;
      value = !!value;
      if (value === controller.windAlarm) return;
      if (value) {
        accessory.context.windRestore = captureWindPosition(status, controller);
        recovery.cancel();
      }
      automation?.interrupt();
      const command = controller.setWindAlarm(value);
      accessory.context.windAlarm = controller.windAlarm;
      this.api.updatePlatformAccessories([accessory]);
      windSwitch?.updateCharacteristic(C.On, controller.windAlarm);
      publish();
      try {
        await command;
        if (!value && !controller.windAlarm) await recovery.start(accessory.context.windRestore, { stopOpening: true });
      } catch (error) {
        fail(error);
        throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      } finally { publish(); }
    };
    if (autoAccessory) {
      autoAccessory.getService(Service.AccessoryInformation)
        .setCharacteristic(C.Manufacturer, 'Shelly')
        .setCharacteristic(C.Model, this.t('Beschattungssteuerung'))
        .setCharacteristic(C.SerialNumber, config.id + '-sun');
      autoSwitch = autoAccessory.getServiceById(Service.Switch, undefined);
      if (automation) {
        autoSwitch = autoSwitch || autoAccessory.addService(Service.Switch, config.name + ' ' + this.t('Automatik Beschattung'));
        configureSwitchName(autoSwitch, 'automation', 'Auto', this.config.language ?? 'de', autoAccessory, this.api);
        autoSwitch.getCharacteristic(C.On).onGet(() => automation.enabled).onSet(setAutomation);
        autoSwitch.updateCharacteristic(C.On, automation.enabled);
      } else if (autoSwitch) {
        autoAccessory.removeService(autoSwitch);
      }
      windSwitch = autoAccessory.getServiceById(Service.Switch, 'wind');
      if (supportsSlats && config.windProtection === true) {
        windSwitch = windSwitch || autoAccessory.addService(Service.Switch, config.name + ' ' + this.t('Windalarm'), 'wind');
        configureSwitchName(windSwitch, 'wind', this.t('Windalarm'), this.config.language ?? 'de', autoAccessory, this.api);
        windSwitch.getCharacteristic(C.On).onGet(() => controller.windAlarm).onSet(setWindAlarm);
        windSwitch.updateCharacteristic(C.On, controller.windAlarm);
      } else if (windSwitch) {
        autoAccessory.removeService(windSwitch);
      }
      pauseSwitch = autoAccessory.getServiceById(Service.Switch, 'pause');
      if (automation) {
        pauseSwitch = pauseSwitch || autoAccessory.addService(Service.Switch, config.name + ' ' + this.t('Automatik Pause'), 'pause');
        configureSwitchName(pauseSwitch, 'pause', this.t('Automatik Pause'), this.config.language ?? 'de', autoAccessory, this.api);
        pauseSwitch.getCharacteristic(C.On).onGet(() => automation.manualPaused).onSet(setPause);
        pauseSwitch.updateCharacteristic(C.On, automation.manualPaused);
      } else if (pauseSwitch) {
        autoAccessory.removeService(pauseSwitch);
      }
    }
    const runtime = { sceneWriter:()=>sceneWriter,claimSceneWriter:token=>{sceneWriter=token;},sceneRevision:()=>sceneRevision, controller, automation, recovery, setAutomation, setWindAlarm, setPause,
      windConfigured: supportsSlats && config.windProtection === true };
    const interval = Math.max(config.connection === 'cloud' ? 30 : 1, Number.isFinite(this.config.pollInterval) ? this.config.pollInterval : 3);
    runtime.poll = async () => {
      try {
        const current = await controller.refresh();
        await recovery.tick(current);
        if (automation) await automation.tick(current);
        publish();
      }
      catch (error) { fail(error); }
      if (!controller.disposed) runtime.timer = setTimeout(runtime.poll, interval * 1000);
    };
    return runtime;
  }
}
module.exports.ShellyPlatform = ShellyPlatform;
