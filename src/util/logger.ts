'use strict';

import pino from 'pino';

// LOG_LEVEL controls verbosity: trace | debug | info | warn | error
//   trace  - raw hex bytes for every BLE packet
//   debug  - every BLE command sent/received, step-by-step operation traces
//   info   - connection events, lock state changes (default)
//   warn   - CRC errors, failed connect attempts
//   error  - operation failures
//
// Falls back to 'debug' if the legacy TTLOCK_DEBUG_COMM or MQTT_DEBUG env vars are set.
const level = process.env.LOG_LEVEL ??
  (process.env.TTLOCK_DEBUG_COMM === '1' || process.env.MQTT_DEBUG === '1' ? 'debug' : 'info');

export const logger = pino({
  level,
  base: null, // omit pid and hostname
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: false,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
      ignore: 'pid,hostname',
    },
  },
});
