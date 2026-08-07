export interface WebhookVerificationInput {
  rawBody: string;
  timestamp: string;
  signature: string;
  secret: string;
  now?: number;
  maximumAgeMilliseconds?: number;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return difference === 0;
}

export async function signWebhookPayload(
  rawBody: string,
  timestamp: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${rawBody}`),
  );
  return bytesToHex(new Uint8Array(signature));
}

export async function verifyWebhookSignature(input: WebhookVerificationInput): Promise<boolean> {
  if (!input.secret || !input.rawBody || !input.timestamp || !input.signature) {
    return false;
  }

  const timestampMilliseconds = Number(input.timestamp) * 1_000;
  if (!Number.isFinite(timestampMilliseconds)) {
    return false;
  }

  const now = input.now ?? Date.now();
  const maximumAge = input.maximumAgeMilliseconds ?? 5 * 60 * 1_000;
  if (Math.abs(now - timestampMilliseconds) > maximumAge) {
    return false;
  }

  const expected = await signWebhookPayload(input.rawBody, input.timestamp, input.secret);
  const received = input.signature.replace(/^sha256=/, "").toLowerCase();
  return constantTimeEqual(expected, received);
}
