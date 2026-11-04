import { createHmac, randomBytes } from "node:crypto";

export interface OAuth1Credentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export interface OAuth1Options {
  /** Form-encoded body parameters, which are signed too. A JSON body is not. */
  params?: Record<string, string>;
  /** Fixed only in tests. */
  nonce?: string;
  timestamp?: number;
}

/** RFC 3986 percent-encoding, which encodeURIComponent falls short of by five characters. */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const byKeyThenValue = ([a, av]: [string, string], [b, bv]: [string, string]) =>
  a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0;

/**
 * The `Authorization` header for an OAuth 1.0a (HMAC-SHA1) user-context
 * request, as X's v2 API takes for posting on an account's behalf
 * (RFC 5849, section 3.4.1).
 */
export function oauth1Header(
  method: string,
  url: string,
  credentials: OAuth1Credentials,
  { params = {}, nonce = randomBytes(16).toString("hex"), timestamp = Math.floor(Date.now() / 1000) }: OAuth1Options = {},
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp),
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };

  const parsed = new URL(url);
  const signed: Array<[string, string]> = [...parsed.searchParams, ...Object.entries(params), ...Object.entries(oauth)]
    .map(([k, v]): [string, string] => [percentEncode(k), percentEncode(v)])
    .sort(byKeyThenValue);
  // URL has already lowercased the scheme and host and dropped a default port; the path keeps its case.
  const baseUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  const base = [method.toUpperCase(), percentEncode(baseUrl), percentEncode(signed.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  const key = `${percentEncode(credentials.consumerSecret)}&${percentEncode(credentials.accessTokenSecret)}`;
  oauth.oauth_signature = createHmac("sha1", key).update(base).digest("base64");

  return `OAuth ${Object.entries(oauth)
    .sort(byKeyThenValue)
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(", ")}`;
}
