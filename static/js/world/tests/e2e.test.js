// The control trial's end-to-end protection (e2e.js): the J1850 CRC, the bit packing, and the copy-mutate frame.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { crc8j1850, getRaw, putRaw, nextFrame, E2E_CHECKSUM, E2E_ALIVE } from '../../e2e.js';
import { extract } from '../../carstate.js';

// a from-scratch Fisker checksum for a chosen data_id: CRC-8 J1850 over [data_id] || bytes[1..7] (fiskercan.py)
const fullChecksum = (dataId, bytes) => crc8j1850([dataId, ...bytes.slice(1, 8)]);

describe('crc8j1850', () => {
  test('is linear over GF(2): crc(a ^ b) == crc(a) ^ crc(b)', () => {
    for (let t = 0; t < 50; t++) {
      const a = Array.from({ length: 8 }, () => (Math.random() * 256) | 0);
      const b = Array.from({ length: 8 }, () => (Math.random() * 256) | 0);
      const x = a.map((v, i) => v ^ b[i]);
      assert.equal(crc8j1850(x), crc8j1850(a) ^ crc8j1850(b));
    }
  });
  test('init and xorout are zero: crc of all zeros is zero', () => assert.equal(crc8j1850([0, 0, 0, 0, 0, 0, 0, 0]), 0));
});

describe('getRaw / putRaw', () => {
  test('round-trip for Motorola and Intel signals, including byte-spanning', () => {
    for (const sig of [{ start: 42, len: 3 }, { start: 7, len: 8 }, { start: 11, len: 4 }, { start: 62, len: 7 }, { start: 17, len: 10 }, { start: 3, len: 1, intel: true }, { start: 11, len: 4, intel: true }]) {
      const max = (1 << sig.len) - 1;
      for (const raw of [0, 1, max, max >> 1]) {
        const b = new Uint8Array(8);
        putRaw(b, sig, raw);
        assert.equal(getRaw(b, sig), raw, `${sig.start}|${sig.len} = ${raw}`);
      }
    }
  });
  test('getRaw agrees with the repo decoder (carstate.extract) for a Motorola signal spanning bytes', () => {
    const sig = { start: 17, len: 10, res: 1, off: 0 };   // ICC_0x610 ICC_UsrSetDchaEndDrvgMilg
    const b = new Uint8Array(8);
    putRaw(b, sig, 777);
    assert.equal(getRaw(b, sig), 777);
    assert.equal(extract(b, sig), 777);
  });
});

describe('nextFrame', () => {
  const field = { start: 42, len: 3 };   // ICC_DrvModSig in 0x610
  test('a plain message: set the one field, leave the rest of the head unit\'s frame alone', () => {
    const cur = Uint8Array.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
    const out = nextFrame(cur, [[field, 5]], false);
    assert.equal(getRaw(out, field), 5);
    for (let i = 0; i < 8; i++) if (!(i === (42 >> 3))) assert.equal(out[i], cur[i], `byte ${i} untouched`);
  });
  test('an E2E message: the alive counter bumps past the head unit\'s and the checksum is valid', () => {
    const dataId = 0x42;                 // any id: the delta trick is id-independent
    const cur = new Uint8Array(8);
    putRaw(cur, E2E_ALIVE, 9);
    putRaw(cur, { start: 17, len: 2 }, 1);   // some payload field (ICC_LKA_Setting-like)
    putRaw(cur, E2E_CHECKSUM, fullChecksum(dataId, cur));
    assert.equal(getRaw(cur, E2E_CHECKSUM), fullChecksum(dataId, cur));   // cur is self-consistent

    const out = nextFrame(cur, [[{ start: 17, len: 2 }, 2]], true);
    assert.equal(getRaw(out, E2E_ALIVE), 10, 'alive bumped');
    assert.equal(getRaw(out, { start: 17, len: 2 }), 2, 'field set');
    assert.equal(getRaw(out, E2E_CHECKSUM), fullChecksum(dataId, out), 'checksum valid from scratch');
  });
  test('the alive counter wraps 14 -> 0 (15 is invalid)', () => {
    const cur = new Uint8Array(8);
    putRaw(cur, E2E_ALIVE, 14);
    const out = nextFrame(cur, [], true);
    assert.equal(getRaw(out, E2E_ALIVE), 0);
  });
});

describe('seat move (0x533): copy the head unit frame, change only the move field', () => {
  // the real ICC_0x533 signal positions (dbc/fisker_ocean_ibus.dbc): a driver track request and a lumbar bit
  const track = { start: 1, len: 2 };    // ICC_DrvrSeatTrackManReq (1 = forward, 2 = back)
  const lumbarUp = { start: 16, len: 1 }; // ICC_LumbarUpd -- a different live field the head unit owns
  test('sets the move request and leaves the head unit\'s other fields (lumbar, byte payloads) untouched', () => {
    const cur = new Uint8Array(8);
    putRaw(cur, lumbarUp, 1);             // head unit has lumbar-up set
    cur[3] = 0x5A; cur[6] = 0xC3;         // some other live payload bytes
    const out = nextFrame(cur, [[track, 1]], false);   // seatHold builds exactly this (e2e off: 0x533 has no checksum)
    assert.equal(getRaw(out, track), 1, 'forward requested');
    assert.equal(getRaw(out, lumbarUp), 1, 'lumbar kept');
    assert.equal(out[3], 0x5A, 'byte 3 kept');
    assert.equal(out[6], 0xC3, 'byte 6 kept');
    // releasing copies the head unit frame back unchanged: the move field is "no request"
    const idle = nextFrame(cur, [], false);
    assert.equal(getRaw(idle, track), 0, 'release leaves no request');
  });
});
