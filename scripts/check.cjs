'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

assert(pkg.keywords.includes('homebridge-plugin'), 'Missing homebridge-plugin keyword');
assert(pkg.keywords.includes('supports-hap'), 'Declare the HomeKit transport with supports-hap');
assert.equal(lock.version, pkg.version, 'Package and lockfile versions must match');
assert.equal(lock.packages[''].version, pkg.version, 'Root lockfile version must match');
assert(pkg.devDependencies?.homebridge, 'Keep Homebridge available for development tests');
for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies']) {
  const dependencies = pkg[field] ?? {};
  for (const name of ['homebridge', 'hap-nodejs', '@homebridge/hap-nodejs']) {
    const contains = Array.isArray(dependencies) ? dependencies.includes(name) : Object.hasOwn(dependencies, name);
    assert(!contains, `${name} must not be in ${field}; use the Homebridge host`);
  }
}
assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies, 'Runtime dependencies must match the lockfile');
assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies, 'Development dependencies must match the lockfile');
assert.deepEqual(lock.packages[''].peerDependencies, pkg.peerDependencies, 'Peer dependencies must match the lockfile');
console.log('Homebridge package metadata checks passed.');

function files(p) {
  if (fs.statSync(p).isDirectory()) return fs.readdirSync(p).flatMap(name => files(path.join(p, name)));
  return /\.(js|cjs)$/.test(p) ? [p] : [];
}
for (const name of ['index.js', 'lib', 'scripts', 'homebridge-ui', 'engines/universal/index.js', 'engines/universal/lib', 'engines/shading/index.js', 'engines/shading/lib']) {
  for (const file of files(path.join(root, name))) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      console.error(result.stderr || result.error || 'Syntax check failed');
      process.exit(1);
    }
  }
}
console.log('Syntaxpruefung bestanden.');
