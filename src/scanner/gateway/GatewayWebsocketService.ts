'use strict';

import { CharacteristicInterface, ServiceInterface } from "../DeviceInterface";
import { GatewayWebsocketCharacteristic } from "./GatewayWebsocketCharacteristic";
import { GatewayWebsocketDevice } from "./GatewayWebsocketDevice";

function normalizeUuid(uuid: string): string {
  if (uuid.length > 4) {
    return uuid.replace("-0000-1000-8000-00805f9b34fb", "").replace("0000", "");
  }
  return uuid;
}

export class GatewayWebsocketService implements ServiceInterface {
  uuid: string;
  name?: string;
  type?: string;
  includedServiceUuids: string[] = [];
  characteristics: Map<string, GatewayWebsocketCharacteristic> = new Map();

  private readonly device: GatewayWebsocketDevice;

  constructor(device: GatewayWebsocketDevice, uuid: string) {
    this.device = device;
    this.uuid = normalizeUuid(uuid);
  }

  getUUID(): string {
    return this.uuid;
  }

  async discoverCharacteristics(): Promise<Map<string, CharacteristicInterface>> {
    return this.device.discoverCharacteristics(this.uuid);
  }

  async readCharacteristics(): Promise<Map<string, CharacteristicInterface>> {
    if (this.characteristics.size === 0) {
      await this.discoverCharacteristics();
    }

    for (const characteristic of this.characteristics.values()) {
      if (characteristic.properties.includes("read")) {
        await characteristic.read();
      }
    }

    return this.characteristics;
  }

  setCharacteristics(characteristics: Array<{ uuid: string; properties?: string[] }>): void {
    const map = new Map<string, GatewayWebsocketCharacteristic>();
    for (const entry of characteristics) {
      const characteristic = new GatewayWebsocketCharacteristic(this.device, this.uuid, entry.uuid, entry.properties || []);
      map.set(characteristic.getUUID(), characteristic);
    }
    this.characteristics = map;
  }

  getCharacteristic(uuid: string): GatewayWebsocketCharacteristic | undefined {
    return this.characteristics.get(normalizeUuid(uuid));
  }

  toJSON(asObject: boolean): string | Object {
    const json: Record<string, any> = {
      uuid: this.uuid,
      characteristics: {}
    };

    for (const characteristic of this.characteristics.values()) {
      json.characteristics[characteristic.uuid] = characteristic.toJSON(true);
    }

    return asObject ? json : JSON.stringify(json);
  }

  toString(): string {
    return this.uuid;
  }
}
