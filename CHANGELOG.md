# Changelog

## 0.3.15
- Update UnlockCommand and LockCommand to use YYMMDDHHmmss date format
- Update AddAdminCommand generateNumber to 9 digits
- Update PassageModeCommand to support multiple days via bitmask
- Update TTLock.lock() and TTLock.unlock() to return UnlockDataInterface
- Add uniqueid to TTLockData and state tracking
- Fix TypeScript compilation errors in TTDevice.ts
