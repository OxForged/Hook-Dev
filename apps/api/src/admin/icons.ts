import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

/**
 * Listing icon processing. The bytes an uploader sends are NEVER stored or
 * served. What is stored is a re-built file:
 *
 *   PNG  every chunk CRC-checked; IHDR validated; the IDAT stream inflated with a
 *        hard output cap and required to be exactly the size IHDR implies; then
 *        re-assembled from IHDR, PLTE, tRNS, IDAT and IEND only. Text/EXIF/iCCP
 *        chunks, APNG frames and anything after IEND (the polyglot trick) are
 *        dropped because they are never copied.
 *   SVG  parsed by a strict tokenizer against an element and attribute ALLOWLIST
 *        and REJECTED (not stripped) on anything outside it: script,
 *        foreignObject, style, image, a, animation, event handlers, external or
 *        data: references, DOCTYPE/ENTITY, CDATA, processing instructions. A file
 *        that passes is RE-SERIALISED from the parse tree, so no byte of the
 *        original markup reaches a browser.
 *
 * Served with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`
 * and `X-Content-Type-Options: nosniff` (see http/listings.ts).
 */

export const ICON_LIMITS = {
  pngMaxBytes: 256 * 1024,
  svgMaxBytes: 64 * 1024,
  maxDimension: 2048,
  minDimension: 16,
  svgMaxElements: 2_000,
  svgMaxDepth: 32,
} as const;

export type IconType = "image/png" | "image/svg+xml";

export interface ProcessedIcon {
  contentType: IconType;
  bytes: Buffer;
  width: number | null;
  height: number | null;
  sha256: string;
}

export class IconRejected extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "IconRejected";
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Sniff, never trust the declared type alone; then process. */
export function processIcon(declared: string, bytes: Buffer): ProcessedIcon {
  if (bytes.length === 0) throw new IconRejected("empty file");
  const looksPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE);
  if (declared === "image/png") {
    if (!looksPng) throw new IconRejected("declared image/png but the file does not start with the PNG signature");
    return finish("image/png", processPng(bytes));
  }
  if (declared === "image/svg+xml") {
    if (looksPng) throw new IconRejected("declared image/svg+xml but the file is a PNG");
    return finish("image/svg+xml", sanitizeSvg(bytes));
  }
  throw new IconRejected("only image/png and image/svg+xml are accepted");
}

function finish(contentType: IconType, r: { bytes: Buffer; width: number | null; height: number | null }): ProcessedIcon {
  return { contentType, ...r, sha256: createHash("sha256").update(r.bytes).digest("hex") };
}

/* ===========================================================================
   PNG
   =========================================================================== */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const KEEP_CHUNKS = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const VALID_DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

function rawSize(width: number, height: number, bitsPerPixel: number): number {
  if (width === 0 || height === 0) return 0;
  return height * (1 + Math.ceil((width * bitsPerPixel) / 8));
}

/** Expected inflated IDAT length, including Adam7 passes for interlaced images. */
export function expectedIdatLength(width: number, height: number, bitDepth: number, colorType: number, interlace: number): number {
  const bpp = bitDepth * CHANNELS[colorType]!;
  if (interlace === 0) return rawSize(width, height, bpp);
  const passes = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
  ];
  let total = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const w = Math.ceil((width - x0!) / dx!);
    const h = Math.ceil((height - y0!) / dy!);
    if (w > 0 && h > 0) total += rawSize(w, h, bpp);
  }
  return total;
}

export function processPng(bytes: Buffer): { bytes: Buffer; width: number; height: number } {
  if (bytes.length > ICON_LIMITS.pngMaxBytes) throw new IconRejected(`PNG is ${bytes.length} bytes; the limit is ${ICON_LIMITS.pngMaxBytes}`);
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new IconRejected("not a PNG");
  let off = 8;
  const kept: Buffer[] = [PNG_SIGNATURE];
  const idat: Buffer[] = [];
  let ihdr: { width: number; height: number; bitDepth: number; colorType: number; interlace: number } | null = null;
  let sawIend = false;
  let sawPlte = false;
  let lastType = "";
  let idatClosed = false;

  while (off < bytes.length) {
    if (off + 12 > bytes.length) throw new IconRejected("truncated chunk header");
    const len = bytes.readUInt32BE(off);
    if (len > 0x7fffffff || off + 12 + len > bytes.length) throw new IconRejected("chunk length runs past the end of the file");
    const type = bytes.subarray(off + 4, off + 8).toString("latin1");
    if (!/^[A-Za-z]{4}$/.test(type)) throw new IconRejected("malformed chunk type");
    const data = bytes.subarray(off + 8, off + 8 + len);
    const crc = bytes.readUInt32BE(off + 8 + len);
    if (crc32(bytes.subarray(off + 4, off + 8 + len)) !== crc) throw new IconRejected(`CRC mismatch in ${type}`);
    const chunk = bytes.subarray(off, off + 12 + len);
    off += 12 + len;

    if (kept.length === 1 && type !== "IHDR") throw new IconRejected("first chunk is not IHDR");
    if (type === "IHDR") {
      if (ihdr) throw new IconRejected("duplicate IHDR");
      if (len !== 13) throw new IconRejected("IHDR must be 13 bytes");
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      const bitDepth = data[8]!;
      const colorType = data[9]!;
      const compression = data[10]!;
      const filter = data[11]!;
      const interlace = data[12]!;
      if (!(colorType in VALID_DEPTHS) || !VALID_DEPTHS[colorType]!.includes(bitDepth)) throw new IconRejected("invalid bit depth / colour type");
      if (compression !== 0 || filter !== 0 || interlace > 1) throw new IconRejected("invalid IHDR compression, filter or interlace method");
      if (width < ICON_LIMITS.minDimension || height < ICON_LIMITS.minDimension) throw new IconRejected(`image is ${width}x${height}; at least ${ICON_LIMITS.minDimension}x${ICON_LIMITS.minDimension} is required`);
      if (width > ICON_LIMITS.maxDimension || height > ICON_LIMITS.maxDimension) throw new IconRejected(`image is ${width}x${height}; the limit is ${ICON_LIMITS.maxDimension}x${ICON_LIMITS.maxDimension}`);
      ihdr = { width, height, bitDepth, colorType, interlace };
      kept.push(chunk);
    } else if (type === "IEND") {
      sawIend = true;
      kept.push(chunk);
      break; // anything after IEND is dropped, never copied
    } else if (type === "IDAT") {
      if (idatClosed) throw new IconRejected("IDAT chunks must be consecutive");
      idat.push(data);
      kept.push(chunk);
    } else if (type === "PLTE") {
      if (sawPlte || idat.length) throw new IconRejected("misplaced PLTE");
      sawPlte = true;
      kept.push(chunk);
    } else if (type === "tRNS") {
      if (idat.length) throw new IconRejected("tRNS after IDAT");
      kept.push(chunk);
    } else {
      // Ancillary or unknown chunk: dropped. A critical (uppercase) unknown chunk is refused.
      if (type[0] === type[0]!.toUpperCase()) throw new IconRejected(`unknown critical chunk ${type}`);
    }
    if (lastType === "IDAT" && type !== "IDAT") idatClosed = true;
    lastType = type;
  }
  if (!ihdr) throw new IconRejected("no IHDR");
  if (!sawIend) throw new IconRejected("no IEND");
  if (idat.length === 0) throw new IconRejected("no image data");
  if (ihdr.colorType === 3 && !sawPlte) throw new IconRejected("palette image without PLTE");

  const expected = expectedIdatLength(ihdr.width, ihdr.height, ihdr.bitDepth, ihdr.colorType, ihdr.interlace);
  let inflated: Buffer;
  try {
    // Hard output cap: a decompression bomb stops at expected + 1 bytes.
    inflated = inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 });
  } catch {
    throw new IconRejected("image data does not decompress to the size its header declares");
  }
  if (inflated.length !== expected) throw new IconRejected("image data does not decompress to the size its header declares");
  return { bytes: Buffer.concat(kept), width: ihdr.width, height: ihdr.height };
}

/* ===========================================================================
   SVG
   =========================================================================== */

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

const ALLOWED_ELEMENTS = new Set([
  "svg", "g", "defs", "symbol", "use", "title", "desc",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "linearGradient", "radialGradient", "stop", "clipPath", "mask",
]);

/** Named here so the rejection message says WHY, not just "not allowed". */
const DANGEROUS_ELEMENTS = new Set([
  "script", "foreignObject", "style", "image", "a", "iframe", "object", "embed",
  "animate", "animateMotion", "animateTransform", "set", "discard", "handler", "listener",
  "feImage", "filter", "pattern", "text", "textPath", "tref", "font", "font-face", "switch", "video", "audio",
]);

const ALLOWED_ATTRIBUTES = new Set([
  "xmlns", "xmlns:xlink", "version", "id", "viewBox", "width", "height", "preserveAspectRatio",
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr", "d", "points",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity",
  "transform", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod",
  "clip-path", "clip-rule", "clipPathUnits", "mask", "maskUnits", "maskContentUnits",
  "href", "xlink:href", "shape-rendering", "vector-effect", "color",
]);

const TEXT_ELEMENTS = new Set(["title", "desc"]);
const REFERENCE_ATTRIBUTES = new Set(["href", "xlink:href"]);
const LOCAL_FRAGMENT = /^#[A-Za-z_][\w.-]{0,64}$/;
/** `url(#id)` is the only url() allowed, in any attribute. */
const URL_FUNC = /url\s*\(/i;
const LOCAL_URL_ONLY = /^url\(\s*#[A-Za-z_][\w.-]{0,64}\s*\)$/;

interface SvgNode {
  name: string;
  attrs: [string, string][];
  children: (SvgNode | string)[];
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const cp = e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    if (!Number.isFinite(cp) || cp > 0x10ffff || cp === 0) throw new IconRejected("invalid character reference");
    return String.fromCodePoint(cp);
  });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function checkAttribute(element: string, name: string, rawValue: string): string {
  if (/^on/i.test(name)) throw new IconRejected(`event handler attribute "${name}" on <${element}>`);
  if (!ALLOWED_ATTRIBUTES.has(name)) {
    if (name === "style") throw new IconRejected(`style attribute on <${element}> (CSS can load external resources)`);
    throw new IconRejected(`attribute "${name}" on <${element}> is not allowed`);
  }
  if (/&[A-Za-z][A-Za-z0-9]*;/.test(rawValue) && !/&(amp|lt|gt|quot|apos);/.test(rawValue)) throw new IconRejected("named entity references are not allowed");
  const value = decodeEntities(rawValue);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new IconRejected(`control character in "${name}"`);
  const compact = value.replace(/\s+/g, "").toLowerCase();
  if (compact.includes("javascript:") || compact.includes("data:") || compact.includes("vbscript:")) {
    throw new IconRejected(`script or data: URL in "${name}" on <${element}>`);
  }
  if (REFERENCE_ATTRIBUTES.has(name) && !LOCAL_FRAGMENT.test(value.trim())) {
    throw new IconRejected(`external reference in ${name}="${value.slice(0, 60)}" on <${element}>; only #fragment references are allowed`);
  }
  if (URL_FUNC.test(value) && !LOCAL_URL_ONLY.test(value.trim())) {
    throw new IconRejected(`external url() in "${name}" on <${element}>; only url(#id) is allowed`);
  }
  if (name === "xmlns" && value !== SVG_NS) throw new IconRejected(`unexpected namespace ${value.slice(0, 60)}`);
  if (name === "xmlns:xlink" && value !== XLINK_NS) throw new IconRejected(`unexpected xlink namespace ${value.slice(0, 60)}`);
  if (value.length > 20_000) throw new IconRejected(`attribute "${name}" is too long`);
  return value;
}

export function parseSvg(text: string): SvgNode {
  if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) throw new IconRejected("DOCTYPE and ENTITY declarations are not allowed");
  if (text.includes("<![CDATA[")) throw new IconRejected("CDATA sections are not allowed");
  let src = text.replace(/^\uFEFF/, "");
  const decl = /^\s*<\?xml\s[^?]*\?>/.exec(src);
  if (decl) src = src.slice(decl[0].length);
  if (src.includes("<?")) throw new IconRejected("processing instructions are not allowed");

  const tagRe = /<!--([\s\S]*?)-->|<\/([A-Za-z][\w:.-]*)\s*>|<([A-Za-z][\w:.-]*)((?:\s+[A-Za-z_:][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;
  const attrRe = /\s+([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g;

  const stack: SvgNode[] = [];
  let root: SvgNode | null = null;
  let count = 0;
  let pos = 0;
  while (pos < src.length) {
    const lt = src.indexOf("<", pos);
    const textEnd = lt === -1 ? src.length : lt;
    if (textEnd > pos) {
      const chunk = src.slice(pos, textEnd);
      const top = stack.at(-1);
      if (!top) {
        if (chunk.trim()) throw new IconRejected("text outside the root element");
      } else if (chunk.trim()) {
        if (!TEXT_ELEMENTS.has(top.name)) throw new IconRejected(`text content inside <${top.name}> is not allowed`);
        if (chunk.includes(">")) throw new IconRejected("stray '>' in text");
        top.children.push(decodeEntities(chunk));
      }
      pos = textEnd;
      if (lt === -1) break;
    }
    tagRe.lastIndex = pos;
    const m = tagRe.exec(src);
    if (!m) throw new IconRejected("malformed markup");
    pos = tagRe.lastIndex;
    if (m[1] !== undefined) continue; // comment: dropped
    if (m[2] !== undefined) {
      const top = stack.pop();
      if (!top || top.name !== m[2]) throw new IconRejected(`mismatched closing tag </${m[2]}>`);
      continue;
    }
    const name = m[3]!;
    if (DANGEROUS_ELEMENTS.has(name)) throw new IconRejected(`<${name}> is not allowed`);
    if (!ALLOWED_ELEMENTS.has(name)) throw new IconRejected(`<${name}> is not an allowed SVG element`);
    if (root && stack.length === 0) throw new IconRejected("more than one root element");
    if (!root && name !== "svg") throw new IconRejected("the root element must be <svg>");
    if (++count > ICON_LIMITS.svgMaxElements) throw new IconRejected(`more than ${ICON_LIMITS.svgMaxElements} elements`);
    const attrs: [string, string][] = [];
    const seen = new Set<string>();
    for (const a of (m[4] ?? "").matchAll(attrRe)) {
      const an = a[1]!;
      if (seen.has(an)) throw new IconRejected(`duplicate attribute ${an}`);
      seen.add(an);
      attrs.push([an, checkAttribute(name, an, a[2] ?? a[3] ?? "")]);
    }
    const node: SvgNode = { name, attrs, children: [] };
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else root = node;
    if (m[5] !== "/") {
      stack.push(node);
      if (stack.length > ICON_LIMITS.svgMaxDepth) throw new IconRejected("nesting too deep");
    }
  }
  if (stack.length) throw new IconRejected(`unclosed <${stack.at(-1)!.name}>`);
  if (!root) throw new IconRejected("no <svg> root element");
  return root;
}

function serialize(n: SvgNode | string): string {
  if (typeof n === "string") return escapeText(n);
  let attrs = n.attrs.filter(([k]) => k !== "xmlns");
  if (n.name === "svg") attrs = [["xmlns", SVG_NS], ...attrs];
  const a = attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("");
  return n.children.length ? `<${n.name}${a}>${n.children.map(serialize).join("")}</${n.name}>` : `<${n.name}${a}/>`;
}

function svgDimensions(root: SvgNode): { width: number | null; height: number | null } {
  const get = (k: string) => root.attrs.find(([n]) => n === k)?.[1];
  const num = (v: string | undefined) => {
    const m = v ? /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/.exec(v) : null;
    return m ? Number(m[1]) : null;
  };
  let width = num(get("width"));
  let height = num(get("height"));
  const vb = get("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if ((width === null || height === null) && vb && vb.length === 4 && vb.every(Number.isFinite)) {
    width ??= vb[2]!;
    height ??= vb[3]!;
  }
  if ((width !== null && width > ICON_LIMITS.maxDimension * 8) || (height !== null && height > ICON_LIMITS.maxDimension * 8)) {
    throw new IconRejected("SVG declares an unreasonable size");
  }
  return { width: width === null ? null : Math.round(width), height: height === null ? null : Math.round(height) };
}

export function sanitizeSvg(bytes: Buffer): { bytes: Buffer; width: number | null; height: number | null } {
  if (bytes.length > ICON_LIMITS.svgMaxBytes) throw new IconRejected(`SVG is ${bytes.length} bytes; the limit is ${ICON_LIMITS.svgMaxBytes}`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new IconRejected("SVG is not valid UTF-8");
  }
  const root = parseSvg(text);
  const out = serialize(root);
  return { bytes: Buffer.from(out, "utf8"), ...svgDimensions(root) };
}
