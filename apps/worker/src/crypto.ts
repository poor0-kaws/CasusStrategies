const encoder = new TextEncoder();

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function verifyWebhookSignature(input: {
  body: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  secret: string | undefined;
  nowMs?: number;
}): Promise<boolean> {
  if (!input.secret || !input.signatureHeader) {
    return false;
  }

  const combinedHeader = parseCombinedHeader(input.signatureHeader);
  const timestampHeader = combinedHeader?.timestamp ?? input.timestampHeader;
  const signatureValue = combinedHeader?.signature ?? input.signatureHeader;
  if (!timestampHeader) {
    return false;
  }

  const timestampMs = parseTimestamp(timestampHeader);
  if (timestampMs === null) {
    return false;
  }

  const nowMs = input.nowMs ?? Date.now();
  if (Math.abs(nowMs - timestampMs) > 5 * 60 * 1000) {
    return false;
  }

  const signature = parseSignature(signatureValue);
  if (!signature) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  return crypto.subtle.verify(
    "HMAC",
    key,
    Uint8Array.from(signature).buffer,
    encoder.encode(`${timestampHeader}.${input.body}`),
  );
}

function parseCombinedHeader(value: string): { timestamp: string; signature: string } | null {
  const fields = new Map(
    value.split(",").map((field) => {
      const [key, ...parts] = field.trim().split("=");
      return [key, parts.join("=")];
    }),
  );
  const timestamp = fields.get("t");
  const signature = fields.get("v1");
  return timestamp && signature ? { timestamp, signature } : null;
}

function parseTimestamp(value: string): number | null {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return numericValue > 10_000_000_000 ? numericValue : numericValue * 1000;
}

function parseSignature(value: string): Uint8Array | null {
  const hex = value.startsWith("sha256=") ? value.slice(7) : value;
  if (!/^[a-f\d]{64}$/i.test(hex)) {
    return null;
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
