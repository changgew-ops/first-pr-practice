// 저장용 문자열 압축(LZW 계열, 동기, 의존성 없음). 문자열 → 문자열.
// 코드는 15비트 고정 폭이고 출력 한 글자에 15비트씩 담는다. 글자는 U+1000~U+8FFF(대리쌍·제어 문자 없음)라 localStorage에 안전하다.
// 부호: 0 = 새 글자(다음 16비트가 그 글자), 1 = 사전 비우기, 2 = 끝. 3부터 사전 항목.
// 사전이 가득 차기 전에 비우고 다시 시작해서(사전 채우기 한도 LIMIT) 긴 입력도 같은 방식으로 압축한다.
const BITS = 15;
const BASE = 0x1000;
const LIMIT = (1 << BITS) - 8; // 이 크기에 닿으면 사전을 비운다(복호기가 한 항목 더 늘 수 있어 여유를 둔다)
const LITERAL = 0, RESET = 1, END = 2, FIRST = 3;

class BitWriter {
  constructor() { this.out = []; this.cur = 0; this.n = 0; }
  write(value, bits) {
    for (let i = bits - 1; i >= 0; i--) {
      this.cur = (this.cur << 1) | ((value >> i) & 1);
      if (++this.n === BITS) { this.out.push(String.fromCharCode(BASE + this.cur)); this.cur = 0; this.n = 0; }
    }
  }
  finish() {
    if (this.n) { this.cur <<= BITS - this.n; this.out.push(String.fromCharCode(BASE + this.cur)); this.cur = 0; this.n = 0; }
    return this.out.join('');
  }
}

class BitReader {
  constructor(text) { this.text = text; this.pos = 0; this.cur = 0; this.n = 0; }
  read(bits) {
    let v = 0;
    for (let i = 0; i < bits; i++) {
      if (this.n === 0) {
        if (this.pos >= this.text.length) throw new Error('압축 데이터가 중간에 끊겼습니다');
        const c = this.text.charCodeAt(this.pos++) - BASE;
        if (c < 0 || c >= 1 << BITS) throw new Error('압축 데이터가 올바르지 않습니다');
        this.cur = c; this.n = BITS;
      }
      v = (v << 1) | ((this.cur >> --this.n) & 1);
    }
    return v;
  }
}

export function compress(input) {
  const w = new BitWriter();
  let dict = new Map(), fresh = new Set(), next = FIRST, cur = '';
  const emit = (s) => {
    if (fresh.has(s)) { w.write(LITERAL, BITS); w.write(s.charCodeAt(0), 16); fresh.delete(s); } else w.write(dict.get(s), BITS);
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (next >= LIMIT) { if (cur) emit(cur); w.write(RESET, BITS); dict = new Map(); fresh = new Set(); next = FIRST; cur = ''; }
    if (!dict.has(c)) { dict.set(c, next++); fresh.add(c); }
    const cc = cur + c;
    if (dict.has(cc)) cur = cc;
    else { emit(cur); dict.set(cc, next++); cur = c; }
  }
  if (cur) emit(cur);
  w.write(END, BITS);
  return w.finish();
}

export function decompress(text) {
  const r = new BitReader(text);
  let dict = [], prev = null;
  const out = [];
  for (;;) {
    const code = r.read(BITS);
    if (code === END) break;
    if (code === RESET) { dict = []; prev = null; continue; }
    let entry;
    if (code === LITERAL) { entry = String.fromCharCode(r.read(16)); dict.push(entry); } // 부호기는 새 글자를 처음 본 때 항목으로 넣는다
    else {
      entry = dict[code - FIRST];
      if (entry === undefined) {
        if (code - FIRST === dict.length && prev !== null) entry = prev + prev[0]; // 방금 만들 항목을 바로 쓰는 경우
        else throw new Error('압축 데이터가 올바르지 않습니다');
      }
    }
    out.push(entry);
    if (prev !== null) dict.push(prev + entry[0]);
    prev = entry;
  }
  return out.join('');
}
