/**
 * Minimal protobuf writer (and reader) for Cosmos TxRaw / message encoding.
 * Mirrors zunia-core ProtoWriter: ascending tags, skip proto3 defaults.
 */

export class ProtoWriter {
  private buf: number[] = [];
  private lastTag = 0;

  intoBytes(): Uint8Array {
    return new Uint8Array(this.buf);
  }

  private writeTag(tag: number, wire: 0 | 2): void {
    this.lastTag = tag;
    writeVarint(this.buf, tag * 8 + wire);
  }

  private pushAll(bytes: ArrayLike<number>): void {
    // A loop, not push(...bytes): spreading a large contract message or memo
    // into one call overflows the engine's argument limit.
    for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i]!);
  }

  uint64(tag: number, value: number | bigint): this {
    const n = typeof value === "bigint" ? value : BigInt(value);
    if (n === BigInt(0)) return this;
    if (n < BigInt(0)) throw new Error("uint64 cannot be negative");
    this.writeTag(tag, 0);
    writeVarintBig(this.buf, n);
    return this;
  }

  int32(tag: number, value: number): this {
    if (value === 0) return this;
    this.writeTag(tag, 0);
    // Negative int32 values are sign-extended to 10 bytes on the wire.
    if (value < 0) writeVarintBig(this.buf, BigInt.asUintN(64, BigInt(value)));
    else writeVarint(this.buf, value >>> 0);
    return this;
  }

  string(tag: number, value: string): this {
    if (!value) return this;
    const bytes = new TextEncoder().encode(value);
    this.writeTag(tag, 2);
    writeVarint(this.buf, bytes.length);
    this.pushAll(bytes);
    return this;
  }

  bytes(tag: number, value: Uint8Array): this {
    if (value.length === 0) return this;
    this.writeTag(tag, 2);
    writeVarint(this.buf, value.length);
    this.pushAll(value);
    return this;
  }

  message(tag: number, value: Uint8Array): this {
    return this.bytes(tag, value);
  }

  messageAlways(tag: number, value: Uint8Array): this {
    this.writeTag(tag, 2);
    writeVarint(this.buf, value.length);
    this.pushAll(value);
    return this;
  }

  repeatedMessage(tag: number, values: Uint8Array[]): this {
    for (const value of values) {
      this.writeTag(tag, 2);
      writeVarint(this.buf, value.length);
      this.pushAll(value);
      this.lastTag = tag;
    }
    return this;
  }
}

function writeVarint(buf: number[], value: number): void {
  let n = value >>> 0;
  for (;;) {
    const byte = n & 0x7f;
    n >>>= 7;
    if (n === 0) {
      buf.push(byte);
      return;
    }
    buf.push(byte | 0x80);
  }
}

function writeVarintBig(buf: number[], value: bigint): void {
  let n = value;
  const mask = BigInt(0x7f);
  const seven = BigInt(7);
  for (;;) {
    const byte = Number(n & mask);
    n >>= seven;
    if (n === BigInt(0)) {
      buf.push(byte);
      return;
    }
    buf.push(byte | 0x80);
  }
}

/** One field read off the wire: varints as bigint, length-delimited as bytes. */
export type ProtoField =
  | { field: number; wire: 0; value: bigint }
  | { field: number; wire: 2; value: Uint8Array };

/**
 * Reads the top-level fields of a message. Only varint and length-delimited
 * fields (all Cosmos tx documents use); anything else throws, because a
 * document we cannot read is not one to make claims about.
 */
export function readProtoFields(bytes: Uint8Array): ProtoField[] {
  const out: ProtoField[] = [];
  let pos = 0;
  const varint = (): bigint => {
    let result = BigInt(0);
    let shift = BigInt(0);
    for (let i = 0; i < 10; i++) {
      if (pos >= bytes.length) throw new Error("Truncated varint");
      const byte = bytes[pos++]!;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += BigInt(7);
    }
    throw new Error("Varint too long");
  };
  while (pos < bytes.length) {
    const key = Number(varint());
    const field = key >>> 3;
    const wire = key & 7;
    if (wire === 0) {
      out.push({ field, wire: 0, value: varint() });
    } else if (wire === 2) {
      const length = Number(varint());
      if (pos + length > bytes.length) throw new Error("Truncated field");
      out.push({ field, wire: 2, value: bytes.slice(pos, pos + length) });
      pos += length;
    } else {
      throw new Error(`Unsupported wire type ${wire}`);
    }
  }
  return out;
}
