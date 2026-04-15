'use strict';

import { EventEmitter } from "events";
import { DeviceInterface } from "../DeviceInterface";
import { ScannerInterface, ScannerStateType } from "../ScannerInterface";
import { GatewayBinding } from "./GatewayBinding";
import { GatewayWebsocketDevice } from "./GatewayWebsocketDevice";

function normalizeUuid(uuid: string): string {
  if (uuid.length > 4) {
    return uuid.replace("-0000-1000-8000-00805f9b34fb", "").replace("0000", "");
  }
  return uuid;
}

function toUuidList(value: any): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeUuid(String(entry)));
  }
  if (typeof value === "string") {
    try {
      return toUuidList(JSON.parse(value));
    } catch (_) {
      if (value.length > 0) {
        return value.split(",").map((entry) => normalizeUuid(entry.trim()));
      }
    }
  }
  return [];
}

export class GatewayWebsocketScanner extends EventEmitter implements ScannerInterface {
  uuids: string[];
  scannerState: ScannerStateType = "unknown";

  private readonly binding: GatewayBinding;
  private readonly devices: Map<string, GatewayWebsocketDevice> = new Map();
  private ready: boolean = false;

  constructor(
    uuids: string[] = [],
    address?: string,
    port?: number,
    aesKey?: string,
    username?: string,
    password?: string,
    binding?: GatewayBinding
  ) {
    super();
    this.uuids = uuids.map((entry) => normalizeUuid(entry));
    this.binding = binding || this.createDefaultBinding(address, port, aesKey, username, password);

    this.initBinding();
  }

  private createDefaultBinding(
    address?: string,
    port?: number,
    aesKey?: string,
    username?: string,
    password?: string
  ): GatewayBinding {
    const { NobleWebsocketBinding } = require("../noble/NobleWebsocketBinding");
    return new NobleWebsocketBinding(
      address || "127.0.0.1",
      port || 2846,
      aesKey || "f8b55c272eb007f501560839be1f1e7e",
      username || "admin",
      password || "admin"
    );
  }

  getState(): ScannerStateType {
    return this.scannerState;
  }

  async startScan(passive: boolean): Promise<boolean> {
    if (!this.ready) {
      return false;
    }
    if (this.scannerState !== "unknown" && this.scannerState !== "stopped") {
      return false;
    }

    this.scannerState = "starting";
    this.binding.startScanning(this.uuids, passive);
    return true;
  }

  async stopScan(): Promise<boolean> {
    if (this.scannerState !== "scanning" && this.scannerState !== "starting") {
      return false;
    }

    this.scannerState = "stopping";
    this.binding.stopScanning();
    return true;
  }

  private initBinding(): void {
    this.binding.on("stateChange", (state: string) => {
      if (state === "poweredOn") {
        this.ready = true;
        this.emit("ready");
      }
    });

    this.binding.on("scanStart", () => {
      this.scannerState = "scanning";
      this.emit("scanStart");
    });

    this.binding.on("scanStop", () => {
      this.scannerState = "stopped";
      this.emit("scanStop");
    });

    this.binding.on(
      "discover",
      (
        peripheralUuid: string,
        address: string,
        addressType: string,
        connectable: boolean,
        advertisement: any,
        rssi: number
      ) => {
        const serviceUuids = toUuidList(advertisement?.serviceUuids);
        if (this.uuids.length > 0 && !serviceUuids.some((serviceUuid) => this.uuids.includes(normalizeUuid(serviceUuid)))) {
          return;
        }

        if (!this.devices.has(peripheralUuid)) {
          const device = new GatewayWebsocketDevice(
            this.binding,
            peripheralUuid,
            address,
            addressType,
            connectable,
            advertisement,
            rssi
          );
          this.devices.set(peripheralUuid, device);
          this.emit("discover", device as DeviceInterface);
          return;
        }

        const device = this.devices.get(peripheralUuid);
        if (device) {
          device.updateFromAdvertisement(address, advertisement, rssi, connectable);
          this.emit("discover", device as DeviceInterface);
        }
      }
    );
  }
}
