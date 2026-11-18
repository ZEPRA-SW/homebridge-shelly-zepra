'use strict';
// Sanitized read-only replies from Wall Display and XL, firmware 2.8.4.
module.exports={
  "xl": {
    "gen": 2,
    "info": {
      "id": "ShellyWallDisplay-aabbccddeeff",
      "mac": "AABBCCDDEEFF",
      "gen": 2,
      "app": "WallDisplayV2",
      "ver": "2.8.4"
    },
    "status": {
      "temperature:0": {
        "id": 0,
        "tC": -275.1499938964844,
        "tF": -463,
        "errors": [
          "Sensor driver missing from firmware"
        ]
      },
      "humidity:0": {
        "id": 0,
        "rh": -2,
        "errors": [
          "Sensor driver missing from firmware"
        ]
      },
      "illuminance:0": {
        "id": 0,
        "lux": 11,
        "illumination": "dark"
      },
      "motion:0": {
        "id": 0,
        "motion": false
      },
      "switch:0": {
        "id": 0,
        "output": false,
        "source": "RPC Set"
      },
      "input:0": {
        "id": 0,
        "state": false
      },
      "input:1": {
        "id": 1,
        "state": false
      },
      "input:2": {
        "id": 2,
        "state": false
      },
      "input:3": {
        "id": 3,
        "state": false
      },
      "input:4": {
        "id": 4,
        "state": false
      },
      "thermostat:0": {
        "id": 0,
        "enable": true,
        "target_C": 22,
        "target_F": 72,
        "current_C": 21.9,
        "current_F": 71,
        "output": true,
        "errors": [],
        "schedules": {
          "enable": false
        }
      }
    },
    "settings": {
      "thermostat:0": {
        "type": "heating",
        "display_unit": "C"
      }
    }
  },
  "standard": {
    "gen": 2,
    "info": {
      "id": "ShellyWallDisplay-aabbccddeeff",
      "mac": "AABBCCDDEEFF",
      "gen": 2,
      "app": "WallDisplay",
      "ver": "2.8.4"
    },
    "status": {
      "temperature:0": {
        "id": 0,
        "tC": 21.9,
        "tF": 71
      },
      "humidity:0": {
        "id": 0,
        "rh": 34.6
      },
      "illuminance:0": {
        "id": 0,
        "lux": 5,
        "illumination": "dark"
      },
      "switch:0": {
        "id": 0,
        "output": false,
        "source": "Auto power on (restore_last)"
      },
      "input:0": {
        "id": 0,
        "state": false
      },
      "thermostat:0": {
        "id": 0,
        "enable": true,
        "target_C": 21.5,
        "target_F": 71,
        "current_C": 21.9,
        "current_F": 71,
        "output": false,
        "errors": [],
        "schedules": {
          "enable": false
        }
      }
    },
    "settings": {
      "thermostat:0": {
        "type": "heating",
        "display_unit": "C"
      }
    }
  }
};
