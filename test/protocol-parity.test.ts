import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { AESUtil, defaultAESKey } from "../src/util/AESUtil";
import { CodecUtils } from "../src/util/CodecUtils";
import { CommandEnvelope } from "../src/api/CommandEnvelope";
import { LockType } from "../src/constant/Lock";

type ProtocolVectors = {
  aes: {
    plaintextHex: string;
    ciphertextHex: string;
  };
  codec: {
    payloadHex: string;
    key: number;
    encodedHex: string;
  };
  crc: {
    knownBadResponseHex: string;
    knownBadExpectedCrc: number;
    knownBadObservedCrc: number;
  };
};

const vectors: ProtocolVectors = JSON.parse(
  readFileSync(new URL("./protocol-vectors.json", import.meta.url), "utf8")
);

test("AES vector remains stable for SCIENER payload", () => {
  const plaintext = Buffer.from(vectors.aes.plaintextHex, "hex");
  const encrypted = AESUtil.aesEncrypt(plaintext, defaultAESKey);
  assert.equal(encrypted.toString("hex"), vectors.aes.ciphertextHex);

  const decrypted = AESUtil.aesDecrypt(encrypted, defaultAESKey);
  assert.equal(decrypted.toString("hex"), vectors.aes.plaintextHex);
});

test("codec encodeWithEncrypt deterministic vector", () => {
  const payload = Buffer.from(vectors.codec.payloadHex, "hex");
  const encoded = CodecUtils.encodeWithEncrypt(payload, vectors.codec.key);
  assert.equal(encoded.toString("hex"), vectors.codec.encodedHex);

  const decoded = CodecUtils.decodeWithEncrypt(encoded, vectors.codec.key);
  assert.equal(decoded.toString("hex"), vectors.codec.payloadHex);
});

test("known bad CRC sample remains detectable", () => {
  const sample = Buffer.from(vectors.crc.knownBadResponseHex, "hex");
  const envelope = CommandEnvelope.createFromRawData(sample, defaultAESKey);

  assert.equal(envelope.getCrc(), vectors.crc.knownBadObservedCrc);
  assert.equal(envelope.isCrcOk(), false);
  assert.notEqual(vectors.crc.knownBadObservedCrc, vectors.crc.knownBadExpectedCrc);
});

test("TTLOCK_IGNORE_CRC preserves compatibility behavior", () => {
  const sample = Buffer.from(vectors.crc.knownBadResponseHex, "hex");
  process.env.TTLOCK_IGNORE_CRC = "1";

  try {
    const envelope = CommandEnvelope.createFromRawData(sample, defaultAESKey);
    assert.equal(envelope.isCrcOk(), true);
  } finally {
    delete process.env.TTLOCK_IGNORE_CRC;
  }
});

test("known bad CRC sample identifies V3 lock type", () => {
  const sample = Buffer.from(vectors.crc.knownBadResponseHex, "hex");
  const envelope = CommandEnvelope.createFromRawData(sample, defaultAESKey);
  assert.equal(envelope.getLockType(), LockType.LOCK_TYPE_V3);
});
