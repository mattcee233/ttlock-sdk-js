'use strict';

import { EventEmitter } from "events";

export interface GatewayBinding extends EventEmitter {
  startScanning(serviceUuids: string[], allowDuplicates: boolean): void;
  stopScanning(): void;
  connect(peripheralUuid: string): void;
  disconnect(peripheralUuid: string): void;
  discoverServices(peripheralUuid: string, uuids: string[]): void;
  discoverCharacteristics(peripheralUuid: string, serviceUuid: string, characteristicUuids: string[]): void;
  read(peripheralUuid: string, serviceUuid: string, characteristicUuid: string): void;
  write(peripheralUuid: string, serviceUuid: string, characteristicUuid: string, data: Buffer, withoutResponse: boolean): void;
  notify(peripheralUuid: string, serviceUuid: string, characteristicUuid: string, notify: boolean): void;
}
