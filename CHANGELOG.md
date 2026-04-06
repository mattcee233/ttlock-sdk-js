# Changelog

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
