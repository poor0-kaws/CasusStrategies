import { describe, expect, it } from "vitest";

import { verifyWebhookSignature } from "../src/crypto";

describe("verifyWebhookSignature", () => {
  it("accepts a fresh HMAC and rejects an old timestamp", async () => {
    const body = '{"id":"event-1"}';
    const timestamp = "1786118400";
    const secret = "test-secret";
    const signature = await sign(`${timestamp}.${body}`, secret);

    await expect(
      verifyWebhookSignature({
        body,
        signatureHeader: `t=${timestamp},v1=${signature}`,
        timestampHeader: null,
        secret,
        nowMs: 1_786_118_400_000,
      }),
    ).resolves.toBe(true);

    await expect(
      verifyWebhookSignature({
        body,
        signatureHeader: signature,
        timestampHeader: timestamp,
        secret,
        nowMs: 1_786_118_701_000,
      }),
    ).resolves.toBe(false);
  });

  it("fails closed when a signature input is missing", async () => {
    await expect(
      verifyWebhookSignature({
        body: "{}",
        signatureHeader: null,
        timestampHeader: null,
        secret: undefined,
      }),
    ).resolves.toBe(false);
  });
});

async function sign(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
