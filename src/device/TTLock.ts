'use strict';

import { CommandEnvelope } from "../api/CommandEnvelope";
import { Fingerprint, ICCard, KeyboardPassCode, LogEntry, PassageModeData, UnlockDataInterface } from "../api/Commands";
import { CodeSecret } from "../api/Commands/InitPasswordsCommand";
import { AudioManage } from "../constant/AudioManage";
import { ConfigRemoteUnlock } from "../constant/ConfigRemoteUnlock";
import { FeatureValue } from "../constant/FeatureValue";
import { KeyboardPwdType } from "../constant/KeyboardPwdType";
import { LockType } from "../constant/Lock";
import { LockedStatus } from "../constant/LockedStatus";
import { PassageModeOperate } from "../constant/PassageModeOperate";
import { TTLockData, TTLockPrivateData } from "../store/TTLockData";
import { sleep } from "../util/timingUtil";
import { TTBluetoothDevice } from "./TTBluetoothDevice";
import { logger } from "../util/logger";
import { LockParamsChanged, TTLockApi } from "./TTLockApi";

export interface TTLock {
  /** Event used by TTLockClient to update it's internal lock data */
  on(event: "dataUpdated", listener: (lock: TTLock) => void): this;
  on(event: "updated", listener: (lock: TTLock, paramsChanged: LockParamsChanged) => void): this;
  on(event: "lockReset", listener: (address: string, id: string) => void): this;
  on(event: "connected", listener: (lock: TTLock) => void): this;
  on(event: "disconnected", listener: (lock: TTLock) => void): this;
  on(event: "locked", listener: (lock: TTLock) => void): this;
  on(event: "unlocked", listener: (lock: TTLock) => void): this;
  /** Emited when an IC Card is ready to be scanned */
  on(event: "scanICStart", listener: (lock: TTLock) => void): this;
  /** Emited when a fingerprint is ready to be scanned */
  on(event: "scanFRStart", listener: (lock: TTLock) => void): this;
  /** Emited after each fingerprint scan */
  on(event: "scanFRProgress", listener: (lock: TTLock) => void): this;
}

export class TTLock extends TTLockApi implements TTLock {
  private connected: boolean;
  private skipDataRead: boolean = false;
  private get log() { return logger.child({ name: `Lock/${this.device?.address || 'unknown'}` }); }
  private connecting: boolean = false;

  constructor(device: TTBluetoothDevice, data?: TTLockData) {
    super(device, data);
    this.connected = false;

    this.device.on("connected", this.onConnected.bind(this));
    this.device.on("disconnected", this.onDisconnected.bind(this));
    this.device.on("updated", this.onTTDeviceUpdated.bind(this));
    this.device.on("dataReceived", this.onDataReceived.bind(this));
  }

  getAddress(): string {
    return this.device.address;
  }

  getName(): string {
    return this.device.name;
  }

  getManufacturer(): string {
    return this.device.manufacturer;
  }

  getModel(): string {
    return this.device.model;
  }

  getFirmware(): string {
    return this.device.firmware;
  }

  getBattery(): number {
    return this.batteryCapacity;
  }

  getRssi(): number {
    return this.rssi;
  }

  async connect(skipDataRead: boolean = false, timeout: number = 15): Promise<boolean> {
    if (this.connecting) {
      this.log.warn("Connect already in progress");
      return false;
    }
    if (this.connected) {
      return true;
    }
    this.connecting = true;
    this.skipDataRead = skipDataRead;
    const connected = await this.device.connect();
    let timeoutCycles = timeout * 10;
    if (connected) {
      this.log.debug("Waiting for connection to complete");
      do {
        await sleep(100);
        timeoutCycles--;
      } while (!this.connected && timeoutCycles > 0 && this.connecting);
    } else {
      this.log.warn("Lock connect failed");
    }
    this.skipDataRead = false;
    this.connecting = false;
    // if we timed out while BLE is still physically connected (e.g. lock ignored our command
    // because stored keys are stale after a lock reset), disconnect cleanly so the next
    // retry attempt starts from a fresh connection rather than reusing a half-broken link.
    if (!this.connected && this.device.connected) {
      this.log.warn("Connection initialisation timed out, disconnecting BLE link");
      await this.device.disconnect();
    }
    return this.connected;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    await this.device.disconnect();
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isPaired(): boolean {
    const privateData = this.privateData;
    if (privateData.aesKey && privateData.admin && privateData.admin.adminPs && privateData.admin.unlockKey) {
      return true;
    } else {
      return false;
    }
  }

  hasLockSound(): boolean {
    if (typeof this.featureList != "undefined" && this.featureList.has(FeatureValue.AUDIO_MANAGEMENT)) {
      return true;
    }
    return false;
  }

  hasPassCode(): boolean {
    if (typeof this.featureList != "undefined" && this.featureList.has(FeatureValue.PASSCODE)) {
      return true;
    }
    return false;
  }

  hasICCard(): boolean {
    if (typeof this.featureList != "undefined" && this.featureList.has(FeatureValue.IC)) {
      return true;
    }
    return false;
  }

  hasFingerprint(): boolean {
    if (typeof this.featureList != "undefined" && this.featureList.has(FeatureValue.FINGER_PRINT)) {
      return true;
    }
    return false;
  }

  hasAutolock(): boolean {
    if (typeof this.featureList != "undefined" && this.featureList.has(FeatureValue.AUTO_LOCK)) {
      return true;
    }
    return false;
  }

  hasNewEvents(): boolean {
    return this.newEvents;
  }

  /**
   * Initialize and pair with a new lock
   */
  async initLock(): Promise<boolean> {
    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    if (this.initialized) {
      throw new Error("Lock is not in pairing mode");
    }

    // TODO: also check if lock is already inited (has AES key)

    try {
      // COMM_INITIALIZATION (0x45) is only used by older V1/V2 protocol locks.
      // V3 locks do not respond to it and will disconnect — skip it for V3/V3_CAR.
      if (this.device.lockType !== LockType.LOCK_TYPE_V3 && this.device.lockType !== LockType.LOCK_TYPE_V3_CAR) {
        this.log.debug("init");
        await this.initCommand();
        this.log.debug("init");
      }

      // Get AES key
      this.log.debug("AES key");
      const aesKey = await this.getAESKeyCommand();
      this.log.debug(`AES key: ${aesKey.toString("hex")}`);

      // Add admin
      this.log.debug("admin");
      const admin = await this.addAdminCommand(aesKey);
      this.log.debug(`admin: ${admin}`);

      // Calibrate time
      // this seems to fail on some locks
      // see https://github.com/kind3r/hass-addons/issues/11
      try {
        this.log.debug("time");
        await this.calibrateTimeCommand(aesKey);
        this.log.debug("time");
      } catch (error) {
        this.log.error(error, "Unexpected error");
      }

      // Search device features
      this.log.debug("feature list");
      const featureList = await this.searchDeviceFeatureCommand(aesKey);
      this.log.debug(`feature list: ${featureList}`);

      let switchState: any,
        lockSound: AudioManage.TURN_ON | AudioManage.TURN_OFF | undefined,
        displayPasscode: 0 | 1 | undefined,
        autoLockTime: number | undefined,
        lightingTime: number | undefined,
        adminPasscode: string | undefined,
        pwdInfo: CodeSecret[] | undefined,
        remoteUnlock: ConfigRemoteUnlock.OP_OPEN | ConfigRemoteUnlock.OP_CLOSE | undefined;

      // Feature depended queries
      // if (featureList.has(FeatureValue.RESET_BUTTON)
      //   || featureList.has(FeatureValue.TAMPER_ALERT)
      //   || featureList.has(FeatureValue.PRIVACK_LOCK)) {
      //   this.log.debug("switchState");
      //   switchState = await this.getSwitchStateCommand(undefined, aesKey);
      //   this.log.debug(`switchState: ${switchState}`);
      // }
      if (featureList.has(FeatureValue.AUDIO_MANAGEMENT)) {
        this.log.debug("lockSound");
        try {
          lockSound = await this.audioManageCommand(undefined, aesKey);
        } catch (error) {
          // this sometimes fails
          this.log.error(error, "Unexpected error");
        }
        this.log.debug(`lockSound: ${lockSound}`);
      }
      if (featureList.has(FeatureValue.PASSWORD_DISPLAY_OR_HIDE)) {
        this.log.debug("displayPasscode");
        displayPasscode = await this.screenPasscodeManageCommand(undefined, aesKey);
        this.log.debug(`displayPasscode: ${displayPasscode}`);
      }
      if (featureList.has(FeatureValue.AUTO_LOCK)) {
        this.log.debug("autoLockTime");
        autoLockTime = await this.searchAutoLockTimeCommand(undefined, aesKey);
        this.log.debug(`autoLockTime: ${autoLockTime}`);
      }
      // if (featureList.has(FeatureValue.LAMP)) {
      //   this.log.debug("lightingTime");
      //   lightingTime = await this.controlLampCommand(undefined, aesKey);
      //   this.log.debug(`lightingTime: ${lightingTime}`);
      // }
      if (featureList.has(FeatureValue.GET_ADMIN_CODE)) {
        // Command.COMM_GET_ADMIN_CODE
        this.log.debug("getAdminCode");
        adminPasscode = await this.getAdminCodeCommand(aesKey);
        this.log.debug(`getAdminCode: ${adminPasscode}`);
        if (adminPasscode == "") {
          this.log.debug("set adminPasscode");
          adminPasscode = await this.setAdminKeyboardPwdCommand(undefined, aesKey);
          this.log.debug(`set adminPasscode: ${adminPasscode}`);
        }
      } else if (this.device.lockType == LockType.LOCK_TYPE_V3_CAR) {
        // Command.COMM_GET_ALARM_ERRCORD_OR_OPERATION_FINISHED
      } else if (this.device.lockType == LockType.LOCK_TYPE_V3) {
        this.log.debug("set adminPasscode");
        adminPasscode = await this.setAdminKeyboardPwdCommand(undefined, aesKey);
        this.log.debug(`set adminPasscode: ${adminPasscode}`);
      }

      // this.log.debug("init passwords");
      // pwdInfo = await this.initPasswordsCommand(aesKey);
      // this.log.debug(`init passwords: ${pwdInfo}`);

      if (featureList.has(FeatureValue.CONFIG_GATEWAY_UNLOCK)) {
        this.log.debug("remoteUnlock");
        remoteUnlock = await this.controlRemoteUnlockCommand(undefined, aesKey);
        this.log.debug(`remoteUnlock: ${remoteUnlock}`);
      }

      this.log.debug("finished");
      await this.operateFinishedCommand(aesKey);
      this.log.debug("finished");

      // save all the data we gathered during init sequence
      if (aesKey) this.privateData.aesKey = Buffer.from(aesKey);
      if (admin) this.privateData.admin = admin;
      if (featureList) this.featureList = featureList;
      if (switchState) this.switchState = switchState;
      if (lockSound) this.lockSound = lockSound;
      if (displayPasscode) this.displayPasscode = displayPasscode;
      if (autoLockTime) this.autoLockTime = autoLockTime;
      if (lightingTime) this.lightingTime = lightingTime;
      if (adminPasscode) this.privateData.adminPasscode = adminPasscode;
      if (pwdInfo) this.privateData.pwdInfo = pwdInfo;
      if (remoteUnlock) this.remoteUnlock = remoteUnlock;
      this.lockedStatus = LockedStatus.LOCKED; // always locked by default

      // read device information
      this.log.debug("device info");
      try {
        this.deviceInfo = await this.macro_readAllDeviceInfo(aesKey);
      } catch (error) {
        // this sometimes fails
        this.log.error(error, "Unexpected error");
      }
      this.log.debug(`device info: ${this.deviceInfo}`);

    } catch (error) {
      this.log.error({ err: error }, "Error while initialising lock");
      return false;
    }

    // TODO: we should now refresh the device's data (disconnect and reconnect maybe ?)
    this.initialized = true;
    this.emit("dataUpdated", this);
    return true;
  }

  /**
   * Lock the lock
   */
  async lock(): Promise<UnlockDataInterface | false> {
    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    try {
      this.log.debug("check user time");
      const psFromLock = await this.checkUserTime();
      this.log.debug(`check user time: ${psFromLock}`);
      this.log.debug("lock");
      const lockData = await this.lockCommand(psFromLock);
      this.log.debug(`lock: ${lockData}`);
      this.lockedStatus = LockedStatus.LOCKED;
      this.emit("locked", this);
      return lockData;
    } catch (error) {
      this.log.error({ err: error }, "Error locking the lock");
      return false;
    }
  }

  /**
   * Unlock the lock
   */
  async unlock(): Promise<UnlockDataInterface | false> {
    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    try {
      this.log.debug("check user time");
      const psFromLock = await this.checkUserTime();
      this.log.debug(`check user time: ${psFromLock}`);
      this.log.debug("unlock");
      const unlockData = await this.unlockCommand(psFromLock);
      this.log.debug(`unlock: ${unlockData}`);
      this.lockedStatus = LockedStatus.UNLOCKED;
      this.emit("unlocked", this);
      // if autolock is on, then emit locked event after the timeout has passed
      if (this.autoLockTime > 0) {
        setTimeout(() => {
          this.lockedStatus = LockedStatus.LOCKED;
          this.emit("locked", this);
        }, this.autoLockTime * 1000);
      }
      return unlockData;
    } catch (error) {
      this.log.error({ err: error }, "Error unlocking the lock");
      return false;
    }
  }

  /**
   * Get the status of the lock (locked or unlocked)
   */
  async getLockStatus(noCache: boolean = false): Promise<LockedStatus> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    const oldStatus = this.lockedStatus;

    if (noCache || this.lockedStatus == LockedStatus.UNKNOWN) {
      if (!this.isConnected()) {
        throw new Error("Lock is not connected");
      }

      try {
        this.log.debug("check lock status");
        this.lockedStatus = await this.searchBycicleStatusCommand();
        this.log.debug(`check lock status: ${this.lockedStatus}`);
      } catch (error) {
        this.log.error({ err: error }, "Error getting lock status");
      }

    }

    if (oldStatus != this.lockedStatus) {
      if (this.lockedStatus == LockedStatus.LOCKED) {
        this.emit("locked", this);
      } else {
        this.emit("unlocked", this);
      }
    }

    return this.lockedStatus;
  }

  async getAutolockTime(noCache: boolean = false): Promise<number> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    const oldAutoLockTime = this.autoLockTime;

    if (noCache || this.autoLockTime == -1) {
      if (typeof this.featureList != "undefined") {
        if (this.featureList.has(FeatureValue.AUTO_LOCK)) {
          if (!this.isConnected()) {
            throw new Error("Lock is not connected");
          }

          try {
            if (await this.macro_adminLogin()) {
              this.log.debug("autoLockTime");
              this.autoLockTime = await this.searchAutoLockTimeCommand();
              this.log.debug(`autoLockTime: ${this.autoLockTime}`);
            }
          } catch (error) {
            this.log.error(error, "Unexpected error");
          }
        }
      }
    }

    if (oldAutoLockTime != this.autoLockTime) {
      this.emit("dataUpdated", this);
    }

    return this.autoLockTime;
  }

  async setAutoLockTime(autoLockTime: number): Promise<boolean> {
    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (this.autoLockTime != autoLockTime) {
      if (typeof this.featureList != "undefined") {
        if (this.featureList.has(FeatureValue.AUTO_LOCK)) {
          try {
            if (await this.macro_adminLogin()) {
              this.log.debug("autoLockTime");
              await this.searchAutoLockTimeCommand(autoLockTime);
              this.log.debug("autoLockTime");
              this.autoLockTime = autoLockTime;
              this.emit("dataUpdated", this);
              return true;
            }
          } catch (error) {
            this.log.error(error, "Unexpected error");
          }
        }
      }
    }

    return false;
  }

  async getLockSound(noCache: boolean = false): Promise<AudioManage> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    const oldSound = this.lockSound;

    if (noCache || this.lockSound == AudioManage.UNKNOWN) {
      if (typeof this.featureList != "undefined" && this.featureList.has(FeatureValue.AUDIO_MANAGEMENT)) {
        if (!this.isConnected()) {
          throw new Error("Lock is not connected");
        }

        try {
          this.log.debug("lockSound");
          this.lockSound = await this.audioManageCommand();
          this.log.debug(`lockSound: ${this.lockSound}`);

        } catch (error) {
          this.log.error({ err: error }, "Error getting lock sound status");
        }
      }
    }

    if (oldSound != this.lockSound) {
      this.emit("dataUpdated", this);
    }

    return this.lockSound;
  }

  async setLockSound(lockSound: AudioManage.TURN_ON | AudioManage.TURN_OFF): Promise<boolean> {
    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (this.lockSound != lockSound) {
      if (typeof this.featureList != "undefined" && this.featureList.has(FeatureValue.AUDIO_MANAGEMENT)) {
        try {
          if (await this.macro_adminLogin()) {
            this.log.debug("lockSound");
            this.lockSound = await this.audioManageCommand(lockSound);
            this.log.debug(`lockSound: ${this.lockSound}`);
            this.emit("dataUpdated", this);
            return true;
          }
        } catch (error) {
          this.log.error(error, "Unexpected error");
        }
      }
    }

    return false;
  }

  async resetLock(): Promise<boolean> {
    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    try {
      if (await this.macro_adminLogin()) {
        this.log.debug("reset");
        await this.resetLockCommand();
        this.log.debug("reset");
      } else {
        return false;
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while reseting the lock");
      return false;
    }

    await this.disconnect();
    this.emit("lockReset", this.device.address, this.device.id);
    return true;
  }

  async getPassageMode(): Promise<PassageModeData[]> {
    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    let data: PassageModeData[] = [];

    try {
      if (await this.macro_adminLogin()) {
        let sequence = 0;
        do {
          this.log.debug("get passage mode");
          const response = await this.getPassageModeCommand(sequence);
          this.log.debug(`get passage mode: ${response}`);
          sequence = response.sequence;
          response.data.forEach((passageData) => {
            data.push(passageData);
          });
        } while (sequence != -1);
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while getting passage mode");
    }

    return data;
  }

  async setPassageMode(data: PassageModeData): Promise<boolean> {
    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    try {
      if (await this.macro_adminLogin()) {
        this.log.debug("set passage mode");
        await this.setPassageModeCommand(data);
        this.log.debug("set passage mode");
      } else {
        return false;
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while getting passage mode");
      return false;
    }

    return true;
  }

  async deletePassageMode(data: PassageModeData): Promise<boolean> {
    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    try {
      if (await this.macro_adminLogin()) {
        this.log.debug("delete passage mode");
        await this.setPassageModeCommand(data, PassageModeOperate.DELETE);
        this.log.debug("delete passage mode");
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while deleting passage mode");
      return false;
    }

    return true;
  }

  async clearPassageMode(): Promise<boolean> {
    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    try {
      if (await this.macro_adminLogin()) {
        this.log.debug("clear passage mode");
        await this.clearPassageModeCommand();
        this.log.debug("clear passage mode");
      } else {
        return false;
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while deleting passage mode");
      return false;
    }

    return true;
  }

  /**
   * Add a new passcode to unlock
   * @param type PassCode type: 1 - permanent, 2 - one time, 3 - limited time
   * @param passCode 4-9 digits code
   * @param startDate Valid from YYYYMMDDHHmm
   * @param endDate Valid to YYYYMMDDHHmm
   */
  async addPassCode(type: KeyboardPwdType, passCode: string, startDate?: string, endDate?: string): Promise<boolean> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (!this.hasPassCode()) {
      throw new Error("No PassCode support");
    }

    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    try {
      if (await this.macro_adminLogin()) {
        this.log.debug("add passCode");
        const result = await this.createCustomPasscodeCommand(type, passCode, startDate, endDate);
        this.log.debug(`add passCode: ${result}`);
        return result;
      } else {
        return false;
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while adding passcode");
      return false;
    }
  }

  /**
   * Update a passcode to unlock
   * @param type PassCode type: 1 - permanent, 2 - one time, 3 - limited time
   * @param oldPassCode 4-9 digits code - old code
   * @param newPassCode 4-9 digits code - new code
   * @param startDate Valid from YYYYMMDDHHmm
   * @param endDate Valid to YYYYMMDDHHmm
   */
  async updatePassCode(type: KeyboardPwdType, oldPassCode: string, newPassCode: string, startDate?: string, endDate?: string): Promise<boolean> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (!this.hasPassCode()) {
      throw new Error("No PassCode support");
    }

    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    try {
      if (await this.macro_adminLogin()) {
        this.log.debug("update passCode");
        const result = await this.updateCustomPasscodeCommand(type, oldPassCode, newPassCode, startDate, endDate);
        this.log.debug(`update passCode: ${result}`);
        return result;
      } else {
        return false;
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while updating passcode");
      return false;
    }
  }

  /**
   * Delete a set passcode
   * @param type PassCode type: 1 - permanent, 2 - one time, 3 - limited time
   * @param passCode 4-9 digits code
   */
  async deletePassCode(type: KeyboardPwdType, passCode: string): Promise<boolean> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (!this.hasPassCode()) {
      throw new Error("No PassCode support");
    }

    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    try {
      if (await this.macro_adminLogin()) {
        this.log.debug("delete passCode");
        const result = await this.deleteCustomPasscodeCommand(type, passCode);
        this.log.debug(`delete passCode: ${result}`);
        return result;
      } else {
        return false;
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while deleting passcode");
      return false;
    }
  }

  /**
   * Remove all stored passcodes
   */
  async clearPassCodes(): Promise<boolean> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (!this.hasPassCode()) {
      throw new Error("No PassCode support");
    }

    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    try {
      if (await this.macro_adminLogin()) {
        this.log.debug("clear passCodes");
        const result = await this.clearCustomPasscodesCommand();
        this.log.debug(`clear passCodes: ${result}`);
        return result;
      } else {
        return false;
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while clearing passcodes");
      return false;
    }
  }

  /**
   * Get all valid passcodes
   */
  async getPassCodes(): Promise<KeyboardPassCode[]> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (!this.hasPassCode()) {
      throw new Error("No PassCode support");
    }

    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    let data: KeyboardPassCode[] = [];

    try {
      if (await this.macro_adminLogin()) {
        let sequence = 0;
        do {
          this.log.debug(`get passCodes: ${sequence}`);
          const response = await this.getCustomPasscodesCommand(sequence);
          this.log.debug(`get passCodes: ${response}`);
          sequence = response.sequence;
          response.data.forEach((passageData) => {
            data.push(passageData);
          });
        } while (sequence != -1);
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while getting passCodes");
    }

    return data;
  }

  /**
   * Add an IC Card
   * @param startDate Valid from YYYYMMDDHHmm
   * @param endDate Valid to YYYYMMDDHHmm
   * @param cardNumber serial number of an already known card
   * @returns serial number of the card that was added
   */
  async addICCard(startDate: string, endDate: string, cardNumber?: string): Promise<string> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (!this.hasICCard()) {
      throw new Error("No IC Card support");
    }

    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    let data: string = "";

    try {
      if (await this.macro_adminLogin()) {
        this.log.debug("add IC Card");
        if (typeof cardNumber != "undefined") {
          const addedCardNumber = await this.addICCommand(cardNumber, startDate, endDate);
          this.log.debug(`add IC Card: ${addedCardNumber}`);
        } else {
          const addedCardNumber = await this.addICCommand();
          this.log.debug(`updating IC Card: ${addedCardNumber}`);
          const response = await this.updateICCommand(addedCardNumber, startDate, endDate);
          this.log.debug(`updating IC Card: ${response}`);
          data = addedCardNumber;
        }
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while adding IC Card");
    }

    return data;
  }

  /**
   * Update an IC Card
   * @param cardNumber Serial number of the card
   * @param startDate Valid from YYYYMMDDHHmm
   * @param endDate Valid to YYYYMMDDHHmm
   */
  async updateICCard(cardNumber: string, startDate: string, endDate: string): Promise<boolean> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (!this.hasICCard()) {
      throw new Error("No IC Card support");
    }

    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    let data = false;

    try {
      if (await this.macro_adminLogin()) {
        this.log.debug(`updating IC Card: ${cardNumber}`);
        const response = await this.updateICCommand(cardNumber, startDate, endDate);
        this.log.debug(`updating IC Card: ${response}`);
        data = response;
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while updating IC Card");
    }

    return data;
  }

  /**
   * Delete an IC Card
   * @param cardNumber Serial number of the card
   */
  async deleteICCard(cardNumber: string): Promise<boolean> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (!this.hasICCard()) {
      throw new Error("No IC Card support");
    }

    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    let data = false;

    try {
      if (await this.macro_adminLogin()) {
        this.log.debug(`updating IC Card: ${cardNumber}`);
        const response = await this.deleteICCommand(cardNumber);
        this.log.debug(`updating IC Card: ${response}`);
        data = response;
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while adding IC Card");
    }

    return data;
  }

  /**
   * Clear all IC Card data
   */
  async clearICCards(): Promise<boolean> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (!this.hasICCard()) {
      throw new Error("No IC Card support");
    }

    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    let data = false;

    try {
      if (await this.macro_adminLogin()) {
        this.log.debug("clearing IC Cards");
        const response = await this.clearICCommand();
        this.log.debug(`clearing IC Cards: ${response}`);
        data = response;
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while clearing IC Cards");
    }

    return data;
  }

  /**
   * Get all valid IC cards and their validity interval
   */
  async getICCards(): Promise<ICCard[]> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (!this.hasICCard()) {
      throw new Error("No IC Card support");
    }

    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    let data: ICCard[] = [];

    try {
      if (await this.macro_adminLogin()) {
        let sequence = 0;
        do {
          this.log.debug(`get IC Cards: ${sequence}`);
          const response = await this.getICCommand(sequence);
          this.log.debug(`get IC Cards: ${response}`);
          sequence = response.sequence;
          response.data.forEach((card) => {
            data.push(card);
          });
        } while (sequence != -1);
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while getting IC Cards");
    }

    return data;
  }

  /**
   * Add a Fingerprint
   * @param startDate Valid from YYYYMMDDHHmm
   * @param endDate Valid to YYYYMMDDHHmm
   * @returns serial number of the firngerprint that was added
   */
  async addFingerprint(startDate: string, endDate: string): Promise<string> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (!this.hasFingerprint()) {
      throw new Error("No fingerprint support");
    }

    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    let data = "";

    try {
      if (await this.macro_adminLogin()) {
        this.log.debug("add Fingerprint");
        const fpNumber = await this.addFRCommand();
        this.log.debug(`updating Fingerprint: ${fpNumber}`);
        const response = await this.updateFRCommand(fpNumber, startDate, endDate);
        this.log.debug(`updating Fingerprint: ${response}`);
        data = fpNumber;
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while adding Fingerprint");
    }

    return data;
  }

  /**
   * Update a fingerprint
   * @param fpNumber Serial number of the fingerprint
   * @param startDate Valid from YYYYMMDDHHmm
   * @param endDate Valid to YYYYMMDDHHmm
   */
  async updateFingerprint(fpNumber: string, startDate: string, endDate: string): Promise<boolean> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (!this.hasFingerprint()) {
      throw new Error("No fingerprint support");
    }

    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    let data = false;

    try {
      if (await this.macro_adminLogin()) {
        this.log.debug(`updating Fingerprint: ${fpNumber}`);
        const response = await this.updateFRCommand(fpNumber, startDate, endDate);
        this.log.debug(`updating Fingerprint: ${response}`);
        data = response;
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while updating Fingerprint");
    }

    return data;
  }

  /**
   * Delete a fingerprint
   * @param fpNumber Serial number of the fingerprint
   */
  async deleteFingerprint(fpNumber: string): Promise<boolean> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (!this.hasFingerprint()) {
      throw new Error("No fingerprint support");
    }

    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    let data = false;

    try {
      if (await this.macro_adminLogin()) {
        this.log.debug(`updating Fingerprint: ${fpNumber}`);
        const response = await this.deleteFRCommand(fpNumber);
        this.log.debug(`updating Fingerprint: ${response}`);
        data = response;
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while adding Fingerprint");
    }

    return data;
  }

  /**
   * Clear all fingerprint data
   */
  async clearFingerprints(): Promise<boolean> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (!this.hasFingerprint()) {
      throw new Error("No fingerprint support");
    }

    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    let data = false;

    try {
      if (await this.macro_adminLogin()) {
        this.log.debug("clearing Fingerprints");
        const response = await this.clearFRCommand();
        this.log.debug(`clearing Fingerprints: ${response}`);
        data = response;
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while clearing Fingerprints");
    }

    return data;
  }

  /**
   * Get all valid IC cards and their validity interval
   */
  async getFingerprints(): Promise<Fingerprint[]> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (!this.hasFingerprint()) {
      throw new Error("No fingerprint support");
    }

    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    let data: Fingerprint[] = [];

    try {
      if (await this.macro_adminLogin()) {
        let sequence = 0;
        do {
          this.log.debug(`get Fingerprints: ${sequence}`);
          const response = await this.getFRCommand(sequence);
          this.log.debug(`get Fingerprints: ${response}`);
          sequence = response.sequence;
          response.data.forEach((fingerprint) => {
            data.push(fingerprint);
          });
        } while (sequence != -1);
      }
    } catch (error) {
      this.log.error({ err: error }, "Error while getting Fingerprints");
    }

    return data;
  }

  /**
   * No ideea what this does ...
   * @param type 
   */
  async setRemoteUnlock(type?: ConfigRemoteUnlock.OP_CLOSE | ConfigRemoteUnlock.OP_OPEN): Promise<ConfigRemoteUnlock.OP_CLOSE | ConfigRemoteUnlock.OP_OPEN | undefined> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (typeof this.featureList == "undefined") {
      throw new Error("Lock features missing");
    }

    if (!this.featureList.has(FeatureValue.CONFIG_GATEWAY_UNLOCK)) {
      throw new Error("Lock does not support remote unlock");
    }

    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    try {
      if (await this.macro_adminLogin()) {
        this.log.debug("remoteUnlock");
        if (typeof type != "undefined") {
          this.remoteUnlock = await this.controlRemoteUnlockCommand(type);
        } else {
          this.remoteUnlock = await this.controlRemoteUnlockCommand();
        }
        this.log.debug(`remoteUnlock: ${this.remoteUnlock}`);
      }
    } catch (error) {
      this.log.error({ err: error }, "Error on remote unlock");
    }

    return this.remoteUnlock;
  }

  async getOperationLog(all: boolean = false, noCache: boolean = false): Promise<LogEntry[]> {
    if (!this.initialized) {
      throw new Error("Lock is in pairing mode");
    }

    if (!this.isConnected()) {
      throw new Error("Lock is not connected");
    }

    let newOperations: LogEntry[] = [];

    // in all mode do the following
    // - get new operations
    // - sort operation log by recordNumber
    // - create list of missing/invalid recordNumber
    // - fetch those records

    const maxRetry = 3;

    // first, always get new operations
    if (this.hasNewEvents()) {
      let sequence = 0xffff;
      let retry = 0;
      do {
        this.log.debug(`get OperationLog: ${sequence}`);
        try {
          const response = await this.getOperationLogCommand(sequence);
          sequence = response.sequence;
          for (let log of response.data) {
            if (log) {
              newOperations.push(log);
              this.operationLog[log.recordNumber] = log;
            }
          }
          retry = 0;
        } catch (error) {
          retry++;
        }
      } while (sequence > 0 && retry < maxRetry);
    }

    // if all operations were requested
    if (all) {
      let operations = [];
      let maxRecordNumber = 0;
      if (noCache) {
        // if cache will not be used start with only the new operations
        for (let log of newOperations) {
          if (log) {
            operations[log.recordNumber] = log;
            if (log.recordNumber > maxRecordNumber) {
              maxRecordNumber = log.recordNumber;
            }
          }
        }
      } else {
        // otherwise copy current operation log
        for (let log of this.operationLog) {
          if (log) {
            operations[log.recordNumber] = log;
            if (log.recordNumber > maxRecordNumber) {
              maxRecordNumber = log.recordNumber;
            }
          }
        }
      }
      if (operations.length == 0) {
        // if no operations, start with 0 and keep going
        let sequence = 0;
        let failedSequences = 0;
        let retry = 0;
        do {
          this.log.debug(`get OperationLog: ${sequence}`);
          try {
            const response = await this.getOperationLogCommand(sequence);
            sequence = response.sequence;
            this.log.debug(`get OperationLog next seq: ${sequence}`);
            for (let log of response.data) {
              operations[log.recordNumber] = log;
            }
            retry = 0;
          } catch (error) {
            retry++;
            // some operations just can't be read
            if (retry == maxRetry) {
              this.log.debug(`get OperationLog skip seq: ${sequence}`);
              sequence++;
              failedSequences++;
              retry = 0;
            }
          }
        } while (sequence > 0 && retry < maxRetry);
      } else {
        // if we have operations, check for missing
        let missing = [];
        for (let i = 0; i < maxRecordNumber; i++) {
          if (typeof operations[i] == "undefined" || operations[i] == null) {
            missing.push(i);
          }
        }
        for (let sequence of missing) {
          let retry = 0;
          let success = false;
          do {
            this.log.debug(`get OperationLog: ${sequence}`);
            try {
              const response = await this.getOperationLogCommand(sequence);
              for (let log of response.data) {
                operations[log.recordNumber] = log;
              }
              retry = 0;
              success = true;
            } catch (error) {
              retry++;
            }
          } while (!success && retry < maxRetry);
        }
      }

      this.operationLog = operations;
      this.emit("dataUpdated", this);
      return this.operationLog;
    } else {
      if (newOperations.length > 0) {
        this.emit("dataUpdated", this);
      }
      return newOperations;
    }
  }

  private onDataReceived(command: CommandEnvelope) {
    // is this just a notification (like the lock was locked/unlocked etc.)
    if (this.privateData.aesKey) {
      command.setAesKey(this.privateData.aesKey);
      const data = command.getCommand().getRawData();
      this.log.debug({ cmd: command.getCommandType() }, 'Received notification');
      if (data) {
        this.log.trace({ hex: data.toString('hex') }, 'Notification data');
      }
    } else {
      this.log.error("Unable to decrypt notification, no AES key");
    }
  }

  private async onConnected(): Promise<void> {
    if (this.isPaired() && !this.skipDataRead) {
      // If the lock is advertising as setting mode it has been factory-reset and our stored
      // keys (aesKey, adminPs) are now stale.  Attempting COMM_CHECK_ADMIN would be silently
      // ignored by the lock for ~15 s before we time out, so skip auth and let the manager
      // treat this as an uninitialized lock that needs re-pairing.
      if (this.device.isSettingMode) {
        this.log.warn("Lock is in setting mode but we have stored keys — lock may have been reset. Skipping admin auth; re-initialization required.");
        if (this.device.connected) {
          this.connected = true;
          this.emit("connected", this);
        }
        return;
      }
      // read general data
      this.log.info("Connected to known lock, reading general data");
      try {
        if (typeof this.featureList == "undefined") {
          // Admin auth required before querying device features on reconnect
          if (await this.macro_adminLogin()) {
            this.log.debug("feature list");
            this.featureList = await this.searchDeviceFeatureCommand();
            this.log.debug(`feature list: ${this.featureList}`);
          } else {
            throw new Error("Admin login failed before reading device features");
          }
        }

        // Auto lock time
        if (this.featureList.has(FeatureValue.AUTO_LOCK) && this.autoLockTime == -1 && await this.macro_adminLogin()) {
          this.log.debug("autoLockTime");
          this.autoLockTime = await this.searchAutoLockTimeCommand();
          this.log.debug(`autoLockTime: ${this.autoLockTime}`);
        }

        if (this.lockedStatus == LockedStatus.UNKNOWN) {
          // Locked/unlocked status
          this.log.debug("check lock status");
          this.lockedStatus = await this.searchBycicleStatusCommand();
          this.log.debug(`check lock status: ${this.lockedStatus}`);
        }

        if (this.featureList.has(FeatureValue.AUDIO_MANAGEMENT) && this.lockSound == AudioManage.UNKNOWN) {
          this.log.debug("lockSound");
          this.lockSound = await this.audioManageCommand();
          this.log.debug(`lockSound: ${this.lockSound}`);
        }
      } catch (error) {
        this.log.error({ err: error }, "Failed reading all general data from lock");
        // TODO: judge the error and fail connect
      }
    } else {
      if (this.device.isUnlock) {
        this.lockedStatus = LockedStatus.UNLOCKED;
      } else {
        this.lockedStatus = LockedStatus.LOCKED;
      }
    }

    // are we still connected ? It is possible the lock will disconnect while reading general data
    if (this.device.connected) {
      this.connected = true;
      this.emit("connected", this);
    }
  }

  private async onDisconnected(): Promise<void> {
    this.connected = false;
    this.adminAuth = false;
    this.connecting = false;
    this.emit("disconnected", this);
  }

  private async onTTDeviceUpdated(): Promise<void> {
    this.updateFromTTDevice();
  }

  getLockData(): TTLockData | void {
    if (this.isPaired()) {
      const privateData: TTLockPrivateData = {
        aesKey: this.privateData.aesKey?.toString("hex"),
        admin: this.privateData.admin,
        adminPasscode: this.privateData.adminPasscode,
        pwdInfo: this.privateData.pwdInfo
      }
      const data: TTLockData = {
        address: this.device.address,
        battery: this.batteryCapacity,
        rssi: this.rssi,
        autoLockTime: this.autoLockTime ? this.autoLockTime : -1,
        lockedStatus: this.lockedStatus,
        privateData: privateData,
        uniqueid: this.uniqueid,
        operationLog: this.operationLog
      };
      return data;
    }
  }

  /** Just for debugging */
  toJSON(asObject: boolean = false): string | Object {
    let json: Object = this.device.toJSON(true);

    if (this.featureList) Reflect.set(json, 'featureList', this.featureList);
    if (this.switchState) Reflect.set(json, 'switchState', this.switchState);
    if (this.lockSound) Reflect.set(json, 'lockSound', this.lockSound);
    if (this.displayPasscode) Reflect.set(json, 'displayPasscode', this.displayPasscode);
    if (this.autoLockTime) Reflect.set(json, 'autoLockTime', this.autoLockTime);
    if (this.lightingTime) Reflect.set(json, 'lightingTime', this.lightingTime);
    if (this.remoteUnlock) Reflect.set(json, 'remoteUnlock', this.remoteUnlock);
    if (this.deviceInfo) Reflect.set(json, 'deviceInfo', this.deviceInfo);
    const privateData: Object = {};
    if (this.privateData.aesKey) Reflect.set(privateData, 'aesKey', this.privateData.aesKey.toString("hex"));
    if (this.privateData.admin) Reflect.set(privateData, 'admin', this.privateData.admin);
    if (this.privateData.adminPasscode) Reflect.set(privateData, 'adminPasscode', this.privateData.adminPasscode);
    if (this.privateData.pwdInfo) Reflect.set(privateData, 'pwdInfo', this.privateData.pwdInfo);
    Reflect.set(json, 'privateData', privateData);
    if (this.operationLog) Reflect.set(json, 'operationLog', this.operationLog);
    if (this.uniqueid) Reflect.set(json, 'uniqueid', this.uniqueid);

    if (asObject) {
      return json;
    } else {
      return JSON.stringify(json);
    }
  }
}