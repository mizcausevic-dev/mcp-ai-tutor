import { lookup as systemLookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { LookupAddress } from "node:dns";
import type { ClientRequest, IncomingMessage } from "node:http";
import { isIP } from "node:net";

const MAX_CARD_BYTES = 256 * 1024;
const ACCEPT_HEADER = "application/json";

export type AddressLookup = (hostname: string, options: { all: true; family: 4; order: "verbatim" }) => Promise<LookupAddress[]>;
export type HttpsRequest = (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;

export function isPublicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const octets = address.split(".").map(Number);
  const a = octets[0]!;
  const b = octets[1]!;
  const c = octets[2]!;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

export async function resolvePublicIpv4(hostname: string, lookup: AddressLookup = systemLookup): Promise<LookupAddress> {
  const addresses = await lookup(hostname, { all: true, family: 4, order: "verbatim" });
  if (addresses.length === 0 || addresses.some(({ address, family }) => family !== 4 || !isPublicIpv4(address))) {
    throw new Error("Tutor Card DNS answer must contain only public IPv4 addresses");
  }
  return addresses[0]!;
}

export interface PinnedHttpsOptions {
  timeoutMs: number;
  lookup?: AddressLookup;
  request?: HttpsRequest;
}

export async function fetchPinnedHttpsText(url: URL, options: PinnedHttpsOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let rejectDnsTimeout: (error: Error) => void = () => undefined;
    const dnsTimeout = new Promise<never>((_resolve, reject) => { rejectDnsTimeout = reject; });
    const abortDns = () => rejectDnsTimeout(new Error("Tutor Card fetch timed out"));
    controller.signal.addEventListener("abort", abortDns, { once: true });
    let pinned: LookupAddress;
    try {
      pinned = await Promise.race([resolvePublicIpv4(url.hostname, options.lookup), dnsTimeout]);
    } finally {
      controller.signal.removeEventListener("abort", abortDns);
    }
    if (controller.signal.aborted) throw new Error("Tutor Card fetch timed out");

    const request = options.request ?? httpsRequest;
    return await new Promise<string>((resolve, reject) => {
      const req = request(url, {
        method: "GET",
        agent: false,
        servername: url.hostname,
        rejectUnauthorized: true,
        signal: controller.signal,
        headers: { Accept: ACCEPT_HEADER, Host: url.hostname },
        lookup: (_hostname, _lookupOptions, callback) => callback(null, pinned.address, 4),
      }, (response) => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          req.destroy(new Error(`Tutor Card HTTP ${status}`));
          return;
        }
        const contentType = response.headers["content-type"] ?? "";
        if (!/^application\/(?:[\w.-]+\+)?json(?:\s*;|\s*$)/i.test(contentType)) {
          req.destroy(new Error("Tutor Card response must have a JSON Content-Type"));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.byteLength;
          if (bytes > MAX_CARD_BYTES) {
            req.destroy(new Error("Tutor Card response exceeds 256 KiB"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        response.on("error", reject);
        response.on("aborted", () => reject(new Error("Tutor Card response ended early")));
      });
      req.on("socket", (socket) => socket.on("connect", () => {
        if (socket.remoteAddress !== pinned.address) req.destroy(new Error("Tutor Card connection left the pinned address"));
      }));
      req.on("error", reject);
      req.end();
    });
  } finally {
    clearTimeout(timer);
  }
}
