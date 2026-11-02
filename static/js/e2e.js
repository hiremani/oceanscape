// Fisker Ocean end-to-end protection for the control trial (settings.js "Unlock controls"). Some of the head
// unit's control messages carry an 8-bit checksum in byte 0 and a 4-bit alive counter in byte 1 (ICC_0x336,
// ICC_0x52A, ICC_0x563); the car ignores a frame whose checksum or counter is wrong. Rather than build such a
// frame from nothing, the trial copies the head unit's own latest frame, changes the one field it wants, bumps
// the counter and fixes the checksum, so everything else in the frame stays exactly as the head unit had it.
//
// The checksum is CRC-8 SAE-J1850 (poly 0x1D, init 0, xorout 0) over [data_id] || bytes[1..7]. We never need the
// per-message data_id: the CRC is linear over GF(2), so for a change from the head unit's frame `cur` to ours,
//   newChecksum = cur[0] XOR crc8([0, cur[1]^new[1], ... cur[7]^new[7]])
// and the data_id, being the same in both, cancels. This is the same delta trick the sunnypilot ICC spoof uses
// (opendbc/car/fisker/fiskercan.py fisker_icc_checksum_delta), verified against the car there.
//
// Advisory/trial only, parked only (carcontrols.js guards the car's speed). Nothing here runs while driving.

/** CRC-8 SAE-J1850 (poly 0x1D, init 0, xorout 0) over the bytes. */
export function crc8j1850(buf) {
  let crc = 0;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 0x80 ? ((crc << 1) ^ 0x1D) & 0xFF : (crc << 1) & 0xFF;
  }
  return crc;
}

/** Read a signal's raw integer from an 8-byte frame (Motorola/sawtooth, as cancmd.js encodes). */
export function getRaw(bytes, sig) {
  let raw = 0;
  if (sig.intel) {
    for (let i = 0; i < sig.len; i++) { const pos = sig.start + i; if ((bytes[pos >> 3] >> (pos & 7)) & 1) raw |= 1 << i; }
  } else {
    const lsbLin = (sig.start >> 3) * 8 + 7 - (sig.start & 7) + sig.len - 1;
    for (let i = 0; i < sig.len; i++) { const lin = lsbLin - i, pos = (lin >> 3) * 8 + 7 - (lin & 7); if ((bytes[pos >> 3] >> (pos & 7)) & 1) raw |= 1 << i; }
  }
  return raw >>> 0;
}

/** Write a signal's raw integer into an 8-byte frame in place (same bit order as getRaw). */
export function putRaw(bytes, sig, raw) {
  const set = (pos, bit) => { const byte = pos >> 3, b = pos & 7; if (bit) bytes[byte] |= 1 << b; else bytes[byte] &= ~(1 << b); };
  if (sig.intel) {
    for (let i = 0; i < sig.len; i++) set(sig.start + i, (raw >>> i) & 1);
  } else {
    const lsbLin = (sig.start >> 3) * 8 + 7 - (sig.start & 7) + sig.len - 1;
    for (let i = 0; i < sig.len; i++) { const lin = lsbLin - i; set((lin >> 3) * 8 + 7 - (lin & 7), (raw >>> i) & 1); }
  }
}

// the shared positions of the E2E fields, identical across ICC_0x336, ICC_0x52A and ICC_0x563
export const E2E_CHECKSUM = { start: 7, len: 8 };    // byte 0
export const E2E_ALIVE = { start: 11, len: 4 };      // byte 1, [0..14]

/** The next frame to send, from the head unit's latest one: set `values` ({signal-def: raw}), and for an E2E
 *  message (`e2e` true) bump the alive counter past the head unit's and correct the checksum. `cur` is the head
 *  unit's 8 bytes; returns a new Uint8Array, leaving every other field as the head unit had it. */
export function nextFrame(cur, values, e2e = false) {
  const out = Uint8Array.from(cur);
  for (const [sig, raw] of values) putRaw(out, sig, raw);
  if (e2e) {
    const next = (getRaw(cur, E2E_ALIVE) + 1) % 15;   // [0..14], wraps (15 is invalid)
    putRaw(out, E2E_ALIVE, next);
    const diff = new Uint8Array(8);
    for (let i = 1; i < 8; i++) diff[i] = cur[i] ^ out[i];   // byte 0 (the checksum itself) forced 0
    putRaw(out, E2E_CHECKSUM, cur[0] ^ crc8j1850(diff));
  }
  return out;
}
