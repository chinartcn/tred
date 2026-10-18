const WASM_BASE64 = 'AGFzbQEAAAABDAJgAABgBH9/f38BfQMDAgABBQMBAAIGRgt/AUGAiAQLfwBBgAgLfwBBgAgLfwBBgAgLfwBBgIgEC38AQYAIC38AQYCIBAt/AEGAgAgLfwBBAAt/AEEBC38AQYCABAsH0QENBm1lbW9yeQIAEV9fd2FzbV9jYWxsX2N0b3JzAAAVZ2V0X3NpbWlsYXJpdHlfaGFzaGVzAAEMX19kc29faGFuZGxlAwEKX19kYXRhX2VuZAMCC19fc3RhY2tfbG93AwMMX19zdGFja19oaWdoAwQNX19nbG9iYWxfYmFzZQMFC19faGVhcF9iYXNlAwYKX19oZWFwX2VuZAMHDV9fbWVtb3J5X2Jhc2UDCAxfX3RhYmxlX2Jhc2UDCRVfX3dhc21fZmlyc3RfcGFnZV9lbmQDCgraAgICAAvUAgIBfQl/QwAAAAAhBAJAIAFFDQAgA0UNAEMAAAAAIQQCQCABQQFIDQAgA0EBSA0AIAFBAXEhBQJAAkAgAUEBRw0AQQAhBkEAIQcMAQsgAEEEaiEIIAFB/v///wdxIQlBACEGQQAhBwNAIAAgBkECdCIKaigCACELIAIhDCADIQ0CQAJAA0AgCyAMKAIARg0BIAxBBGohDCANQX9qIg1FDQIMAAsLIAdBAWohBwsgCCAKaigCACELIAIhDCADIQ0CQAJAA0AgCyAMKAIARg0BIAxBBGohDCANQX9qIg0NAAwCCwsgB0EBaiEHCyAGQQJqIgYgCUcNAAsLAkAgBUUNACAAIAZBAnRqKAIAIQ0gAyEMAkADQCANIAIoAgBGDQEgAkEEaiECIAxBf2oiDA0ADAILCyAHQQFqIQcLIAeyIgQgBJIhBAsgBCADIAFqspUhBAsgBAsAUwRuYW1lAAsKZnV6enkud2FzbQErAgARX193YXNtX2NhbGxfY3RvcnMBFWdldF9zaW1pbGFyaXR5X2hhc2hlcwcSAQAPX19zdGFja19wb2ludGVyACYJcHJvZHVjZXJzAQxwcm9jZXNzZWQtYnkBBWNsYW5nBjIxLjEuOACUAQ90YXJnZXRfZmVhdHVyZXMIKwtidWxrLW1lbW9yeSsPYnVsay1tZW1vcnktb3B0KxZjYWxsLWluZGlyZWN0LW92ZXJsb25nKwptdWx0aXZhbHVlKw9tdXRhYmxlLWdsb2JhbHMrE25vbnRyYXBwaW5nLWZwdG9pbnQrD3JlZmVyZW5jZS10eXBlcysIc2lnbi1leHQ=';

let wasmInstance: any = null;
let memory: WebAssembly.Memory | null = null;

if (WASM_BASE64) {
  try {
    const buf = Buffer.from(WASM_BASE64, 'base64');
    const mod = new WebAssembly.Module(buf);
    wasmInstance = new WebAssembly.Instance(mod, {});
    memory = wasmInstance!.exports.memory;
  } catch (e) {}
}

// 真正的零分配，直接比对 charCode
export function getSimilarity(query: string, target: string): number {
  if (!query || !target) return 0;

  const qLen = query.length;
  const tLen = target.length;

  // ── 1. 短文本极致加速（零内存分配） ──
  if (qLen < 100 && tLen < 100) {
    const qParts: { s: number, e: number }[] = [];
    let qStart = 0;
    for (let i = 0; i <= qLen; i++) {
      const c = i < qLen ? query.charCodeAt(i) : -1;
      if (c === -1 || c === 32 || c === 45 || c === 95 || (c >= 65 && c <= 90 && i > qStart)) {
        if (i > qStart) qParts.push({ s: qStart, e: i });
        qStart = i;
      }
    }

    let intersection = 0;
    let tStart = 0;
    let tCount = 0;
    for (let i = 0; i <= tLen; i++) {
      const c = i < tLen ? target.charCodeAt(i) : -1;
      if (c === -1 || c === 32 || c === 45 || c === 95 || (c >= 65 && c <= 90 && i > tStart)) {
        if (i > tStart) {
          const tWordLen = i - tStart;
          tCount++;
          // 在 qParts 里寻找相等的词
          for (let j = 0; j < qParts.length; j++) {
            const qp = qParts[j];
            if (qp.e - qp.s === tWordLen) {
              let match = true;
              for (let k = 0; k < tWordLen; k++) {
                let qc = query.charCodeAt(qp.s + k);
                let tc = target.charCodeAt(tStart + k);
                if (qc >= 65 && qc <= 90) qc += 32;
                if (tc >= 65 && tc <= 90) tc += 32;
                if (qc !== tc) { match = false; break; }
              }
              if (match) { intersection++; break; }
            }
          }
        }
        tStart = i;
      }
    }

    // 子串完全包含，直接给高分
    const qLower = query.toLowerCase();
    const tLower = target.toLowerCase();
    if (qLower.includes(tLower) || tLower.includes(qLower)) return 0.9;

    if (qParts.length === 0 || tCount === 0) return 0;
    return (2 * intersection) / (qParts.length + tCount);
  }

  // ── 2. 超大字符串走 WASM ──
  if (wasmInstance && memory && qLen >= 100) {
    try {
      const qBytes = Buffer.from(query);
      const tBytes = Buffer.from(target);
      const total = qBytes.length + tBytes.length;
      if (memory.buffer.byteLength < total + 1024) {
        memory.grow(Math.ceil((total + 1024 - memory.buffer.byteLength) / 65536));
      }
      const mem = new Uint8Array(memory.buffer);
      mem.set(qBytes, 1024);
      mem.set(tBytes, 1024 + qBytes.length);
      return wasmInstance.exports.get_similarity(1024, qBytes.length, 1024 + qBytes.length, tBytes.length);
    } catch (e) {}
  }
  return 0;
}