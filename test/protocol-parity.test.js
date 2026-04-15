const test = require('node:test');
const assert = require('node:assert/strict');

const vectors = require('./protocol-vectors.json');

const { AESUtil, defaultAESKey } = require('../dist/util/AESUtil');
const { CodecUtils } = require('../dist/util/CodecUtils');
const { CommandEnvelope } = require('../dist/api/CommandEnvelope');
const { LockType } = require('../dist/constant/Lock');
const { CommandType } = require('../dist/constant/CommandType');

test('AES vector remains stable for SCIENER payload', () => {
  const plaintext = Buffer.from(vectors.aes.plaintextHex, 'hex');
  const encrypted = AESUtil.aesEncrypt(plaintext, defaultAESKey);
  assert.equal(encrypted.toString('hex'), vectors.aes.ciphertextHex);

  const decrypted = AESUtil.aesDecrypt(encrypted, defaultAESKey);
  assert.equal(decrypted.toString('hex'), vectors.aes.plaintextHex);
});

test('codec encodeWithEncrypt deterministic vector', () => {
  const payload = Buffer.from(vectors.codec.payloadHex, 'hex');
  const encoded = CodecUtils.encodeWithEncrypt(payload, vectors.codec.key);
  assert.equal(encoded.toString('hex'), vectors.codec.encodedHex);

  const decoded = CodecUtils.decodeWithEncrypt(encoded, vectors.codec.key);
  assert.equal(decoded.toString('hex'), vectors.codec.payloadHex);
});

test('V3 GET_AES_KEY envelope bytes stay stable', () => {
  const envelope = CommandEnvelope.createFromLockType(LockType.LOCK_TYPE_V3, defaultAESKey);
  envelope.setCommandType(CommandType.COMM_GET_AES_KEY);

  const built = envelope.buildCommandBuffer();
  assert.equal(built.toString('hex'), vectors.envelope.v3GetAesKeyHex);
});

test('known bad CRC sample remains detectable', () => {
  const sample = Buffer.from(vectors.crc.knownBadResponseHex, 'hex');
  const envelope = CommandEnvelope.createFromRawData(sample, defaultAESKey);

  assert.equal(envelope.getCrc(), vectors.crc.knownBadObservedCrc);
  assert.equal(envelope.isCrcOk(), false);
  assert.notEqual(vectors.crc.knownBadObservedCrc, vectors.crc.knownBadExpectedCrc);
});

test('TTLOCK_IGNORE_CRC preserves compatibility behavior', () => {
  const sample = Buffer.from(vectors.crc.knownBadResponseHex, 'hex');
  process.env.TTLOCK_IGNORE_CRC = '1';

  try {
    const envelope = CommandEnvelope.createFromRawData(sample, defaultAESKey);
    assert.equal(envelope.isCrcOk(), true);
  } finally {
    delete process.env.TTLOCK_IGNORE_CRC;
  }
});
