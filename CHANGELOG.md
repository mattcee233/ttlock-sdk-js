# Changelog

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
