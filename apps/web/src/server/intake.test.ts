import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { IntakeError, MAX_LONG_EDGE, MAX_UPLOAD_BYTES, processUpload, sniffMime } from "./intake.ts";
import { corpusImage } from "./test-support.ts";

const rejects = async (bytes: Uint8Array, code: IntakeError["code"]) =>
  assert.rejects(processUpload(bytes), (e: unknown) => e instanceof IntakeError && e.code === code);

describe("chart intake", () => {
  it("sniffs the real format from magic bytes, never the declared type", async () => {
    assert.equal(sniffMime(corpusImage("tsla-5m-bull")), "image/png");
    assert.equal(sniffMime(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).jpeg().toBuffer()), "image/jpeg");
    assert.equal(sniffMime(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).webp().toBuffer()), "image/webp");
    assert.equal(sniffMime(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
    assert.equal(sniffMime(Buffer.from("GIF89a......")), null);
  });

  it("rejects empty, oversized, unsupported and corrupt uploads", async () => {
    await rejects(new Uint8Array(0), "EMPTY");
    await rejects(new Uint8Array(MAX_UPLOAD_BYTES + 1), "TOO_LARGE");
    await rejects(Buffer.from("%PDF-1.7 not an image"), "UNSUPPORTED_TYPE");
    const png = corpusImage("tsla-5m-bull");
    await rejects(png.subarray(0, 64), "CORRUPT");
  });

  it("strips EXIF/GPS metadata and applies orientation", async () => {
    const jpeg = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#123" } })
      .jpeg()
      .withExif({ IFD0: { Copyright: "klynge-secret-location", ImageDescription: "Account 4471" } })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    assert.ok((await sharp(jpeg).metadata()).exif, "fixture carries EXIF");
    const out = await processUpload(jpeg);
    const meta = await sharp(out.bytes).metadata();
    assert.equal(meta.exif, undefined);
    assert.equal(meta.orientation, undefined);
    assert.ok(!out.bytes.includes(Buffer.from("klynge-secret-location")));
    assert.ok(!out.bytes.includes(Buffer.from("Account 4471")));
    assert.deepEqual([out.width, out.height], [400, 800], "orientation 6 rotated");
  });

  it("downscales to the 2576px long edge, never upscales", async () => {
    const big = await sharp({ create: { width: 4000, height: 1000, channels: 3, background: "#222" } }).png().toBuffer();
    const out = await processUpload(big);
    assert.equal(out.width, MAX_LONG_EDGE);
    assert.equal(out.height, 644);
    const small = await processUpload(corpusImage("tsla-5m-bull"));
    assert.deepEqual([small.width, small.height], [1280, 720]);
  });

  it("is deterministic: same upload => same processed hash (chart id)", async () => {
    const a = await processUpload(corpusImage("spx-5m-bull"));
    const b = await processUpload(corpusImage("spx-5m-bull"));
    assert.equal(a.sha256, b.sha256);
    assert.match(a.sha256, /^[0-9a-f]{64}$/);
    assert.notEqual(a.sha256, (await processUpload(corpusImage("mnq-5m-bull"))).sha256);
  });
});
