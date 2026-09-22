export async function hashAvatarIdentity(value: string): Promise<string> {
  const normalizedValue = value.trim().toLowerCase();

  if (!normalizedValue) {
    return '';
  }

  if (globalThis.crypto?.subtle) {
    try {
      const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(normalizedValue)
      );
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      return createMd5Hash(normalizedValue);
    }
  }

  return createMd5Hash(normalizedValue);
}

function createMd5Hash(value: string): string {
  const words = createMd5WordArray(value);
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  for (let i = 0; i < words.length; i += 16) {
    const originalA = a;
    const originalB = b;
    const originalC = c;
    const originalD = d;

    a = md5Round(ff, a, b, c, d, words[i], 7, 0xd76aa478);
    d = md5Round(ff, d, a, b, c, words[i + 1], 12, 0xe8c7b756);
    c = md5Round(ff, c, d, a, b, words[i + 2], 17, 0x242070db);
    b = md5Round(ff, b, c, d, a, words[i + 3], 22, 0xc1bdceee);
    a = md5Round(ff, a, b, c, d, words[i + 4], 7, 0xf57c0faf);
    d = md5Round(ff, d, a, b, c, words[i + 5], 12, 0x4787c62a);
    c = md5Round(ff, c, d, a, b, words[i + 6], 17, 0xa8304613);
    b = md5Round(ff, b, c, d, a, words[i + 7], 22, 0xfd469501);
    a = md5Round(ff, a, b, c, d, words[i + 8], 7, 0x698098d8);
    d = md5Round(ff, d, a, b, c, words[i + 9], 12, 0x8b44f7af);
    c = md5Round(ff, c, d, a, b, words[i + 10], 17, 0xffff5bb1);
    b = md5Round(ff, b, c, d, a, words[i + 11], 22, 0x895cd7be);
    a = md5Round(ff, a, b, c, d, words[i + 12], 7, 0x6b901122);
    d = md5Round(ff, d, a, b, c, words[i + 13], 12, 0xfd987193);
    c = md5Round(ff, c, d, a, b, words[i + 14], 17, 0xa679438e);
    b = md5Round(ff, b, c, d, a, words[i + 15], 22, 0x49b40821);

    a = md5Round(gg, a, b, c, d, words[i + 1], 5, 0xf61e2562);
    d = md5Round(gg, d, a, b, c, words[i + 6], 9, 0xc040b340);
    c = md5Round(gg, c, d, a, b, words[i + 11], 14, 0x265e5a51);
    b = md5Round(gg, b, c, d, a, words[i], 20, 0xe9b6c7aa);
    a = md5Round(gg, a, b, c, d, words[i + 5], 5, 0xd62f105d);
    d = md5Round(gg, d, a, b, c, words[i + 10], 9, 0x02441453);
    c = md5Round(gg, c, d, a, b, words[i + 15], 14, 0xd8a1e681);
    b = md5Round(gg, b, c, d, a, words[i + 4], 20, 0xe7d3fbc8);
    a = md5Round(gg, a, b, c, d, words[i + 9], 5, 0x21e1cde6);
    d = md5Round(gg, d, a, b, c, words[i + 14], 9, 0xc33707d6);
    c = md5Round(gg, c, d, a, b, words[i + 3], 14, 0xf4d50d87);
    b = md5Round(gg, b, c, d, a, words[i + 8], 20, 0x455a14ed);
    a = md5Round(gg, a, b, c, d, words[i + 13], 5, 0xa9e3e905);
    d = md5Round(gg, d, a, b, c, words[i + 2], 9, 0xfcefa3f8);
    c = md5Round(gg, c, d, a, b, words[i + 7], 14, 0x676f02d9);
    b = md5Round(gg, b, c, d, a, words[i + 12], 20, 0x8d2a4c8a);

    a = md5Round(hh, a, b, c, d, words[i + 5], 4, 0xfffa3942);
    d = md5Round(hh, d, a, b, c, words[i + 8], 11, 0x8771f681);
    c = md5Round(hh, c, d, a, b, words[i + 11], 16, 0x6d9d6122);
    b = md5Round(hh, b, c, d, a, words[i + 14], 23, 0xfde5380c);
    a = md5Round(hh, a, b, c, d, words[i + 1], 4, 0xa4beea44);
    d = md5Round(hh, d, a, b, c, words[i + 4], 11, 0x4bdecfa9);
    c = md5Round(hh, c, d, a, b, words[i + 7], 16, 0xf6bb4b60);
    b = md5Round(hh, b, c, d, a, words[i + 10], 23, 0xbebfbc70);
    a = md5Round(hh, a, b, c, d, words[i + 13], 4, 0x289b7ec6);
    d = md5Round(hh, d, a, b, c, words[i], 11, 0xeaa127fa);
    c = md5Round(hh, c, d, a, b, words[i + 3], 16, 0xd4ef3085);
    b = md5Round(hh, b, c, d, a, words[i + 6], 23, 0x04881d05);
    a = md5Round(hh, a, b, c, d, words[i + 9], 4, 0xd9d4d039);
    d = md5Round(hh, d, a, b, c, words[i + 12], 11, 0xe6db99e5);
    c = md5Round(hh, c, d, a, b, words[i + 15], 16, 0x1fa27cf8);
    b = md5Round(hh, b, c, d, a, words[i + 2], 23, 0xc4ac5665);

    a = md5Round(ii, a, b, c, d, words[i], 6, 0xf4292244);
    d = md5Round(ii, d, a, b, c, words[i + 7], 10, 0x432aff97);
    c = md5Round(ii, c, d, a, b, words[i + 14], 15, 0xab9423a7);
    b = md5Round(ii, b, c, d, a, words[i + 5], 21, 0xfc93a039);
    a = md5Round(ii, a, b, c, d, words[i + 12], 6, 0x655b59c3);
    d = md5Round(ii, d, a, b, c, words[i + 3], 10, 0x8f0ccc92);
    c = md5Round(ii, c, d, a, b, words[i + 10], 15, 0xffeff47d);
    b = md5Round(ii, b, c, d, a, words[i + 1], 21, 0x85845dd1);
    a = md5Round(ii, a, b, c, d, words[i + 8], 6, 0x6fa87e4f);
    d = md5Round(ii, d, a, b, c, words[i + 15], 10, 0xfe2ce6e0);
    c = md5Round(ii, c, d, a, b, words[i + 6], 15, 0xa3014314);
    b = md5Round(ii, b, c, d, a, words[i + 13], 21, 0x4e0811a1);
    a = md5Round(ii, a, b, c, d, words[i + 4], 6, 0xf7537e82);
    d = md5Round(ii, d, a, b, c, words[i + 11], 10, 0xbd3af235);
    c = md5Round(ii, c, d, a, b, words[i + 2], 15, 0x2ad7d2bb);
    b = md5Round(ii, b, c, d, a, words[i + 9], 21, 0xeb86d391);

    a = addUnsigned(a, originalA);
    b = addUnsigned(b, originalB);
    c = addUnsigned(c, originalC);
    d = addUnsigned(d, originalD);
  }

  return [a, b, c, d].map(toLittleEndianHex).join('');
}

function createMd5WordArray(value: string): number[] {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const wordArray: number[] = [];

  for (let i = 0; i < bytes.length; i += 1) {
    wordArray[i >> 2] = wordArray[i >> 2] || 0;
    wordArray[i >> 2] |= bytes[i] << ((i % 4) * 8);
  }

  wordArray[bitLength >> 5] = wordArray[bitLength >> 5] || 0;
  wordArray[bitLength >> 5] |= 0x80 << (bitLength % 32);
  wordArray[(((bitLength + 64) >>> 9) << 4) + 14] = bitLength;

  return wordArray.map((word) => word || 0);
}

function md5Round(
  transform: (x: number, y: number, z: number) => number,
  a: number,
  b: number,
  c: number,
  d: number,
  x: number,
  s: number,
  ac: number
): number {
  return addUnsigned(
    rotateLeft(
      addUnsigned(addUnsigned(a, transform(b, c, d)), addUnsigned(x || 0, ac)),
      s
    ),
    b
  );
}

function ff(x: number, y: number, z: number): number {
  return (x & y) | (~x & z);
}

function gg(x: number, y: number, z: number): number {
  return (x & z) | (y & ~z);
}

function hh(x: number, y: number, z: number): number {
  return x ^ y ^ z;
}

function ii(x: number, y: number, z: number): number {
  return y ^ (x | ~z);
}

function rotateLeft(value: number, shift: number): number {
  return (value << shift) | (value >>> (32 - shift));
}

function addUnsigned(left: number, right: number): number {
  return (left + right) >>> 0;
}

function toLittleEndianHex(value: number): string {
  let output = '';

  for (let i = 0; i <= 3; i += 1) {
    output += ((value >>> (i * 8)) & 255).toString(16).padStart(2, '0');
  }

  return output;
}
