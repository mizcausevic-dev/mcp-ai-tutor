import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { LookupAddress } from "node:dns";
import type { RequestOptions } from "node:https";
import { describe, expect, it, vi } from "vitest";

import { fetchPinnedHttpsText, isPublicIpv4, resolvePublicIpv4, type HttpsRequest } from "../src/network.js";

const url = new URL("https://tutors.example.org/.well-known/tutors/math.json");
const publicLookup = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]);

function fakeRequest(status: number, contentType: string, body: string): { request: HttpsRequest; options: () => RequestOptions } {
  let captured: RequestOptions | undefined;
  const request: HttpsRequest = (_url, options, onResponse) => {
    captured = options;
    const req = new EventEmitter() as ClientRequest;
    req.destroy = ((error?: Error) => {
      req.emit("error", error ?? new Error("destroyed"));
      return req;
    }) as ClientRequest["destroy"];
    req.end = (() => {
      queueMicrotask(() => {
        const response = new PassThrough() as unknown as IncomingMessage;
        response.statusCode = status;
        response.headers = { "content-type": contentType };
        onResponse(response);
        response.end(Buffer.from(body));
      });
      return req;
    }) as ClientRequest["end"];
    return req;
  };
  return { request, options: () => captured! };
}

describe("pinned HTTPS egress", () => {
  it("rejects private, link-local, shared, documentation, multicast, and non-IPv4 addresses", () => {
    for (const address of ["0.1.2.3", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "192.168.1.1", "192.0.0.9", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(isPublicIpv4(address), address).toBe(false);
    }
    expect(isPublicIpv4("8.8.8.8")).toBe(true);
  });

  it("rejects empty or mixed DNS answers and selects a public IPv4 address", async () => {
    const lookup = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    await expect(resolvePublicIpv4(url.hostname, lookup)).rejects.toThrow("public IPv4");
    expect(lookup).toHaveBeenCalledWith(url.hostname, { all: true, family: 4, order: "verbatim" });
    await expect(resolvePublicIpv4(url.hostname, async () => [])).rejects.toThrow("public IPv4");
    await expect(resolvePublicIpv4(url.hostname, async () => [{ address: "8.8.8.8", family: 4 }])).resolves.toEqual({ address: "8.8.8.8", family: 4 });
  });

  it("keeps TLS and Host on the hostname while pinning the socket to the vetted IP", async () => {
    const transport = fakeRequest(200, "application/json; charset=utf-8", "{\"ok\":true}");
    await expect(fetchPinnedHttpsText(url, { timeoutMs: 1000, lookup: publicLookup, request: transport.request })).resolves.toBe("{\"ok\":true}");
    const options = transport.options();
    expect(options.agent).toBe(false);
    expect(options.servername).toBe(url.hostname);
    expect(options.rejectUnauthorized).toBe(true);
    expect(options.headers).toMatchObject({ Host: url.hostname, Accept: "application/json" });
    const callback = vi.fn();
    options.lookup?.(url.hostname, { family: 4 }, callback);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  });

  it("never opens a request after a private DNS answer", async () => {
    const request = vi.fn(fakeRequest(200, "application/json", "{}").request);
    await expect(fetchPinnedHttpsText(url, { timeoutMs: 1000, lookup: async () => [{ address: "127.0.0.1", family: 4 }], request })).rejects.toThrow("public IPv4");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects redirects, non-JSON responses, and oversized bodies", async () => {
    for (const [status, type, body, message] of [
      [302, "text/html", "", "HTTP 302"],
      [200, "text/html", "{}", "JSON Content-Type"],
      [200, "application/json", "x".repeat(256 * 1024 + 1), "256 KiB"],
    ] as const) {
      const transport = fakeRequest(status, type, body);
      await expect(fetchPinnedHttpsText(url, { timeoutMs: 1000, lookup: publicLookup, request: transport.request })).rejects.toThrow(message);
    }
  });

  it("times out DNS before any connection is opened", async () => {
    const request = vi.fn(fakeRequest(200, "application/json", "{}").request);
    const never = (): Promise<LookupAddress[]> => new Promise(() => undefined);
    await expect(fetchPinnedHttpsText(url, { timeoutMs: 5, lookup: never, request })).rejects.toThrow("timed out");
    expect(request).not.toHaveBeenCalled();
  });
});
