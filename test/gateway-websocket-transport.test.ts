import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "events";

import { GatewayWebsocketScanner } from "../src/scanner/gateway/GatewayWebsocketScanner";
import { DeviceInterface } from "../src/scanner/DeviceInterface";

class FakeGatewayBinding extends EventEmitter {
  startScanning(serviceUuids: string[], _allowDuplicates: boolean): void {
    setImmediate(() => this.emit("scanStart"));
  }

  stopScanning(): void {
    setImmediate(() => this.emit("scanStop"));
  }

  connect(peripheralUuid: string): void {
    setImmediate(() => this.emit("connect", peripheralUuid));
  }

  disconnect(peripheralUuid: string): void {
    setImmediate(() => this.emit("disconnect", peripheralUuid));
  }

  discoverServices(peripheralUuid: string, _uuids: string[]): void {
    setImmediate(() => this.emit("servicesDiscover", peripheralUuid, ["1910"]));
  }

  discoverCharacteristics(peripheralUuid: string, serviceUuid: string, _characteristicUuids: string[]): void {
    setImmediate(() =>
      this.emit("characteristicsDiscover", peripheralUuid, serviceUuid, [
        { uuid: "fff2", properties: ["write", "writeWithoutResponse"] },
        { uuid: "fff4", properties: ["read", "notify"] }
      ])
    );
  }

  read(peripheralUuid: string, serviceUuid: string, characteristicUuid: string): void {
    setImmediate(() =>
      this.emit("read", peripheralUuid, serviceUuid, characteristicUuid, Buffer.from("0102", "hex"), false)
    );
  }

  write(peripheralUuid: string, serviceUuid: string, characteristicUuid: string, _data: Buffer, _withoutResponse: boolean): void {
    setImmediate(() => this.emit("write", peripheralUuid, serviceUuid, characteristicUuid));
  }

  notify(peripheralUuid: string, serviceUuid: string, characteristicUuid: string, notify: boolean): void {
    setImmediate(() => this.emit("notify", peripheralUuid, serviceUuid, characteristicUuid, notify));
    if (notify) {
      setImmediate(() =>
        this.emit("read", peripheralUuid, serviceUuid, characteristicUuid, Buffer.from("aa", "hex"), true)
      );
    }
  }
}

function once<T = any[]>(emitter: EventEmitter, event: string): Promise<T> {
  return new Promise((resolve) => emitter.once(event, (...args) => resolve(args as unknown as T)));
}

test("gateway websocket scanner lifecycle via mock binding", async () => {
  const binding = new FakeGatewayBinding();
  const scanner = new GatewayWebsocketScanner(["1910"], undefined, undefined, undefined, undefined, undefined, binding as any);

  const ready = once(scanner, "ready");
  binding.emit("stateChange", "poweredOn");
  await ready;

  const scanStart = once(scanner, "scanStart");
  const started = await scanner.startScan(false);
  assert.equal(started, true);
  await scanStart;

  const discoverEvent = once<[DeviceInterface]>(scanner, "discover");
  binding.emit(
    "discover",
    "device-1",
    "aa-bb-cc-dd-ee-ff",
    "public",
    true,
    {
      localName: "TTLock",
      serviceUuids: ["1910"],
      manufacturerData: Buffer.from("050301", "hex")
    },
    -60
  );

  const [device] = await discoverEvent;
  assert.equal(device.id, "device-1");

  const connected = await device.connect();
  assert.equal(connected, true);

  const services = await device.discoverServices();
  assert.equal(services.has("1910"), true);

  const service = services.get("1910");
  assert.ok(service);

  const writeChar = service?.characteristics.get("fff2");
  const notifyChar = service?.characteristics.get("fff4");
  assert.ok(writeChar);
  assert.ok(notifyChar);

  const readData = await notifyChar?.read();
  assert.equal(readData?.toString("hex"), "0102");

  const writeOk = await writeChar?.write(Buffer.from("a1b2", "hex"), true);
  assert.equal(writeOk, true);

  const notification = once<[Buffer]>(notifyChar as unknown as EventEmitter, "dataRead");
  await notifyChar?.subscribe();
  const [notificationData] = await notification;
  assert.equal(notificationData.toString("hex"), "aa");

  const scanStop = once(scanner, "scanStop");
  const stopped = await scanner.stopScan();
  assert.equal(stopped, true);
  await scanStop;

  const disconnected = await device.disconnect();
  assert.equal(disconnected, true);
});
