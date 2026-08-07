import { describe, expect, it } from "vitest";

import { signWebhookPayload, verifyWebhookSignature } from "../src";

describe("webhook signatures", () => {
  it("accepts a current valid HMAC signature", async () => {
    const timestamp = "1786118400";
    const rawBody = '{"event_id":"event-1"}';
    const signature = await signWebhookPayload(rawBody, timestamp, "test-secret");

    await expect(
      verifyWebhookSignature({
        rawBody,
        timestamp,
        signature: `sha256=${signature}`,
        secret: "test-secret",
        now: Number(timestamp) * 1_000,
      }),
    ).resolves.toBe(true);
  });

  it("rejects an old event even when its signature is valid", async () => {
    const timestamp = "1786118400";
    const rawBody = '{"event_id":"event-1"}';
    const signature = await signWebhookPayload(rawBody, timestamp, "test-secret");

    await expect(
      verifyWebhookSignature({
        rawBody,
        timestamp,
        signature,
        secret: "test-secret",
        now: Number(timestamp) * 1_000 + 300_001,
      }),
    ).resolves.toBe(false);
  });
});
