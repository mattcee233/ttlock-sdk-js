'use strict';

import { EventEmitter } from "events";
import { DeviceInterface, ServiceInterface } from "../DeviceInterface";
import { GatewayBinding } from "./GatewayBinding";
import { GatewayWebsocketService } from "./GatewayWebsocketService";

function normalizeUuid(uuid: string): string {
  if (uuid.length > 4) {
    return uuid.replace("-0000-1000-8000-00805f9b34fb", "").replace("0000", "");
  }
  return uuid;
}

function parseList(value: any): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v));
  }
  if (typeof value === "string") {
    try {
      const json = JSON.parse(value);
      if (Array.isArray(json)) {
        return json.map((v) => String(v));
      }
    } catch (_) {
      if (value.length > 0) {
        return value.split(",").map((v) => v.trim());
      }
    }
  }
  return [];
}

type CharacteristicDescriptor = { uuid: string; properties?: string[] };

export class GatewayWebsocketDevice extends EventEmitter implements DeviceInterface {
  id: string;
  uuid: string;
  name: string;
  address: string;
  addressType: string;
  connectable: boolean;
  rssi: number;
  mtu: number = 20;
  manufacturerData: Buffer;
  services: Map<string, GatewayWebsocketService> = new Map();
  busy: boolean = false;

  private connected: boolean = false;
  private readonly binding: GatewayBinding;

  constructor(
    binding: GatewayBinding,
    peripheralUuid: string,
    address: string,
    addressType: string,
    connectable: boolean,
    advertisement?: any,
    rssi: number = 0
  ) {
    super();
    this.binding = binding;
    this.id = peripheralUuid;
    this.uuid = peripheralUuid;
    this.address = address.replace(/\-/g, ":").toUpperCase();
    this.addressType = addressType;
    this.connectable = !!connectable;
    this.rssi = rssi;
    this.name = advertisement?.localName || "";
    this.manufacturerData = advertisement?.manufacturerData || Buffer.from([]);

    this.initBindingListeners();
  }

  private initBindingListeners(): void {
    this.binding.on("connect", (peripheralUuid: string) => {
      if (peripheralUuid === this.id) {
        this.connected = true;
        this.emit("connected");
      }
    });

    this.binding.on("disconnect", (peripheralUuid: string) => {
      if (peripheralUuid === this.id) {
        this.connected = false;
        this.busy = false;
        this.services = new Map();
        this.emit("disconnected");
      }
    });

    this.binding.on(
      "read",
      (peripheralUuid: string, serviceUuid: string, characteristicUuid: string, data: Buffer, isNotification: boolean) => {
        if (peripheralUuid !== this.id) {
          return;
        }
        const service = this.services.get(normalizeUuid(serviceUuid));
        const characteristic = service?.getCharacteristic(normalizeUuid(characteristicUuid));
        if (characteristic) {
          characteristic.onCharacteristicRead(data || Buffer.from([]), !!isNotification);
        }
      }
    );
  }

  updateFromAdvertisement(address: string, advertisement?: any, rssi: number = 0, connectable?: boolean): void {
    this.address = address.replace(/\-/g, ":").toUpperCase();
    this.name = advertisement?.localName || this.name;
    this.rssi = rssi;
    if (typeof connectable !== "undefined") {
      this.connectable = !!connectable;
    }
    if (advertisement?.manufacturerData) {
      this.manufacturerData = advertisement.manufacturerData;
    }
  }

  checkBusy(): boolean {
    if (this.busy) {
      throw new Error("GatewayWebsocketDevice is busy");
    }
    this.busy = true;
    return true;
  }

  resetBusy(): boolean {
    this.busy = false;
    return this.busy;
  }

  async connect(): Promise<boolean> {
    if (!this.connectable) {
      return false;
    }
    if (this.connected) {
      return true;
    }

    const waitConnect = this.waitForBindingEvent(
      "connect",
      (peripheralUuid: string) => peripheralUuid === this.id,
      10000
    );
    this.binding.connect(this.id);
    await waitConnect;
    return this.connected;
  }

  async disconnect(): Promise<boolean> {
    if (!this.connected) {
      return true;
    }

    const waitDisconnect = this.waitForBindingEvent(
      "disconnect",
      (peripheralUuid: string) => peripheralUuid === this.id,
      10000
    );
    this.binding.disconnect(this.id);
    await waitDisconnect;
    return !this.connected;
  }

  async discoverAll(): Promise<Map<string, ServiceInterface>> {
    return this.discoverServices();
  }

  async discoverServices(): Promise<Map<string, ServiceInterface>> {
    this.checkBusy();
    try {
      const waitServices = this.waitForBindingEvent(
        "servicesDiscover",
        (peripheralUuid: string) => peripheralUuid === this.id,
        10000
      );
      this.binding.discoverServices(this.id, []);
      const eventArgs = await waitServices;
      const serviceUuids = parseList(eventArgs[1]);

      this.services = new Map();
      for (const serviceUuid of serviceUuids) {
        const service = new GatewayWebsocketService(this, serviceUuid);
        this.services.set(service.getUUID(), service);
      }

      for (const service of this.services.values()) {
        await service.discoverCharacteristics();
      }

      return this.services;
    } finally {
      this.resetBusy();
    }
  }

  async discoverCharacteristics(serviceUuid: string): Promise<Map<string, any>> {
    const normalizedServiceUuid = normalizeUuid(serviceUuid);
    const service = this.services.get(normalizedServiceUuid);
    if (!service) {
      return new Map();
    }

    const waitCharacteristics = this.waitForBindingEvent(
      "characteristicsDiscover",
      (peripheralUuid: string, discoveredServiceUuid: string) =>
        peripheralUuid === this.id && normalizeUuid(discoveredServiceUuid) === normalizedServiceUuid,
      10000
    );

    this.binding.discoverCharacteristics(this.id, normalizedServiceUuid, []);
    const eventArgs = await waitCharacteristics;
    const characteristics = this.parseCharacteristics(eventArgs[2]);
    service.setCharacteristics(characteristics);

    return service.characteristics;
  }

  async readCharacteristics(): Promise<boolean> {
    if (this.services.size === 0) {
      await this.discoverServices();
    }
    for (const service of this.services.values()) {
      await service.readCharacteristics();
    }
    return true;
  }

  async readCharacteristic(serviceUuid: string, characteristicUuid: string): Promise<Buffer | undefined> {
    const waitRead = this.waitForBindingEvent(
      "read",
      (
        peripheralUuid: string,
        readServiceUuid: string,
        readCharacteristicUuid: string,
        _data: Buffer,
        isNotification: boolean
      ) =>
        peripheralUuid === this.id &&
        normalizeUuid(readServiceUuid) === normalizeUuid(serviceUuid) &&
        normalizeUuid(readCharacteristicUuid) === normalizeUuid(characteristicUuid) &&
        !isNotification,
      8000
    );

    this.binding.read(this.id, normalizeUuid(serviceUuid), normalizeUuid(characteristicUuid));
    const eventArgs = await waitRead;
    return eventArgs[3] || Buffer.from([]);
  }

  async writeCharacteristic(serviceUuid: string, characteristicUuid: string, data: Buffer, withoutResponse: boolean): Promise<boolean> {
    const waitWrite = this.waitForBindingEvent(
      "write",
      (peripheralUuid: string, writeServiceUuid: string, writeCharacteristicUuid: string) =>
        peripheralUuid === this.id &&
        normalizeUuid(writeServiceUuid) === normalizeUuid(serviceUuid) &&
        normalizeUuid(writeCharacteristicUuid) === normalizeUuid(characteristicUuid),
      8000
    );

    this.binding.write(this.id, normalizeUuid(serviceUuid), normalizeUuid(characteristicUuid), data, withoutResponse);
    await waitWrite;
    return true;
  }

  async setCharacteristicNotify(serviceUuid: string, characteristicUuid: string, notify: boolean): Promise<void> {
    const waitNotify = this.waitForBindingEvent(
      "notify",
      (
        peripheralUuid: string,
        notifyServiceUuid: string,
        notifyCharacteristicUuid: string,
        state: boolean
      ) =>
        peripheralUuid === this.id &&
        normalizeUuid(notifyServiceUuid) === normalizeUuid(serviceUuid) &&
        normalizeUuid(notifyCharacteristicUuid) === normalizeUuid(characteristicUuid) &&
        state === notify,
      8000
    );

    this.binding.notify(this.id, normalizeUuid(serviceUuid), normalizeUuid(characteristicUuid), notify);
    await waitNotify;
  }

  toJSON(asObject: boolean = false): string | Object {
    const json: Record<string, any> = {
      id: this.id,
      uuid: this.uuid,
      name: this.name,
      address: this.address,
      addressType: this.addressType,
      connectable: this.connectable,
      rssi: this.rssi,
      mtu: this.mtu,
      services: {}
    };

    for (const service of this.services.values()) {
      json.services[service.uuid] = service.toJSON(true);
    }

    return asObject ? json : JSON.stringify(json);
  }

  toString(): string {
    return `${this.name} (${this.address})`;
  }

  private parseCharacteristics(value: any): CharacteristicDescriptor[] {
    if (Array.isArray(value)) {
      return value.map((entry) => ({
        uuid: String(entry.uuid || ""),
        properties: Array.isArray(entry.properties) ? entry.properties.map((p: any) => String(p)) : []
      }));
    }
    if (typeof value === "string") {
      try {
        return this.parseCharacteristics(JSON.parse(value));
      } catch (_) {
        return [];
      }
    }
    return [];
  }

  private waitForBindingEvent(event: string, filter: (...args: any[]) => boolean, timeoutMs: number): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.binding.removeListener(event, handler);
        reject(new Error(`Timeout waiting for websocket BLE event ${event}`));
      }, timeoutMs);

      const handler = (...args: any[]) => {
        try {
          if (filter(...args)) {
            clearTimeout(timeout);
            this.binding.removeListener(event, handler);
            resolve(args);
          }
        } catch (error) {
          clearTimeout(timeout);
          this.binding.removeListener(event, handler);
          reject(error);
        }
      };

      this.binding.on(event, handler);
    });
  }
}
