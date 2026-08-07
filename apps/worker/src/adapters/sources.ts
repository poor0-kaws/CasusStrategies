import { sha256Hex } from "../crypto";
import type { StoredSourceDocument } from "../contracts";

const WEATHER_HOSTS = new Set(["api.weather.gov", "www.weather.gov", "noaa.gov", "www.noaa.gov"]);
const ECONOMICS_HOSTS = new Set([
  "bls.gov",
  "www.bls.gov",
  "bea.gov",
  "www.bea.gov",
  "federalreserve.gov",
  "www.federalreserve.gov",
  "census.gov",
  "www.census.gov",
  "home.treasury.gov",
  "fiscaldata.treasury.gov",
]);

interface OfficialSourceOptions {
  fetcher?: typeof fetch;
  now?: () => Date;
}

abstract class OfficialSourceAdapter {
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;

  protected constructor(
    private readonly sourceType: "weather" | "economics",
    private readonly allowedHosts: Set<string>,
    options: OfficialSourceOptions,
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async fetchDocument(urlValue: string): Promise<StoredSourceDocument> {
    const url = new URL(urlValue);
    if (url.protocol !== "https:" || !this.allowedHosts.has(url.hostname)) {
      throw new Error(`Source host is not approved: ${url.hostname}`);
    }

    const observedAt = this.now().toISOString();
    const response = await this.fetcher(url, {
      headers: {
        Accept: "application/json, text/plain, text/html",
        "User-Agent": "CasusStrategiesResearch/0.1 contact@example.invalid",
      },
    });
    if (!response.ok) {
      throw new Error(`Official source request failed with status ${response.status}`);
    }
    if (response.url) {
      const finalUrl = new URL(response.url);
      if (finalUrl.protocol !== "https:" || !this.allowedHosts.has(finalUrl.hostname)) {
        throw new Error(`Source redirected to an unapproved host: ${finalUrl.hostname}`);
      }
    }

    const rawText = await response.text();
    const storedAt = this.now().toISOString();
    const rawResponseHash = await sha256Hex(rawText);
    const excerpt = plainTextExcerpt(rawText);
    const sourcePublishedAt = readPublishedTime(response.headers, rawText) ?? observedAt;

    return {
      id: await sha256Hex(`${url.toString()}:${rawResponseHash}`),
      sourceType: this.sourceType,
      title: readTitle(rawText) ?? url.hostname,
      url: url.toString(),
      excerpt,
      rawResponseHash,
      sourcePublishedAt,
      observedAt,
      storedAt,
    };
  }
}

export class WeatherSourceAdapter extends OfficialSourceAdapter {
  constructor(options: OfficialSourceOptions = {}) {
    super("weather", WEATHER_HOSTS, options);
  }
}

export class EconomicsSourceAdapter extends OfficialSourceAdapter {
  constructor(options: OfficialSourceOptions = {}) {
    super("economics", ECONOMICS_HOSTS, options);
  }
}

export class OfficialSourceRouter {
  constructor(
    private readonly weather: WeatherSourceAdapter,
    private readonly economics: EconomicsSourceAdapter,
  ) {}

  async fetchApproved(
    url: string,
    category: "weather" | "economics",
  ): Promise<StoredSourceDocument> {
    if (category === "weather") {
      return this.weather.fetchDocument(url);
    }
    return this.economics.fetchDocument(url);
  }
}

function readPublishedTime(headers: Headers, rawText: string): string | null {
  const lastModified = headers.get("Last-Modified");
  if (lastModified) {
    const date = new Date(lastModified);
    if (!Number.isNaN(date.valueOf())) {
      return date.toISOString();
    }
  }

  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const properties =
      typeof parsed.properties === "object" && parsed.properties !== null
        ? (parsed.properties as Record<string, unknown>)
        : {};
    for (const key of ["published", "published_at", "effective", "updated", "generatedAt"]) {
      const value = parsed[key] ?? properties[key];
      if (typeof value === "string") {
        const date = new Date(value);
        if (!Number.isNaN(date.valueOf())) {
          return date.toISOString();
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function readTitle(rawText: string): string | null {
  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    for (const key of ["title", "headline", "name"]) {
      if (typeof parsed[key] === "string") {
        return parsed[key].slice(0, 300);
      }
    }
  } catch {
    const match = /<title[^>]*>([^<]+)<\/title>/i.exec(rawText);
    return match?.[1]?.trim().slice(0, 300) ?? null;
  }
  return null;
}

function plainTextExcerpt(rawText: string): string {
  return rawText
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4_000);
}
