/**
 * 迷你 Protobuf 编解码（仅支持本项目需要的字段：varint / length-delimited）。
 * 用于 Windsurf GetPlanStatus 等 Connect-RPC 的 protobuf 二进制请求/响应。
 */

export function encodeVarint(value: number): Buffer {
  const out: number[] = []
  let v = value >>> 0
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80)
    v >>>= 7
  }
  out.push(v)
  return Buffer.from(out)
}

/** 字段号 + wireType → tag */
function tag(field: number, wire: number): Buffer {
  return encodeVarint((field << 3) | wire)
}

/** length-delimited 字符串字段 */
export function encodeStringField(field: number, s: string): Buffer {
  const b = Buffer.from(s, "utf8")
  return Buffer.concat([tag(field, 2), encodeVarint(b.length), b])
}

/** varint 字段 */
export function encodeVarintField(field: number, v: number): Buffer {
  return Buffer.concat([tag(field, 0), encodeVarint(v)])
}

/** 解析 message → 字段号 → { wire, value }（value: number | Buffer） */
export function parseProto(
  buf: Buffer
): Map<number, { wire: number; value: number | Buffer }> {
  const fields = new Map<number, { wire: number; value: number | Buffer }>()
  let pos = 0
  while (pos < buf.length) {
    let shift = 0
    let tagVal = 0
    let b: number
    do {
      b = buf[pos++]
      tagVal |= (b & 0x7f) << shift
      shift += 7
    } while (b & 0x80)
    const field = tagVal >>> 3
    const wire = tagVal & 7
    if (wire === 0) {
      // varint
      let v = 0
      let s = 0
      let c: number
      do {
        c = buf[pos++]
        v |= (c & 0x7f) << s
        s += 7
      } while (c & 0x80)
      fields.set(field, { wire, value: v >>> 0 })
    } else if (wire === 2) {
      // length-delimited
      let len = 0
      let s = 0
      let c: number
      do {
        c = buf[pos++]
        len |= (c & 0x7f) << s
        s += 7
      } while (c & 0x80)
      fields.set(field, { wire, value: buf.subarray(pos, pos + len) })
      pos += len
    } else if (wire === 1) {
      pos += 8
    } else if (wire === 5) {
      pos += 4
    } else {
      break // 未知 wire type
    }
  }
  return fields
}

export function protoString(v: number | Buffer | undefined): string | undefined {
  return Buffer.isBuffer(v) ? v.toString("utf8") : undefined
}

export function protoNum(v: number | Buffer | undefined): number | undefined {
  return typeof v === "number" ? v : undefined
}
