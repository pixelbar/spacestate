import { describe, expect, it } from "vitest";
import { isPrivateAddress, STRICT_POLICY, validateWebhookUrl } from "../../src/notifications/webhooks/targetPolicy.js";

describe("validateWebhookUrl", () => {
  it("accepts a public https URL", () => {
    expect(validateWebhookUrl("https://hooks.example.org/spacestate?x=1", STRICT_POLICY)).toBeUndefined();
  });

  it.each([
    ["not a url", "not a valid URL"],
    ["http://example.org/hook", "must be an https:// URL"],
    ["ftp://example.org/hook", "must be an https:// URL"],
    ["https://user:pw@example.org/hook", "must not contain credentials"],
    ["https://localhost/hook", "must not point at an internal host"],
    ["https://db.internal/hook", "must not point at an internal host"],
    ["https://127.0.0.1/hook", "must not point at a private IP address"],
    ["https://10.1.2.3/hook", "must not point at a private IP address"],
    ["https://169.254.169.254/latest/meta-data", "must not point at a private IP address"],
    ["https://[::1]/hook", "must not point at a private IP address"],
    ["https://[::ffff:127.0.0.1]/hook", "must not point at a private IP address"],
    ["https://[fd00::1]/hook", "must not point at a private IP address"],
  ])("rejects %s", (url, reason) => {
    expect(validateWebhookUrl(url, STRICT_POLICY)).toBe(reason);
  });

  it("allows http and private targets only when the policy says so", () => {
    const dev = { allowInsecure: true, allowPrivate: true };
    expect(validateWebhookUrl("http://127.0.0.1:8080/hook", dev)).toBeUndefined();
  });
});

describe("isPrivateAddress", () => {
  it("separates private from public ranges", () => {
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
    expect(isPrivateAddress("100.64.0.1")).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true);
  });
});
