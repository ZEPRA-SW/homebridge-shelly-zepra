'use strict';
// Run the complete integration suite against the real Homebridge 2 API in
// this isolated Node test process, as well as the default Homebridge 1 run.
process.env.SHELLY_HOMEBRIDGE_VERSION='2';
require('./platform.test');
