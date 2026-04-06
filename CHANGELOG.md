# Changelog

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
