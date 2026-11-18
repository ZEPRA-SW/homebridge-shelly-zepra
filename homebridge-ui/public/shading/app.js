'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const t = text => window.RaffstoreI18n.translate(text, configuration()?.language ?? 'de');
  const el = (tag, className, text, raw = false) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = raw ? text : t(text);
    return node;
  };
  let blocks = [], schema, tab = 'overview', ready = false, loading = false, generation = 0;
  const configuration = () => blocks.find(b => b.platform === 'ShellyRaffstore') || blocks[0];
  const message = text => { $('message').textContent = t(text); $('message').hidden = !text; };
  function setPath(object, path, value) {
    for (let i = 0; i < path.length - 1; i++) {
      if (!object[path[i]] || typeof object[path[i]] !== 'object') object[path[i]] = {};
      object = object[path[i]];
    }
    if (value === undefined) delete object[path.at(-1)];
    else object[path.at(-1)] = value;
  }
  function getPath(object, path) {
    return path.reduce((value, key) => value?.[key], object);
  }
  function validConfig() {
    const cfg = configuration();
    const devices = cfg.devices || [];
    const ids = devices.map(d => d.id);
    return Array.isArray(devices) && devices.every(d => [d.id, d.name, ...(d.connection === 'cloud' ? [d.cloudServer, d.cloudKey, d.cloudDeviceId] : [d.host, d.shellyDeviceId])].every(v => typeof v === 'string' && v.trim())) &&
      new Set(ids).size === ids.length &&
      [...$('settings-panel').querySelectorAll('input,select')].every(input => input.checkValidity());
  }
  function changed() {
    const valid = validConfig();
    if (valid) homebridge.enableSaveButton();
    else homebridge.disableSaveButton();
    homebridge.updatePluginConfig(blocks).catch(() => message('Einstellungen konnten nicht übernommen werden. Bitte erneut versuchen.'));
  }
  function renderFields(container, definitions, object, prefix = [], required = [], header) {
    for (const [key, definition] of Object.entries(definitions)) {
      if (key === 'devices') continue;
      const roller = object.deviceType === 'roller';
      if (!prefix.length && object.id !== undefined) {
        const cloud = object.connection === 'cloud';
        if (cloud && ['host', 'shellyDeviceId', 'password', 'dailyReboot'].includes(key)) continue;
        if (!cloud && ['cloudServer', 'cloudKey', 'cloudDeviceId'].includes(key)) continue;
      }
      if (roller && ['separateSlatControl', 'slatName', 'windProtection'].includes(key)) continue;
      if (roller && prefix[0] === 'sunAutomation' &&
          ['slatWidth', 'slatSpacing', 'slatMargin', 'slatStep', 'endSlatPosition'].includes(key)) continue;
      const path = [...prefix, key];
      if (definition.type === 'object') {
        const details = el('details', 'nested');
        details.append(el('summary', '', definition.title || key));
        const fields = el('div', 'fields');
        renderFields(fields, definition.properties || {}, object, path, definition.required || [], header);
        details.append(fields);
        container.append(details);
        continue;
      }
      const value = getPath(object, path);
      const legacy = prefix[0] === 'sunAutomation'
        ? ['leftAngle', 'rightAngle'].includes(key) ? object.sunAutomation?.halfAngle :
          ['startOffsetMinutes', 'endOffsetMinutes'].includes(key) && object.sunAutomation?.delaySeconds !== undefined
            ? object.sunAutomation.delaySeconds / 60 : undefined : undefined;
      const shown = value ?? legacy ?? definition.default;
      const field = el('div', 'field' + (definition.type === 'boolean' ? ' check' : ''));
      if (prefix[0] === 'sunAutomation' && ['leftAngle', 'rightAngle'].includes(key)) {
        field.classList.add(key === 'leftAngle' ? 'solar-side-left' : 'solar-side-right');
      }
      const label = el('label', '', t(definition.title || key) + (required.includes(key) ? ' *' : ''), true);
      const unique = 'field-' + (++generation);
      label.htmlFor = unique;
      let input;
      if (definition.enum) {
        input = el('select');
        definition.enum.forEach((option, index) => {
          if (roller && key === 'endBehavior' && option === 'horizontal') return;
          const node = el('option', '', definition.enumNames?.[index] || option);
          node.value = option;
          input.append(node);
        });
        input.value = shown ?? definition.enum[0];
      } else {
        input = el('input');
        input.type = definition.type === 'boolean' ? 'checkbox' :
          ['integer', 'number'].includes(definition.type) ? 'number' :
          definition.format === 'password' ? 'password' : definition.format === 'time' ? 'time' : 'text';
        if (input.type === 'checkbox') input.checked = shown === true;
        else input.value = shown ?? '';
        if (input.type === 'number') {
          input.step = definition.type === 'integer' ? '1' : 'any';
          if (definition.minimum !== undefined) input.min = definition.minimum;
          if (definition.maximum !== undefined) input.max = definition.maximum;
        }
        if (definition.pattern) input.pattern = definition.pattern;
        if (definition.minLength !== undefined) input.minLength = definition.minLength;
      }
      input.id = unique;
      input.required = required.includes(key) || (prefix[0] === 'dailyReboot' && key === 'time' && object.dailyReboot?.enabled === true);
      input.addEventListener(input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input', () => {
        let next = input.type === 'checkbox' ? input.checked :
          input.type === 'number' ? (input.value === '' ? undefined : Number(input.value)) : input.value;
        setPath(object, path, next);
        if (['orientation', 'leftAngle', 'rightAngle'].includes(key)) {
          for (const diagram of document.querySelectorAll('.sun-angle-diagram')) diagram.updateDiagram();
        }
        if (key === 'id' && header) header.textContent = next || 'Neue ID';
        if (key === 'connection') {
          if (next === 'cloud' && object.dailyReboot) object.dailyReboot.enabled = false;
          renderSettings(object);
        }
        if (key === 'language') { applyLanguage(); renderSettings(); }
        if (prefix[0] === 'dailyReboot' && key === 'enabled') {
          if (next && !object.dailyReboot.time) object.dailyReboot.time = '03:00';
          renderSettings(object);
        }
        if (key === 'deviceType') {
          if (next === 'roller' && object.sunAutomation?.endBehavior === 'horizontal') object.sunAutomation.endBehavior = 'keep';
          renderSettings(object);
        }
        changed();
      });
      if (definition.type === 'boolean') {
        const text = el('div');
        text.append(label);
        if (definition.description) text.append(el('p', 'hint', definition.description));
        field.append(input, text);
      } else {
        field.append(label, input);
        if (definition.description) field.append(el('p', 'hint', definition.description));
      }
      container.append(field);
      if (prefix[0] === 'sunAutomation' && key === 'rightAngle') container.append(sunAngleDiagram(object));
    }
  }
  function angleHelpImage() {
    const language = ['de', 'en', 'fr', 'es'].includes(configuration()?.language) ? configuration().language : 'de';
    return 'nischenwinkel-' + language + '.png';
  }
  function openAngleHelp(opener) {
    const dialog = el('dialog', 'angle-help-dialog');
    dialog.setAttribute('aria-label', t('Erklärung: seitlicher Verbau'));
    const header = el('div', 'angle-help-header');
    const title = el('strong', '', 'Erklärung: seitlicher Verbau');
    const close = el('button', 'angle-help-close', 'Schließen');
    close.type = 'button';
    close.autofocus = true;
    let cleaned = false;
    const cleanup = () => { if (cleaned) return; cleaned = true; dialog.remove(); if (opener.isConnected) opener.focus(); };
    const dismiss = () => { dialog.close(); cleanup(); };
    close.addEventListener('click', dismiss);
    header.append(title, close);
    const image = el('img', 'angle-help-full');
    image.src = angleHelpImage();
    image.alt = t('Nischenbeispiel: Winkel zwischen Fensterausrichtung und vorderer Wandkante');
    dialog.append(header, image);
    dialog.addEventListener('click', event => { if (event.target === dialog) dismiss(); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    dialog.addEventListener('close', cleanup, { once: true });
    $('raffstore-app').append(dialog);
    dialog.showModal();
  }
  function sunAngleDiagram(device) {
    const wrap = el('figure', 'sun-angle-diagram');
    const caption = el('span', '', 'Sonnenbereich von innen nach außen betrachtet');
    const header = el('div', 'angle-diagram-header');
    const help = el('button', 'angle-help', undefined);
    help.type = 'button';
    help.setAttribute('aria-label', t('Nischenbeispiel vergrößern'));
    const preview = el('img');
    preview.src = angleHelpImage();
    preview.alt = '';
    preview.loading = 'lazy';
    help.append(preview, el('span', '', 'Nischenbeispiel vergrößern'));
    help.addEventListener('click', () => openAngleHelp(help));
    header.append(caption, help);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 420 240');
    svg.setAttribute('role', 'img');
    const node = (name, attrs, text) => {
      const item = document.createElementNS(svg.namespaceURI, name);
      for (const [key, value] of Object.entries(attrs)) item.setAttribute(key, value);
      if (text !== undefined) item.textContent = text;
      svg.append(item);
      return item;
    };
    wrap.updateDiagram = () => {
      const cfg = device.sunAutomation || {};
      const left = Math.max(0, Math.min(89, cfg.leftAngle ?? cfg.halfAngle ?? 80));
      const right = Math.max(0, Math.min(89, cfg.rightAngle ?? cfg.halfAngle ?? 80));
      svg.replaceChildren();
      svg.setAttribute('aria-label', t('Sonnenbereich links') + ' ' + left + '°, ' + t('Sonnenbereich rechts') + ' ' + right + '°');
      const point = angle => [210 + 130 * Math.sin(angle * Math.PI / 180), 175 - 130 * Math.cos(angle * Math.PI / 180)];
      const lp = point(-left), rp = point(right);
      node('path', {d: 'M210 175 L210 45 A130 130 0 0 0 ' + lp.join(' ') + ' Z', fill: '#6eb9ee', opacity: '.22'});
      node('path', {d: 'M210 175 L210 45 A130 130 0 0 1 ' + rp.join(' ') + ' Z', fill: '#bd91ff', opacity: '.22'});
      for (const [p, color] of [[lp, '#6eb9ee'], [rp, '#bd91ff']]) node('line', {x1:210,y1:175,x2:p[0],y2:p[1],stroke:color,'stroke-width':3});
      node('line', {x1:210,y1:175,x2:210,y2:40,stroke:'currentColor','stroke-width':2,'stroke-dasharray':'5 4'});
      node('path', {d:'M203 51 L210 40 L217 51',fill:'none',stroke:'currentColor','stroke-width':2});
      node('rect', {x:150,y:175,width:120,height:9,rx:3,fill:'currentColor'});
      const text = (x,y,value,color) => node('text', {x,y,'text-anchor':'middle',fill:color || 'currentColor','font-size':14}, value);
      text(210,22,t('Blick nach außen'));
      text(75,105,t('Links') + ' ' + left + '°','#6eb9ee');
      text(345,105,t('Rechts') + ' ' + right + '°','#bd91ff');
      text(210,207,t('Fensterausrichtung') + ': ' + (cfg.orientation ?? 166) + '°');
    };
    wrap.append(header, svg, el('p', 'hint', 'Kleinere Winkel begrenzen den Sonnenbereich auf der jeweiligen Seite. Die Fensterausrichtung bleibt unverändert. Gebäude und Hindernisse werden nicht automatisch erkannt.'));
    wrap.updateDiagram();
    return wrap;
  }
  function sortControls(id, name, targetNode, root) {
    const cfg = configuration();
    const order = new Map(cfg.devices.map((device, index) => [device.id, index]));
      const controls = el('div', 'sort-controls');
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', t('Reihenfolge ändern') + ': ' + name);
      for (const [direction, symbol, offset, label] of [['up', '↑', -1, 'Nach oben'], ['down', '↓', 1, 'Nach unten']]) {
        const button = el('button', 'move-' + direction, symbol, true);
        button.type = 'button';
        button.title = t(label);
        button.setAttribute('aria-label', t(label) + ': ' + name);
        const index = order.get(id);
        button.disabled = index === undefined || index + offset < 0 || index + offset >= cfg.devices.length;
        button.addEventListener('click', () => moveDevice(id, order.get(id) + offset, direction));
        controls.append(button);
      }
      const drag = el('button', 'drag-device', '⠿', true);
      drag.type = 'button';
      drag.draggable = true;
      drag.title = t('Zum Sortieren ziehen');
      drag.setAttribute('aria-label', t('Zum Sortieren ziehen') + ': ' + name);
      drag.addEventListener('dragstart', event => {
        event.dataTransfer.setData('application/x-raffstore-id', id);
        event.dataTransfer.effectAllowed = 'move';
        targetNode.classList.add('dragging');
      });
      drag.addEventListener('dragend', () => {
        for (const node of root.children) node.classList.remove('dragging', 'drop-target');
      });
      targetNode.addEventListener('dragover', event => {
        if (!event.dataTransfer.types.includes('application/x-raffstore-id')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        targetNode.classList.add('drop-target');
      });
      targetNode.addEventListener('dragleave', event => {
        if (!targetNode.contains(event.relatedTarget)) targetNode.classList.remove('drop-target');
      });
      targetNode.addEventListener('drop', event => {
        const draggedId = event.dataTransfer.getData('application/x-raffstore-id');
        if (!draggedId) return;
        event.preventDefault();
        const source = cfg.devices.findIndex(device => device.id === draggedId);
        const target = cfg.devices.findIndex(device => device.id === id);
        const rect = targetNode.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        const destination = target + (after ? 1 : 0) - (source < target + (after ? 1 : 0) ? 1 : 0);
        for (const node of root.children) node.classList.remove('dragging', 'drop-target');
        moveDevice(draggedId, destination);
      });
      controls.append(drag);

    for (const button of controls.querySelectorAll('button')) button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
    return controls;
  }
  function renderSettings(keepOpen) {
    const cfg = configuration();
    $('general-fields').replaceChildren();
    $('general-fields').closest('details').hidden=homebridge.zepraSharedSettings===true;
    if(!homebridge.zepraSharedSettings)renderFields($('general-fields'), schema.schema.properties, cfg);
    const root = $('settings-devices');
    root.replaceChildren();
    const definitions = schema.schema.properties.devices.items.properties;
    const order = ['id', 'deviceType', 'name', 'homekitEnabled', 'connection', 'cloudServer', 'cloudKey', 'cloudDeviceId', 'host', 'shellyDeviceId', 'coverId', 'password', 'separateSlatControl',
      'slatName', 'windProtection', 'positionWaitTimeout', 'positionTolerance', 'sunAutomation'];
    const ordered = Object.fromEntries([...order, ...Object.keys(definitions).filter(k => !order.includes(k))]
      .filter(k => definitions[k]).map(k => [k, definitions[k]]));
    for (const device of cfg.devices || []) {
      const details = el('details', 'device-settings');
      details.dataset.deviceId = device.id;
      const summary = el('summary');
      const heading = el('span', 'device-id', device.id || 'Neue ID', !!device.id);
      const copy = el('button', 'copy-device', '⧉', true);
      copy.type = 'button';
      copy.title = t('Gerät kopieren');
      copy.setAttribute('aria-label', t('Gerät kopieren') + ': ' + (device.id || t('Neue ID')));
      copy.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const clone = window.RaffstoreDeviceCopy.cloneDevice(device, cfg.devices, t('Kopie'));
        cfg.devices.splice(cfg.devices.indexOf(device) + 1, 0, clone);
        renderSettings(clone);
        changed();
      });
      const actions = el('span', 'device-actions');
      actions.append(sortControls(device.id, device.name || device.id, details, root), copy);
      summary.append(heading, actions);
      details.open = device === keepOpen;
      details.append(summary);
      const fields = el('div', 'fields');
      renderFields(fields, ordered, device, [], ['id', 'name', ...(device.connection === 'cloud' ? ['cloudServer', 'cloudKey', 'cloudDeviceId'] : ['host', 'shellyDeviceId'])], heading);
      details.append(fields);
      const remove = el('button', 'remove', 'Gerät entfernen');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        cfg.devices = cfg.devices.filter(d => d !== device);
        renderSettings();
        changed();
      });
      details.append(remove);
      root.append(details);
    }
  }
  const time = (stamp, zone) => new Intl.DateTimeFormat('de-DE', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(stamp));
  function stat(container, label, value) {
    const node = el('div', 'stat');
    node.append(el('span', 'label', label), el('strong', '', value));
    container.append(node);
  }
  let overviewData;
  function moveDevice(id, destination, focusDirection) {
    const devices = configuration().devices;
    const source = devices.findIndex(device => device.id === id);
    if (source < 0 || !Number.isInteger(destination) || destination < 0 || destination >= devices.length || source === destination) return;
    const expanded = new Set([...$('settings-devices').children].filter(node => node.open).map(node => node.dataset.deviceId));
    const [device] = devices.splice(source, 1);
    devices.splice(destination, 0, device);
    renderSettings();
    for (const node of $('settings-devices').children) node.open = expanded.has(node.dataset.deviceId);
    if (overviewData) renderOverview(overviewData);
    changed();
    if (focusDirection) {
      const card = [...$('settings-devices').children].find(node => node.dataset.deviceId === id);
      const button = card?.querySelector('.move-' + focusDirection);
      (button?.disabled ? card?.querySelector('.drag-device') : button)?.focus();
    }
  }
  function coverStateDiagram(row) {
    const state = row.state;
    const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
    const position = state?.online && valid(state.position) ? state.position : null;
    const hasSlats = row.deviceType !== 'roller';
    const slats = hasSlats && state?.online && valid(state.slatPosition) ? state.slatPosition : null;
    const figure = el('figure', 'cover-state-diagram');
    figure.dataset.position = position === null ? 'unknown' : position;
    figure.dataset.slats = hasSlats ? slats === null ? 'unknown' : slats : 'none';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', hasSlats ? '0 0 128 96' : '0 0 80 96');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', t('Aktuelle Stellung') + ': ' +
      (position === null ? t('Stellung unbekannt') : Math.round(position) + ' % ' + t('offen')) +
      (hasSlats ? ', ' + t('Lamellen') + ': ' + (slats === null ? t('Stellung unbekannt') : Math.round(slats) + ' %') : ''));
    const node = (tag, attrs, text) => {
      const item = document.createElementNS(svg.namespaceURI, tag);
      for (const [key,value] of Object.entries(attrs)) item.setAttribute(key, value);
      if (text !== undefined) item.textContent = text;
      svg.append(item);
      return item;
    };
    node('rect', { x:8,y:8,width:58,height:76,rx:3,fill:'none',stroke:'currentColor','stroke-width':2 });
    node('rect', { x:7,y:5,width:60,height:7,rx:2,fill:'currentColor' });
    if (position !== null) {
      const depth = 70 * (1 - position / 100);
      figure.dataset.depth = depth;
      node('rect', {x:11,y:12,width:52,height:depth,fill:'var(--purple)',opacity:'.28'});
      for (let y=12;y<12+depth;y+=7) {
        node('rect', {x:12,y,width:50,height:Math.min(2,12+depth-y),rx:1,fill:'var(--purple)',opacity:'.9'});
      }
      if (depth>0) node('line',{x1:11,y1:12+depth,x2:63,y2:12+depth,stroke:'var(--purple)','stroke-width':2});
    } else node('text',{x:37,y:53,'text-anchor':'middle',fill:'currentColor','font-size':22},'?');
    if (hasSlats) {
      if (slats !== null) {
        const packed = position !== null && position > 90;
        figure.dataset.packed = String(packed);
        const angle=packed ? 0 : (1-slats/100)*Math.PI/2;
        const dx=10*Math.cos(angle),dy=10*Math.sin(angle);
        figure.dataset.angle=packed ? 0 : 90*(1-slats/100);
        const top = packed ? 16 : 26, spacing = packed ? 6 : 22;
        for(const cy of [top,top+spacing,top+2*spacing]) node('line',{x1:100-dx,y1:cy+dy,x2:100+dx,y2:cy-dy,
          stroke:'var(--purple)','stroke-width':3,'stroke-linecap':'round',class:'slat-profile'});
      } else node('text',{x:100,y:53,'text-anchor':'middle',fill:'currentColor','font-size':22},'?');
    }
    figure.append(svg);
    return figure;
  }
  function statusIndicator(label, value, alarm = false) {
    const line = el('div', 'status-indicator');
    line.append(el('span', '', label));
    const dot = el('span', 'status-dot' + (value === true ? alarm ? ' active alarm' : ' active' : ''));
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', t(value === null ? 'unbekannt' : value ? 'Ein' : 'Aus'));
    line.append(dot);
    return line;
  }
  function openDeviceSettings(id) {
    const device = configuration().devices.find(value => String(value.id) === id);
    if (!device) return;
    renderSettings(device);
    chooseTab('settings');
    const target = [...$('settings-devices').children].find(value => value.dataset.deviceId === id);
    target?.querySelector('summary')?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }
  function renderOverview(data) {
    overviewData = data;
    const root = $('device-cards');
    root.replaceChildren();
    if (!data.rows.length) root.append(el('div', 'empty', 'Unter Einstellungen zuerst einen Raffstore oder Rollladen hinzufügen.'));
    $('day').value = data.date;
    const cfg = configuration();
    $('location').textContent = t('Standort') + ' ' + (cfg.latitude ?? 52.52) + '° N, ' + (cfg.longitude ?? 13.405) + '° E · ' + data.timeZone;
    const order = new Map(cfg.devices.map((device, index) => [device.id, index]));
    const rows = [...data.rows].sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
    for (const row of rows) {
      const card = el('article', 'card');
      card.dataset.deviceId = row.id;
      const head = el('div', 'card-head');
      head.append(el('h2', '', row.name, true));
      const actions = el('div', 'card-actions');
      const settings = el('button', 'device-settings-link', '⚙', true);
      settings.type = 'button';
      settings.setAttribute('aria-label', t('Einstellungen') + ': ' + row.name);
      settings.addEventListener('click', () => openDeviceSettings(row.id));
      actions.append(el('span', 'chip ' + row.status.kind, row.status.text), settings);
      head.append(actions);
      card.append(head, el('p', 'card-subtitle', row.id + ' · ' + t(row.deviceType === 'roller' ? 'Rollladen' : 'Raffstore') + ' · ' + t('Ausrichtung') + ' ' + row.orientation + '°'));
      const origins = { scene:'Scene', 'apple-home': 'Apple Home', solar: 'Sonnenautomatik', wind: 'Windalarm',
        'wind-recovery': 'Windalarm-Rückfahrt', external: 'Extern (z. B. Shelly App)', unknown: 'Noch keine Steuerung erfasst' };
      const connection = el('div', 'device-connection');
      const online = row.state?.online === true;
      const onlineDot = el('span', 'status-dot' + (online ? ' active' : ''));
      onlineDot.setAttribute('aria-hidden', 'true');
      connection.append(onlineDot, el('span', '', online ? 'Shelly online' : 'Shelly offline'));
      card.append(connection, el('p', 'last-control', t('Letzte Steuerung') + ': ' + t(origins[row.state?.lastControl?.source] || 'Noch keine Steuerung erfasst')));
      if (row.periodError) card.append(el('p', 'muted', 'Berechnung prüfen: ' + row.periodError));
      else {
        const period = row.period;
        const percent = stamp => 100 * (stamp - period.start) / (period.end - period.start);
        const timeline = el('div', 'timeline');
        timeline.setAttribute('role', 'img');
        timeline.setAttribute('aria-label', period.intervals.length ? t('Geplante Beschattungsperiode') + ': ' +
          period.intervals.map(p => time(p.start, data.timeZone) + ' bis ' + time(p.end, data.timeZone)).join(', ') : t('Heute keine Beschattungsperiode'));
        const track = el('div', 'track');
        for (const interval of period.intervals) {
          const bar = el('div', 'period');
          bar.style.left = percent(interval.start) + '%';
          bar.style.width = (percent(interval.end) - percent(interval.start)) + '%';
          bar.append(el('span', 'boundary', time(interval.start, data.timeZone)), el('span', 'boundary end', time(interval.end, data.timeZone)));
          track.append(bar);
        }
        for (let stamp = period.start; stamp < period.end; stamp += 3600000) {
          const label = time(stamp, data.timeZone);
          if (['00:00', '06:00', '12:00', '18:00'].includes(label)) {
            const tick = el('span', 'tick', label);
            tick.style.left = percent(stamp) + '%';
            timeline.append(tick);
          }
        }
        const last = el('span', 'tick', '24:00');
        last.style.left = '100%';
        timeline.append(last);
        if (data.now >= period.start && data.now < period.end) {
          const marker = el('div', 'now-marker');
          marker.style.left = percent(data.now) + '%';
          marker.append(el('span', '', 'Jetzt · ' + time(data.now, data.timeZone)));
          track.append(marker);
        }
        timeline.append(track);
        card.append(timeline);
        const stats = el('div', 'stats');
        stat(stats, 'Beginn', period.intervals.length ? time(period.intervals[0].start, data.timeZone) : '—');
        stat(stats, 'Ende', period.intervals.length ? time(period.intervals.at(-1).end, data.timeZone) : '—');
        stat(stats, 'Dauer', Math.floor(period.totalMinutes / 60) + ' Std. ' + period.totalMinutes % 60 + ' Min.');
        if (row.deviceType === 'roller') stat(stats, 'Beschattungshöhe', row.shadePosition + ' %');
        if (!period.intervals.length) stats.append(el('span', 'muted', 'An diesem Tag keine Beschattungsperiode.'));
        card.append(stats);
      }
      if (row.state?.recoveryDiagnostic?.target) {
        const d = row.state.recoveryDiagnostic;
        card.append(el('p', 'small muted',
          t('Rückfahrt Soll/Ist') + ': ' + t('Behang') + ' ' + d.target.pos + ' / ' + d.actual?.pos +
          ' %, ' + t('Lamellen') + ' ' + d.target.slat_pos + ' / ' + d.actual?.slat_pos + ' %'));
      }
      const states = el('div', 'states');
      const current = row.state;
      const switches = el('div', 'status-indicators');
      switches.append(statusIndicator('Automatik Beschattung', current?.online && current.automationConfigured ? current.automationEnabled : null));
      if (current?.automationConfigured) switches.append(statusIndicator('Automatik Pause', current.online ? current.manualPaused : null));
      if (row.windConfigured) switches.append(statusIndicator('Windalarm', current?.online ? current.windAlarm : null, true));
      states.append(switches);
      if (current?.online) {
        const readings = el('div', 'position-readings');
        readings.append(el('span', 'height-reading', t('Behang') + ' ' + Math.round(current.position) + ' %'));
        if (row.deviceType !== 'roller') readings.append(el('span', 'slat-reading', t('Lamellen') + ' ' + Math.round(current.slatPosition) + ' %'));
        states.append(readings);
        if (current.pendingUntil > data.now) states.append(el('span', '', t(current.pendingAction === 'end' ? 'Geplantes Ende' : 'Geplanter Start') + ' ' + time(current.pendingUntil, data.timeZone)));
        if (current.pausedUntil > data.now) states.append(el('span', '', 'Pause bis ' + time(current.pausedUntil, data.timeZone)));
      }
      const footer = el('div', 'card-footer');
      const details = el('div', 'footer-status');
      details.append(states);
      footer.append(details, coverStateDiagram(row));
      card.append(footer);
      root.append(card);
    }
  }
  async function refresh() {
    if (!ready || tab !== 'overview' || loading) return;
    loading = true;
    $('refresh').disabled = true;
    try {
      const data = await homebridge.request('/overview', { config: configuration(), date: $('day').value || undefined });
      renderOverview(data);
      message('');
    } catch (error) { message('Tagesübersicht nicht verfügbar: ' + (error.message || 'Bitte Homebridge nach dem Update neu starten. Einstellungen bleiben erreichbar.')); }
    finally { loading = false; $('refresh').disabled = false; }
  }
  function chooseTab(next) {
    tab = next;
    for (const name of ['overview', 'settings']) {
      $('tab-' + name).classList.toggle('selected', name === next);
      $('tab-' + name).setAttribute('aria-selected', String(name === next));
      $(name + '-panel').hidden = name !== next;
    }
    if (next === 'overview') refresh();
  }
  const staticTexts = new Map();
  function applyLanguage() {
    if (!staticTexts.size) {
      const walk = document.createTreeWalker($('raffstore-app'), NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walk.nextNode())) if (node.textContent.trim()) staticTexts.set(node, node.textContent.trim());
    }
    for (const [node, text] of staticTexts) if (node.isConnected) node.textContent = t(text);
  }
  async function initialize() {
    try {
      blocks = await homebridge.getPluginConfig();
      schema = await homebridge.getPluginConfigSchema();
      if (!blocks.length) blocks.push({ platform: 'ShellyRaffstore', name: 'Shelly Raffstore', devices: [] });
      if (!Array.isArray(configuration().devices)) {
        if (configuration().devices === undefined) configuration().devices = [];
        else throw new Error('Die vorhandene Geräteliste ist ungültig.');
      }
      const theme = await homebridge.userCurrentLightingMode?.();
      document.documentElement.dataset.raffstoreTheme = theme || 'dark';
      applyLanguage();
      renderSettings();
      ready = true;
      $('tab-overview').addEventListener('click', () => chooseTab('overview'));
      $('tab-settings').addEventListener('click', () => chooseTab('settings'));
      $('refresh').addEventListener('click', refresh);
      $('day').addEventListener('change', refresh);
      $('add-device').addEventListener('click', () => {
        const device = { id: '', name: '', host: '', shellyDeviceId: '', deviceType: 'raffstore', coverId: 0 };
        configuration().devices.push(device);
        renderSettings(device);
        changed();
      });
      if (!validConfig()) homebridge.disableSaveButton();
      await refresh();
      setInterval(() => { if (!document.hidden) refresh(); }, 10000);
    } catch (error) {
      message('Eigene Oberfläche konnte nicht geladen werden: ' + error.message);
      homebridge.showSchemaForm();
    }
  }
  homebridge.addEventListener('ready', initialize, { once: true });
})();
