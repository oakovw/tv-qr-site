"use strict";
class QrCode {
    static encodeText(text, ecl) {
        const segs = QrSegment.makeSegments(text);
        return QrCode.encodeSegments(segs, ecl);
    }
    static encodeSegments(segs, ecl, minVersion = 1, maxVersion = 40, mask = -1, boostEcl = true) {
        if (!(minVersion >= 1 && minVersion <= maxVersion && maxVersion <= 40) || mask < -1 || mask > 7)
            throw new RangeError("Invalid value");
        let version;
        let dataUsedBits;
        for (version = minVersion; ; version++) {
            const dataCapacityBits = QrCode.getNumDataCodewords(version, ecl) * 8;
            const usedBits = QrSegment.getTotalBits(segs, version);
            if (usedBits <= dataCapacityBits) {
                dataUsedBits = usedBits;
                break;
            }
            if (version >= maxVersion)
                throw new RangeError("Data too long");
        }
        for (const newEcl of [Ecc.MEDIUM, Ecc.QUARTILE, Ecc.HIGH])
            if (boostEcl && dataUsedBits <= QrCode.getNumDataCodewords(version, newEcl) * 8)
                ecl = newEcl;
        const bb = [];
        for (const seg of segs) {
            appendBits(seg.mode.modeBits, 4, bb);
            appendBits(seg.numChars, seg.mode.numCharCountBits(version), bb);
            for (const b of seg.getData())
                bb.push(b);
        }
        const dataCapacityBits = QrCode.getNumDataCodewords(version, ecl) * 8;
        appendBits(0, Math.min(4, dataCapacityBits - bb.length), bb);
        appendBits(0, (8 - (bb.length % 8)) % 8, bb);
        for (let pad = 0xec; bb.length < dataCapacityBits; pad ^= 0xec ^ 0x11)
            appendBits(pad, 8, bb);
        const dataCodewords = [];
        while (dataCodewords.length * 8 < bb.length)
            dataCodewords.push(0);
        bb.forEach((b, i) => (dataCodewords[i >>> 3] |= b << (7 - (i & 7))));
        return new QrCode(version, ecl, dataCodewords, mask);
    }
    constructor(version, ecl, dataCodewords, msk) {
        if (version < 1 || version > 40)
            throw new RangeError("Version value out of range");
        if (msk < -1 || msk > 7)
            throw new RangeError("Mask value out of range");
        this.version = version;
        this.errorCorrectionLevel = ecl;
        this.size = version * 4 + 17;
        const row = Array.from({ length: this.size }, () => false);
        this.modules = Array.from({ length: this.size }, () => [...row]);
        this.isFunction = Array.from({ length: this.size }, () => [...row]);
        this.drawFunctionPatterns();
        const allCodewords = this.addEccAndInterleave(dataCodewords);
        this.drawCodewords(allCodewords);
        if (msk === -1) {
            let minPenalty = Infinity;
            for (let i = 0; i < 8; i++) {
                this.applyMask(i);
                this.drawFormatBits(i);
                const penalty = this.getPenaltyScore();
                if (penalty < minPenalty) {
                    msk = i;
                    minPenalty = penalty;
                }
                this.applyMask(i);
            }
        }
        this.mask = msk;
        this.applyMask(msk);
        this.drawFormatBits(msk);
    }
    getModule(x, y) {
        return x >= 0 && x < this.size && y >= 0 && y < this.size && this.modules[y][x];
    }
    drawFunctionPatterns() {
        for (let i = 0; i < this.size; i++) {
            this.setFunctionModule(6, i, i % 2 === 0);
            this.setFunctionModule(i, 6, i % 2 === 0);
        }
        this.drawFinderPattern(3, 3);
        this.drawFinderPattern(this.size - 4, 3);
        this.drawFinderPattern(3, this.size - 4);
        const align = this.getAlignmentPatternPositions();
        const n = align.length;
        for (let i = 0; i < n; i++)
            for (let j = 0; j < n; j++)
                if (!(i === 0 && j === 0 || i === 0 && j === n - 1 || i === n - 1 && j === 0))
                    this.drawAlignmentPattern(align[i], align[j]);
        this.drawFormatBits(0);
        this.drawVersion();
    }
    drawFormatBits(mask) {
        const data = (this.errorCorrectionLevel.formatBits << 3) | mask;
        let rem = data;
        for (let i = 0; i < 10; i++)
            rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        const bits = (data << 10) | rem;
        for (let i = 0; i <= 5; i++)
            this.setFunctionModule(8, i, ((bits >>> i) & 1) !== 0);
        this.setFunctionModule(8, 7, ((bits >>> 6) & 1) !== 0);
        this.setFunctionModule(8, 8, ((bits >>> 7) & 1) !== 0);
        this.setFunctionModule(7, 8, ((bits >>> 8) & 1) !== 0);
        for (let i = 9; i < 15; i++)
            this.setFunctionModule(14 - i, 8, ((bits >>> i) & 1) !== 0);
        for (let i = 0; i < 8; i++)
            this.setFunctionModule(this.size - 1 - i, 8, ((bits >>> i) & 1) !== 0);
        for (let i = 8; i < 15; i++)
            this.setFunctionModule(8, this.size - 15 + i, ((bits >>> i) & 1) !== 0);
        this.setFunctionModule(8, this.size - 8, true);
    }
    drawVersion() {
        if (this.version < 7)
            return;
        let rem = this.version;
        for (let i = 0; i < 12; i++)
            rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
        const bits = (this.version << 12) | rem;
        for (let i = 0; i < 18; i++) {
            const a = this.size - 11 + (i % 3);
            const b = Math.floor(i / 3);
            const color = ((bits >>> i) & 1) !== 0;
            this.setFunctionModule(a, b, color);
            this.setFunctionModule(b, a, color);
        }
    }
    drawFinderPattern(x, y) {
        for (let dy = -4; dy <= 4; dy++)
            for (let dx = -4; dx <= 4; dx++) {
                const dist = Math.max(Math.abs(dx), Math.abs(dy));
                const xx = x + dx;
                const yy = y + dy;
                if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size)
                    this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
            }
    }
    drawAlignmentPattern(x, y) {
        for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++)
                this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    setFunctionModule(x, y, dark) {
        this.modules[y][x] = dark;
        this.isFunction[y][x] = true;
    }
    addEccAndInterleave(data) {
        const ver = this.version;
        const ecl = this.errorCorrectionLevel;
        const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
        const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver];
        const rawCodewords = Math.floor(QrCode.getNumRawDataModules(ver) / 8);
        const shortBlockLen = Math.floor(rawCodewords / numBlocks);
        const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
        const rsDiv = reedSolomonComputeDivisor(blockEccLen);
        const blocks = [];
        for (let i = 0, k = 0; i < numBlocks; i++) {
            const len = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
            const dat = data.slice(k, k + len);
            k += dat.length;
            const ecc = reedSolomonComputeRemainder(dat, rsDiv);
            if (i < numShortBlocks)
                dat.push(0);
            blocks.push(dat.concat(ecc));
        }
        const result = [];
        for (let i = 0; i < blocks[0].length; i++)
            blocks.forEach((block, j) => {
                if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks)
                    result.push(block[i]);
            });
        return result;
    }
    drawCodewords(data) {
        if (data.length !== Math.floor(QrCode.getNumRawDataModules(this.version) / 8))
            throw new RangeError("Invalid argument");
        let i = 0;
        for (let right = this.size - 1; right >= 1; right -= 2) {
            if (right === 6)
                right = 5;
            for (let vert = 0; vert < this.size; vert++) {
                for (let j = 0; j < 2; j++) {
                    const x = right - j;
                    const upward = ((right + 1) & 2) === 0;
                    const y = upward ? this.size - 1 - vert : vert;
                    if (!this.isFunction[y][x] && i < data.length * 8) {
                        this.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
                        i++;
                    }
                }
            }
        }
    }
    applyMask(mask) {
        for (let y = 0; y < this.size; y++)
            for (let x = 0; x < this.size; x++) {
                let invert;
                switch (mask) {
                    case 0:
                        invert = (x + y) % 2 === 0;
                        break;
                    case 1:
                        invert = y % 2 === 0;
                        break;
                    case 2:
                        invert = x % 3 === 0;
                        break;
                    case 3:
                        invert = (x + y) % 3 === 0;
                        break;
                    case 4:
                        invert = ((Math.floor(x / 3) + Math.floor(y / 2)) % 2) === 0;
                        break;
                    case 5:
                        invert = ((x * y) % 2 + (x * y) % 3) === 0;
                        break;
                    case 6:
                        invert = (((x * y) % 2 + (x * y) % 3) % 2) === 0;
                        break;
                    case 7:
                        invert = (((x + y) % 2 + (x * y) % 3) % 2) === 0;
                        break;
                    default: throw new Error("Unreachable");
                }
                if (!this.isFunction[y][x] && invert)
                    this.modules[y][x] = !this.modules[y][x];
            }
    }
    getPenaltyScore() {
        let result = 0;
        for (let y = 0; y < this.size; y++) {
            let runColor = false;
            let runX = 0;
            const hist = [0, 0, 0, 0, 0, 0, 0];
            for (let x = 0; x < this.size; x++) {
                if (this.modules[y][x] === runColor) {
                    runX++;
                    if (runX === 5)
                        result += 3;
                    else if (runX > 5)
                        result++;
                }
                else {
                    finderPenaltyAddHistory(runX, hist);
                    if (!runColor)
                        result += finderPenaltyCountPatterns(hist) * 40;
                    runColor = this.modules[y][x];
                    runX = 1;
                }
            }
            result += finderPenaltyTerminateAndCount(runColor, runX, hist) * 40;
        }
        for (let x = 0; x < this.size; x++) {
            let runColor = false;
            let runY = 0;
            const hist = [0, 0, 0, 0, 0, 0, 0];
            for (let y = 0; y < this.size; y++) {
                if (this.modules[y][x] === runColor) {
                    runY++;
                    if (runY === 5)
                        result += 3;
                    else if (runY > 5)
                        result++;
                }
                else {
                    finderPenaltyAddHistory(runY, hist);
                    if (!runColor)
                        result += finderPenaltyCountPatterns(hist) * 40;
                    runColor = this.modules[y][x];
                    runY = 1;
                }
            }
            result += finderPenaltyTerminateAndCount(runColor, runY, hist) * 40;
        }
        for (let y = 0; y < this.size - 1; y++)
            for (let x = 0; x < this.size - 1; x++)
                if (this.modules[y][x] === this.modules[y][x + 1] &&
                    this.modules[y][x] === this.modules[y + 1][x] &&
                    this.modules[y][x] === this.modules[y + 1][x + 1])
                    result += 3;
        let dark = 0;
        for (const row of this.modules)
            dark += row.filter(Boolean).length;
        const k = Math.ceil(Math.abs(dark * 20 - this.size * this.size * 10) / (this.size * this.size)) - 1;
        result += k * 10;
        return result;
    }
    getAlignmentPatternPositions() {
        if (this.version === 1)
            return [];
        const num = Math.floor(this.version / 7) + 2;
        const step = Math.floor((this.version * 8 + num * 3 + 5) / (num * 4 - 4)) * 2;
        const res = [6];
        for (let pos = this.size - 7; res.length < num; pos -= step)
            res.splice(1, 0, pos);
        return res;
    }
    static getNumRawDataModules(ver) {
        if (ver < 1 || ver > 40)
            throw new RangeError("Version out of range");
        let res = 16 * ver * ver + 128 * ver + 64;
        if (ver >= 2) {
            const numAlign = Math.floor(ver / 7) + 2;
            res -= (25 * numAlign - 10) * numAlign - 55;
            if (ver >= 7)
                res -= 36;
        }
        return res;
    }
    static getNumDataCodewords(ver, ecl) {
        return Math.floor(QrCode.getNumRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
    }
}
QrCode.MIN_VERSION = 1;
QrCode.MAX_VERSION = 40;
class Ecc {
    constructor(ordinal, formatBits) {
        this.ordinal = ordinal;
        this.formatBits = formatBits;
    }
}
Ecc.LOW = new Ecc(0, 1);
Ecc.MEDIUM = new Ecc(1, 0);
Ecc.QUARTILE = new Ecc(2, 3);
Ecc.HIGH = new Ecc(3, 2);
class Mode {
    constructor(modeBits, numBitsCharCount) {
        this.modeBits = modeBits;
        this.numBitsCharCount = numBitsCharCount;
    }
    numCharCountBits(ver) {
        return this.numBitsCharCount[Math.floor((ver + 7) / 17)];
    }
}
class QrSegment {
    static makeSegments(text) {
        if (text === "")
            return [];
        if (/^[0-9]*$/.test(text))
            return [QrSegment.makeNumeric(text)];
        if (/^[A-Z0-9 $%*+.\/:-]*$/.test(text))
            return [QrSegment.makeAlphanumeric(text)];
        return [QrSegment.makeBytes(toUtf8ByteArray(text))];
    }
    static makeBytes(data) {
        const bb = [];
        for (const b of data)
            appendBits(b, 8, bb);
        return new QrSegment(QrSegment.BYTE, data.length, bb);
    }
    static makeNumeric(digits) {
        if (!/^[0-9]*$/.test(digits))
            throw new RangeError("Non-numeric");
        const bb = [];
        for (let i = 0; i < digits.length;) {
            const n = Math.min(digits.length - i, 3);
            appendBits(parseInt(digits.substring(i, i + n), 10), n * 3 + 1, bb);
            i += n;
        }
        return new QrSegment(QrSegment.NUMERIC, digits.length, bb);
    }
    static makeAlphanumeric(text) {
        const charset = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
        if (!new RegExp(`^[${charset}]*$`).test(text))
            throw new RangeError("Invalid chars");
        const bb = [];
        for (let i = 0; i + 2 <= text.length; i += 2) {
            const val = charset.indexOf(text[i]) * 45 + charset.indexOf(text[i + 1]);
            appendBits(val, 11, bb);
        }
        if (text.length % 2)
            appendBits(charset.indexOf(text[text.length - 1]), 6, bb);
        return new QrSegment(QrSegment.ALPHANUMERIC, text.length, bb);
    }
    static getTotalBits(segs, version) {
        let res = 0;
        for (const seg of segs) {
            const ccbits = seg.mode.numCharCountBits(version);
            if (seg.numChars >= 1 << ccbits)
                return Infinity;
            res += 4 + ccbits + seg.bitData.length;
        }
        return res;
    }
    constructor(mode, numChars, bitData) {
        this.mode = mode;
        this.numChars = numChars;
        this.bitData = bitData;
    }
    getData() {
        return [...this.bitData];
    }
}
QrSegment.NUMERIC = new Mode(0x1, [10, 12, 14]);
QrSegment.ALPHANUMERIC = new Mode(0x2, [9, 11, 13]);
QrSegment.BYTE = new Mode(0x4, [8, 16, 16]);
QrSegment.KANJI = new Mode(0x8, [8, 10, 12]);
QrSegment.ECI = new Mode(0x7, [0, 0, 0]);
/* ---------- helpers ---------- */
function appendBits(val, len, bb) {
    if (len < 0 || len > 31 || (val >>> len) !== 0)
        throw new RangeError("Value out of range");
    for (let i = len - 1; i >= 0; i--)
        bb.push(((val >>> i) & 1));
}
function getBit(x, i) {
    return ((x >>> i) & 1) !== 0;
}
function reedSolomonComputeDivisor(degree) {
    if (degree < 1 || degree > 255)
        throw new RangeError("Degree out of range");
    const res = Array(degree - 1).fill(0);
    res.push(1);
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < res.length; j++) {
            res[j] = reedSolomonMultiply(res[j], root);
            if (j + 1 < res.length)
                res[j] ^= res[j + 1];
        }
        root = reedSolomonMultiply(root, 0x02);
    }
    return res;
}
function reedSolomonComputeRemainder(data, divisor) {
    const res = divisor.map(() => 0);
    for (const b of data) {
        const factor = b ^ res.shift();
        res.push(0);
        divisor.forEach((coef, i) => (res[i] ^= reedSolomonMultiply(coef, factor)));
    }
    return res;
}
function reedSolomonMultiply(x, y) {
    if (x >>> 8 || y >>> 8)
        throw new RangeError("Byte out of range");
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
}
function finderPenaltyCountPatterns(hist) {
    const n = hist[1];
    const core = n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n;
    return ((core && hist[0] >= n * 4 && hist[6] >= n ? 1 : 0) +
        (core && hist[6] >= n * 4 && hist[0] >= n ? 1 : 0));
}
function finderPenaltyTerminateAndCount(currentRunColor, runLen, hist) {
    if (currentRunColor) {
        finderPenaltyAddHistory(runLen, hist);
        runLen = 0;
    }
    runLen += hist[0] === 0 ? hist[0] + hist.length : hist.length;
    finderPenaltyAddHistory(runLen, hist);
    return finderPenaltyCountPatterns(hist);
}
function finderPenaltyAddHistory(runLen, hist) {
    hist.pop();
    hist.unshift(runLen);
}
function toUtf8ByteArray(str) {
    str = encodeURI(str);
    const res = [];
    for (let i = 0; i < str.length; i++) {
        if (str[i] !== "%")
            res.push(str.charCodeAt(i));
        else {
            res.push(parseInt(str.substring(i + 1, i + 3), 16));
            i += 2;
        }
    }
    return res;
}
const ECC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
];
const NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
];
/* ---------- demo glue ---------- */
function initialize() {

    // Получение токена из URL
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (token) {
        // Сохраняем токен в sessionStorage
        sessionStorage.setItem('oauth_token', token);

        // Убираем токен из URL
        window.history.replaceState({}, document.title, "/");
    }

    // Функция для авторизованных запросов
    async function fetchWithAuth(url) {
        const token = sessionStorage.getItem('oauth_token');
        if (!token) {
            throw new Error('No authorization token');
        }

        return fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
    }

    // Пример использования
    document.addEventListener('DOMContentLoaded', async () => {
        // Все внутренние ссылки будут автоматически содержать токен
        const links = document.querySelectorAll('a[href^="/"]');
        links.forEach(link => {
            const href = link.getAttribute('href');
            if (!href.includes('?token=')) {
                link.href = href + (href.includes('?') ? '&' : '?') + 'token=' + sessionStorage.getItem('oauth_token');
            }
        });

        // Logout
        document.getElementById('logout')?.addEventListener('click', () => {
            sessionStorage.removeItem('oauth_token');
            window.location.href = '/';
        });
    });

    document.getElementById("loading").hidden = true;
    document.getElementById("loaded").hidden = false;
    // const inputs = document.querySelectorAll("input[type=number], input[type=text], textarea");
    // for (const el of inputs) {
    //   if (!(el as HTMLElement).id.startsWith("version-")) (el as any).oninput = makeText;
    // }
    // makeText();
    let elems = document.querySelectorAll("input[type=number], input[type=text], textarea");
    for (let el of elems) {
        if (el.id.indexOf("version-") != 0)
            el.oninput = makeText; // redrawQrCode;
    }
    elems = document.querySelectorAll("input[type=radio], input[type=checkbox]");
    for (let el of elems)
        el.onchange = makeText;
    redrawQrCode();
}
function makeText() {
    const fio = document.getElementById("fio-input").value;
    const sum = Number(document.getElementById("sum-input").value);
    const purp = document.getElementById("purp-input").value;
    const textInput = document.getElementById("text-input");
    const org = document.querySelector('input[name="org"]:checked').value;
    console.log('org: ', org);
    // textInput.value = `ST00012|Name=ООО «ТЕРРИТОРИЯ ДЕТСТВА»|PersonalAcc=40702810538000453171|BankName=ПАО Сбербанк|BIC=044525225|CorrespAcc=30101810400000000225|PayeeINN=7725641886|KPP=772901001|ChildFio=${fio}|Purpose=${purp}|Sum=${sum * 100}`;
    // redrawQrCode();
    let text;
    switch (org) {
        case "org-td":
            text = `ST00012|Name=ООО «ТЕРРИТОРИЯ ДЕТСТВА»|PersonalAcc=40702810538000453171|BankName=ПАО Сбербанк|BIC=044525225|CorrespAcc=30101810400000000225|PayeeINN=7725641886|KPP=772901001|ChildFio=${fio}|Purpose=${purp}|Sum=${sum * 100}`;
            break;
        case "org-sd":
            text = `ST00012|Name=АНО "СЧАСТЛИВОЕ ДЕТСТВО"|PersonalAcc=40703810738000017277|BankName=ПАО Сбербанк|BIC=044525225|CorrespAcc=30101810400000000225|PayeeINN=9729300383|KPP=772901001|Purpose=${purp}|Sum=${sum * 100}`;
            break;
        default:
            text = "";
    }
    textInput.value = text;
    redrawQrCode();
}
function redrawQrCode() {
    const text = document.getElementById("text-input").value;
    const qr = QrCode.encodeText(text, Ecc.MEDIUM);
    const canvas = document.getElementById("qrcode-canvas");
    const el = document.getElementById("qrcode-svg");
    const org = document.querySelector('input[name="org"]:checked').value;
    if (!(el instanceof SVGElement))
        throw new Error("SVG element not found");
    const svg = el;
    canvas.hidden = false;
    svg.style.display = "none";
    drawCanvas(qr, 6, 2, "#FFFFFF", "#000000", canvas, org);
    const download = document.getElementById("download");
    download.download = "qr-code.png";
    download.href = canvas.toDataURL("image/png");
}
function drawCanvas(qr, scale, border, light, dark, canvas, org) {
    const width = (qr.size + border * 2) * scale;
    canvas.width = width;
    canvas.height = width + 100;
    const ctx = canvas.getContext("2d");
    for (let y = -border; y < qr.size + border; y++)
        for (let x = -border; x < qr.size + border; x++) {
            ctx.fillStyle = qr.getModule(x, y) ? dark : light;
            ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
        }
    ctx.fillStyle = light;
    ctx.fillRect(0, width, width, 100);
    let lines;
    switch (org) {
        case "org-td":
            lines = [
                "Реквизиты оплаты:",
                "Наименование организации: ООО «ТЕРРИТОРИЯ ДЕТСТВА»",
                "ОГРН 1087746828180, ИНН 7725641886, КПП 772901001",
                "Расчетный счет № 40702810538000453171",
                "Наименование банка: ПАО Сбербанк, БИК: 044525225",
                "Корреспондентский счет: 30101810400000000225"
            ];
            break;
        case "org-sd":
            lines = [
                'Реквизиты оплаты:',
                'Наименование организации: АНО «СЧАСТЛИВОЕ ДЕТСТВО»',
                'ИНН: 9729300383, КПП: 772901001',
                'Номер расчетного счета: 40703810738000017277',
                'Наименование банка: ПАО Сбербанк, БИК: 044525225',
                'Корреспондентский счет: 30101810400000000225'
            ];
            break;
        default:
            lines = [];
    }
    // const lines = [
    //   "Реквизиты оплаты:",
    //   "Наименование организации: ООО «ТЕРРИТОРИЯ ДЕТСТВА»",
    //   "ОГРН 1087746828180, ИНН 7725641886, КПП 772901001",
    //   "Расчетный счет № 40702810538000453171",
    //   "Наименование банка: ПАО Сбербанк, БИК: 044525225",
    //   "Корреспондентский счет: 30101810400000000225"
    // ];
    ctx.font = "12px sans-serif";
    ctx.fillStyle = dark;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let y = width + 10;
    for (const line of lines) {
        ctx.fillText(line, 10, y);
        y += 14.4;
    }
}
// В конце qr.js замените:
initialize();

// // На:
// if (document.readyState === 'loading') {
//     document.addEventListener('DOMContentLoaded', initialize);
// } else {
//     initialize();
// }