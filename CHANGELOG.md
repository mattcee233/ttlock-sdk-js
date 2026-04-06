# Changelog

## 0.4.11
- Re-enable `COMM_INITIALIZATION` (0x45) for V3 locks: the command acts as a required session-start handshake for all lock types. Without it, V3 locks misinterpret `COMM_GET_AES_KEY` and respond with an unintended admin-delete action instead of providing the AES key. The previous 11 s disconnect (which led to disabling this) was caused by the slow service `1800` GATT read that has since been removed

## 0.4.10
- Fix `readBasicInfo()` causing HCI error 19 (Remote User Terminated) on locks in setting mode: skip GATT service `1800` (Device Name) — this read is not done by the reference Android SDK and burns ~0.5s before any protocol commands, exceeding the lock's short setting-mode connection timer
- Make service `180a` (Device Information) reads resilient: if the lock disconnects mid-read, firmware/model stay as `"unknown"` and connection proceeds rather than throwing up to the caller
- Wrap `readBasicInfo()` call in `TTBluetoothDevice.connect()` to prevent an uncaught exception propagating all the way to `_connectLock` when the lock disconnects during device-info reads

## 0.4.9
- Fix `initLock()` failing immediately on V3 locks: `COMM_INITIALIZATION` (0x45) is not part of the V3 protocol — sending it causes the lock to terminate the BLE connection. The command is now skipped for `LOCK_TYPE_V3` and `LOCK_TYPE_V3_CAR`; the init sequence goes straight to `COMM_GET_AES_KEY` as the Android SDK does

## 0.4.8
- Fix connection retry loop stumbling on stale BLE link: after the 15-second `connect()` initialisation timeout (e.g. lock ignores `COMM_CHECK_ADMIN` because stored keys are stale post-reset), explicitly disconnect the still-live BLE link before returning `false` so the next retry reconnects cleanly
- Fix `onConnected()` detecting a factory-reset lock: if the device is advertising `isSettingMode=true` but we have stored credentials, skip the doomed admin-auth and emit `connected` immediately with a warning — the manager can then re-initialize the lock instead of wasting 15 s per attempt

## 0.4.7
- Fix pino v9 strict TypeScript overload errors: replace all `log.debug/error("label:", value)` and `log.debug("text %o", value)` patterns with template literals or structured `{ key: value }` objects across TTLock.ts, TTLockApi.ts, Command.ts, UnknownCommand.ts, OperationLogCommand.ts, NobleDescriptor.ts, NobleDevice.ts, NobleWebsocketBinding.ts
- Fix syntax bug in TTLock.ts: missing closing parenthesis inside AES key template literal
- Fix variable shadowing in OperationLogCommand.ts: local `log: LogEntry` loop variable renamed to `entry` to avoid collision with module-level pino logger

## 0.4.6
- Replace all `console.log/error/warn` calls with [pino](https://github.com/pinojs/pino) structured logging
- Added `src/util/logger.ts`: single pino logger with pino-pretty transport; exported from index as `logger`
- Log level controlled by `LOG_LEVEL` env var (default `info`). Values: `trace` (raw hex), `debug` (every BLE command), `info` (connection events), `warn`, `error`
- Legacy `TTLOCK_DEBUG_COMM=1` / `MQTT_DEBUG=1` still imply `debug` if `LOG_LEVEL` is not set
- BLE logs include device address in every line via pino child context (`BLE/<addr>`)
- Lock operation logs include lock address via pino child getter (`Lock/<addr>`)
- CRC errors now logged as structured warn: `{ expected, got }` fields
- `trace` level adds raw BLE hex bytes (TX/RX)

## 0.4.5
- Fix lock disconnecting on reconnect: `onConnected()` now calls `macro_adminLogin()` (COMM_CHECK_ADMIN + COMM_CHECK_RANDOM) before `searchDeviceFeatureCommand()`. On reconnect the lock requires admin re-authentication before accepting commands; skipping it caused the lock to drop the BLE connection.

## 0.4.4
- Expand communication debug (TTLOCK_DEBUG_COMM=1): log command type names for TX/RX, retry count, wait time, raw hex with length, device info on connect, unsolicited notifications
- Fix CRC error visibility: bad CRC always logged as console.warn with [CRC ERROR] prefix and 0x notation, indicating if IGNORE_CRC is suppressing the error
- Import CommandType in TTBluetoothDevice for human-readable command names in debug output

## 0.4.3
- Fix MODULE_NOT_FOUND on startup: @stoprocent/noble removed the `with-bindings` sub-path; use `lib/noble` directly to get the Noble constructor for custom bindings

## 0.4.2
- Fix TS2503: import Peripheral type directly from @stoprocent/noble instead of using nobleObj namespace

## 0.4.1
- Fix syntax error in InitPasswordsCommand.ts (stray extra `}` after class body caused TS1128 build failure)

## 0.4.0
- Replace @abandonware/noble with @stoprocent/noble for Node.js 18/20/22 compatibility
- Fix critical bug: LOCK_TYPE_SAFE enum value was 8, same as LOCK_TYPE_V3_CAR — changed LOCK_TYPE_SAFE to 14 to prevent incorrect LockVersion resolution for Safe locks
- Update TypeScript to v5.x
- Update @types/node to Node.js 20 types
- Update ws to v8.x
- Update tsconfig to target Node.js 22

## 0.3.19
- Update to @tsconfig/node20 compatibility preparation

## 0.3.18
- Update CheckUserTimeCommand to use 12-character date strings (YYMMDDHHmmss)
- Fix CheckUserTimeCommand buffer offsets to prevent data overlap

## 0.3.17
- Fix connection timeouts and state management in NobleDevice
- Ensure response buffer is cleared on disconnection in TTBluetoothDevice
- Increase default connection timeout to 15s

## 0.3.16
- Incorporate additional lock types (Safe, Bicycle, Gate, Padlock, Cylinder, Remote Control)
- Add protocol detection logic for Safe and Bicycle locks

## 0.3.15
- Update UnlockCommand and LockCommand to use YYMMDDHHmmss date format
- Update AddAdminCommand generateNumber to 9 digits
- Update PassageModeCommand to support multiple days via bitmask
- Update TTLock.lock() and TTLock.unlock() to return UnlockDataInterface
- Add uniqueid to TTLockData and state tracking
- Fix TypeScript compilation errors in TTDevice.ts
