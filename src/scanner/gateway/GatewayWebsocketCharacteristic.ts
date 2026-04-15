'use strict';

import { EventEmitter } from "events";
import { CharacteristicInterface, DescriptorInterface } from "../DeviceInterface";
import { GatewayWebsocketDevice } from "./GatewayWebsocketDevice";

function normalizeUuid(uuid: string): string {
  if (uuid.length > 4) {
    return uuid.replace("-0000-1000-8000-00805f9b34fb", "").replace("0000", "");
  }
  return uuid;
}

export class GatewayWebsocketCharacteristic extends EventEmitter implements CharacteristicInterface {
  uuid: string;
  name?: string;
  type?: string;
  properties: string[];
  isReading: boolean = false;
  lastValue?: Buffer;
  descriptors: Map<string, DescriptorInterface> = new Map();

  private readonly device: GatewayWebsocketDevice;
  private readonly serviceUuid: string;

  constructor(device: GatewayWebsocketDevice, serviceUuid: string, uuid: string, properties: string[] = []) {
    super();
    this.device = device;
    this.serviceUuid = normalizeUuid(serviceUuid);
    this.uuid = normalizeUuid(uuid);
    this.properties = properties;
  }

  getUUID(): string {
    return this.uuid;
  }

  async discoverDescriptors(): Promise<Map<string, DescriptorInterface>> {
    return this.descriptors;
  }

  async read(): Promise<Buffer | undefined> {
    if (!this.properties.includes("read")) {
      return;
    }

    this.isReading = true;
    try {
      this.lastValue = await this.device.readCharacteristic(this.serviceUuid, this.uuid);
      return this.lastValue;
    } finally {
      this.isReading = false;
    }
  }

  async write(data: Buffer, withoutResponse: boolean): Promise<boolean> {
    if (!this.properties.includes("write") && !this.properties.includes("writeWithoutResponse")) {
      return false;
    }

    return this.device.writeCharacteristic(this.serviceUuid, this.uuid, data, withoutResponse);
  }

  async subscribe(): Promise<void> {
    await this.device.setCharacteristicNotify(this.serviceUuid, this.uuid, true);
  }

  onCharacteristicRead(data: Buffer, isNotification: boolean): void {
    this.lastValue = data;
    if (isNotification || !this.isReading) {
      this.emit("dataRead", data);
    }
  }

  toJSON(asObject: boolean): string | Object {
    const json: Record<string, any> = {
      uuid: this.uuid,
      properties: this.properties,
      value: this.lastValue?.toString("hex")
    };

    return asObject ? json : JSON.stringify(json);
  }

  toString(): string {
    return `${this.uuid} (${this.properties.join(",")})`;
  }
}
