export function is32Bytes(u: Uint8Array) {
  return u.byteLength === 32;
}

export function is16Bytes(u: Uint8Array) {
  return u.byteLength === 16;
}

export function u64ArrayFrom(value: bigint) {
  const array = new Uint8Array(8);
  let number = value;
  for (let i = 0; i < 8; i++) {
    array[i] = Number(number & 0xffn);
    number >>= 8n;
  }

  return array;
}

export function u128ArrayFrom(value: bigint) {
  const array = new Uint8Array(16);
  let number = value;

  for (let i = 0; i < 16; i++) {
    array[i] = Number(number & 0xffn);
    number >>= 8n;
  }

  return array;
}

export function arrayToBigIntChunks(
  bytes: Uint8Array,
  chunkSize = 16,
): bigint[] {
  const out: bigint[] = [];
  let x = 0n;
  let count = 0;

  for (let i = 0; i < bytes.length; i++) {
    const byte = BigInt(bytes[i]!);
    x |= byte << (8n * BigInt(count));
    count++;
    if (count === chunkSize) {
      out.push(x);
      x = 0n;
      count = 0;
    }
  }

  if (count !== 0) out.push(x);

  return out;
}
