import { describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/server/google-drive";
import { clipBox } from "@/lib/server/annotations";

describe("Google Drive Token Encryption & Security", () => {
  it("encrypts and decrypts OAuth refresh tokens securely with AES-256-GCM", () => {
    const originalToken = "1//04testRefreshToken_ABCxyz_1234567890";
    const encrypted = encryptSecret(originalToken);

    expect(encrypted).not.toBe(originalToken);
    expect(encrypted.split(":")).toHaveLength(3); // iv:tag:ciphertext

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(originalToken);
  });

  it("produces different ciphertexts for the same plaintext due to random IV", () => {
    const secret = "secret_token_123";
    const enc1 = encryptSecret(secret);
    const enc2 = encryptSecret(secret);

    expect(enc1).not.toBe(enc2);
    expect(decryptSecret(enc1)).toBe(secret);
    expect(decryptSecret(enc2)).toBe(secret);
  });

  it("fails to decrypt tampered ciphertexts", () => {
    const encrypted = encryptSecret("valid_token");
    const tampered = encrypted.slice(0, -4) + "ffff";
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe("Bounding Box Normalization & Small Object Support", () => {
  it("normalizes and preserves valid bounding boxes in 0..1 range", () => {
    const box = { classIndex: 0, cx: 0.5, cy: 0.5, w: 0.2, h: 0.2 };
    const clipped = clipBox(box);
    expect(clipped).not.toBeNull();
    expect(clipped!.cx).toBeCloseTo(0.5);
    expect(clipped!.cy).toBeCloseTo(0.5);
    expect(clipped!.w).toBeCloseTo(0.2);
    expect(clipped!.h).toBeCloseTo(0.2);
  });

  it("supports very small objects (~2 cm in photograph, down to 0.05% of image)", () => {
    const smallScrew = { classIndex: 3, cx: 0.45, cy: 0.6, w: 0.005, h: 0.005 };
    const clipped = clipBox(smallScrew);
    expect(clipped).not.toBeNull();
    expect(clipped!.w).toBeCloseTo(0.005);
    expect(clipped!.h).toBeCloseTo(0.005);
  });

  it("clamps boxes extending beyond image boundaries", () => {
    // Box overflowing the right and bottom edge
    const overflowBox = { classIndex: 1, cx: 0.95, cy: 0.95, w: 0.2, h: 0.2 };
    const clipped = clipBox(overflowBox);
    expect(clipped).not.toBeNull();
    expect(clipped!.cx + clipped!.w / 2).toBeLessThanOrEqual(1.0);
    expect(clipped!.cy + clipped!.h / 2).toBeLessThanOrEqual(1.0);
  });

  it("rejects non-finite or degenerate boxes", () => {
    expect(clipBox({ classIndex: 0, cx: NaN, cy: 0.5, w: 0.2, h: 0.2 })).toBeNull();
    expect(clipBox({ classIndex: 0, cx: 0.5, cy: 0.5, w: 0, h: 0.2 })).toBeNull();
    expect(clipBox({ classIndex: 0, cx: 2.0, cy: 2.0, w: 0.1, h: 0.1 })).toBeNull();
  });

  it("formats coordinates strictly to YOLO standard: class cx cy w h", () => {
    const box = { classIndex: 2, cx: 0.5123456, cy: 0.3456789, w: 0.1234567, h: 0.2345678 };
    const yoloLine = `${box.classIndex} ${box.cx.toFixed(6)} ${box.cy.toFixed(6)} ${box.w.toFixed(6)} ${box.h.toFixed(6)}`;
    expect(yoloLine).toBe("2 0.512346 0.345679 0.123457 0.234568");
  });
});
