import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, ICON_LIMITS, IconRejected, processIcon, sanitizeSvg } from "../src/admin/icons.js";

/* ---- PNG fixtures, built in-test ------------------------------------------ */

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(opts: { width?: number; height?: number; extra?: Buffer[]; trailing?: Buffer; rawOverride?: Buffer } = {}): Buffer {
  const w = opts.width ?? 16;
  const h = opts.height ?? 16;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = opts.rawOverride ?? Buffer.alloc(h * (1 + w * 4), 0x7f);
  if (!opts.rawOverride) for (let y = 0; y < h; y++) raw[y * (1 + w * 4)] = 0; // filter byte
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...(opts.extra ?? []),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
    opts.trailing ?? Buffer.alloc(0),
  ]);
}

const rejects = (fn: () => unknown, re: RegExp) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(IconRejected);
    expect((e as IconRejected).reason).toMatch(re);
    return;
  }
  throw new Error("expected IconRejected");
};

describe("PNG icons are rebuilt, never passed through", () => {
  it("accepts a valid PNG and drops text chunks and anything after IEND", () => {
    const input = png({ extra: [chunk("tEXt", Buffer.from("Comment\0<script>alert(1)</script>"))], trailing: Buffer.from("<svg onload=alert(1)>") });
    const out = processIcon("image/png", input);
    expect(out.contentType).toBe("image/png");
    expect(out.width).toBe(16);
    expect(out.bytes.includes(Buffer.from("tEXt"))).toBe(false);
    expect(out.bytes.includes(Buffer.from("script"))).toBe(false);
    expect(out.bytes.includes(Buffer.from("onload"))).toBe(false);
    expect(out.bytes.subarray(-8).toString("latin1").slice(0, 4)).toBe("IEND");
  });

  it("rejects a CRC mismatch, a wrong declared type, a decompression-size lie, and oversize images", () => {
    const bad = png();
    bad[bad.length - 13] = (bad[bad.length - 13] ?? 0) ^ 0xff; // corrupt the last IDAT CRC byte
    rejects(() => processIcon("image/png", bad), /CRC|decompress/);
    rejects(() => processIcon("image/png", Buffer.from("<svg/>")), /PNG signature/);
    rejects(() => processIcon("image/svg+xml", png()), /is a PNG/);
    rejects(() => processIcon("image/png", png({ rawOverride: Buffer.alloc(10, 0) })), /decompress/);
    rejects(() => processIcon("image/png", png({ width: ICON_LIMITS.maxDimension + 1, height: 16, rawOverride: Buffer.alloc(1) })), /limit/);
    rejects(() => processIcon("image/png", png({ width: 8, height: 8 })), /at least/);
    rejects(() => processIcon("image/gif", png()), /only image\/png/);
  });

  it("caps a decompression bomb at the size the header declares", () => {
    // 16x16 declares 1,040 raw bytes; this stream inflates to 10 MB.
    rejects(() => processIcon("image/png", png({ rawOverride: Buffer.alloc(10_000_000, 0) })), /decompress/);
  });
});

describe("SVG icons: allowlist, reject, re-serialise", () => {
  const svg = (inner: string, attrs = 'viewBox="0 0 24 24"') => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`);

  it("accepts a plain mark and re-serialises it without comments", () => {
    const out = sanitizeSvg(Buffer.from(`<?xml version="1.0"?><!-- hi --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><title>Mark &amp; co</title><defs><linearGradient id="g"><stop offset="0" stop-color="#2f5fe0"/></linearGradient></defs><path d="M0 0h24v24H0z" fill="url(#g)"/><use href="#g"/></svg>`));
    const text = out.bytes.toString("utf8");
    expect(text.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(text).not.toContain("<!--");
    expect(text).not.toContain("<?xml");
    expect(text).toContain("Mark &amp; co");
    expect(out.width).toBe(24);
  });

  it("rejects <script>", () => rejects(() => sanitizeSvg(svg("<script>alert(1)</script>")), /<script> is not allowed/));
  it("rejects <foreignObject>", () => rejects(() => sanitizeSvg(svg('<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>')), /<foreignObject> is not allowed/));
  it("rejects an external href", () => rejects(() => sanitizeSvg(svg('<use href="https://evil.example/sprite.svg#a"/>')), /external reference/));
  it("rejects an external xlink:href", () => rejects(() => sanitizeSvg(svg('<use xlink:href="//evil.example/a.svg#x"/>', 'xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1 1"')), /external reference/));
  it("rejects an external url() in a presentation attribute", () => rejects(() => sanitizeSvg(svg('<path d="M0 0" fill="url(https://evil.example/p.svg#g)"/>')), /external url\(\)/));
  it("rejects <image> (external or data:)", () => rejects(() => sanitizeSvg(svg('<image href="data:image/png;base64,AAAA"/>')), /<image> is not allowed/));
  it("rejects event handlers", () => rejects(() => sanitizeSvg(svg('<rect width="1" height="1" onclick="alert(1)"/>')), /event handler/));
  it("rejects style attributes and <style>", () => {
    rejects(() => sanitizeSvg(svg('<rect width="1" height="1" style="fill:url(https://x.example/a)"/>')), /style attribute/);
    rejects(() => sanitizeSvg(svg("<style>@import url(https://x.example/a.css);</style>")), /<style> is not allowed/);
  });
  it("rejects javascript: hidden behind a character reference", () => rejects(() => sanitizeSvg(svg('<use href="&#106;avascript:alert(1)"/>')), /script or data: URL/));
  it("rejects DOCTYPE/ENTITY (billion laughs, XXE)", () => rejects(() => sanitizeSvg(Buffer.from('<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>')), /DOCTYPE/));
  it("rejects CDATA and processing instructions", () => {
    rejects(() => sanitizeSvg(svg("<title><![CDATA[x]]></title>")), /CDATA/);
    rejects(() => sanitizeSvg(svg('<?xml-stylesheet href="https://x.example/a.css"?>')), /processing instructions/);
  });
  it("rejects animation that can rewrite attributes", () => rejects(() => sanitizeSvg(svg('<set attributeName="href" to="javascript:alert(1)"/>')), /<set> is not allowed/));
  it("rejects a non-svg root, unknown elements and a foreign namespace", () => {
    rejects(() => sanitizeSvg(Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"></html>')), /not an allowed|root element/);
    rejects(() => sanitizeSvg(svg("<marquee/>")), /not an allowed SVG element/);
    rejects(() => sanitizeSvg(Buffer.from('<svg xmlns="http://www.w3.org/1999/xhtml"></svg>')), /unexpected namespace/);
  });
  it("rejects unquoted attributes and malformed markup rather than guessing", () => {
    rejects(() => sanitizeSvg(Buffer.from("<svg xmlns=http://www.w3.org/2000/svg></svg>")), /malformed/);
    rejects(() => sanitizeSvg(svg("<g>")), /unclosed|mismatched/);
  });
  it("rejects oversize files", () => rejects(() => sanitizeSvg(Buffer.alloc(ICON_LIMITS.svgMaxBytes + 1, 0x20)), /limit/));
});
