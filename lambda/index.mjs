import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';

const DEFAULT_URL = 'https://d61mkgexvp9pd.cloudfront.net/';
const blocked = new BlockList();
// Only public IPv4 destinations are supported in this first version.
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10],
  ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(address, prefix, 'ipv4');

export function validateUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid URL');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
      isIP(url.hostname.replace(/^\[|\]$/g, '')) || !url.hostname.includes('.') ||
      /(^|\.)(localhost|local|internal)\.?$/i.test(url.hostname)) {
    throw new Error('Use a public HTTP or HTTPS domain with its default port');
  }
  url.hash = '';
  return url;
}

// Validate the DNS answer at connection time, so a second lookup cannot bypass it.
export function publicLookup(hostname, options, callback) {
  lookup(hostname, { family: 4, all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(({ address }) => blocked.check(address, 'ipv4'))) {
      return callback(new Error('Destination is not public'));
    }
    const first = addresses[0];
    callback(null, options.all ? [first] : first.address, first.family);
  });
}

export async function checkWebsite(address, { requestHttp = http.request, requestHttps = https.request, signal } = {}) {
  let url = validateUrl(address);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const result = await new Promise((resolve, reject) => {
      const request = (url.protocol === 'https:' ? requestHttps : requestHttp)(url, {
        method: 'HEAD', lookup: publicLookup, family: 4, agent: false, signal,
        maxHeaderSize: 16384,
      }, (response) => {
        const result = { code: response.statusCode, location: response.headers.location };
        response.destroy();
        resolve(result);
      });
      request.on('error', reject);
      request.end();
    });
    if (![301, 302, 303, 307, 308].includes(result.code) || !result.location) return result.code;
    if (redirects === 3) throw new Error('Too many redirects');
    // Every redirect gets the same URL and connection-time DNS validation.
    url = validateUrl(new URL(result.location, url).href);
  }
}

const jsonResponse = (statusCode, result) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(result),
});

export const handler = async (event = {}, context = {}) => {
  let url;
  try {
    url = validateUrl(event.queryStringParameters?.url ?? DEFAULT_URL).href;
  } catch {
    return jsonResponse(400, { error: 'Enter a public HTTP or HTTPS domain without credentials or a custom port.' });
  }
  const startedAt = performance.now();
  const checkedAt = new Date().toISOString();
  // Leave time for Lambda to return a response before its execution limit.
  const budget = Math.max(1, Math.min(5000, (context.getRemainingTimeInMillis?.() ?? 6000) - 500));
  try {
    const statusCode = await checkWebsite(url, { signal: AbortSignal.timeout(budget) });
    return jsonResponse(200, {
      url, status: statusCode >= 200 && statusCode < 300 ? 'Operational' : 'HTTP error',
      statusCode, responseTimeMs: Math.round(performance.now() - startedAt), checkedAt,
    });
  } catch {
    return jsonResponse(200, {
      url, status: 'Unreachable', statusCode: null,
      responseTimeMs: Math.round(performance.now() - startedAt), checkedAt,
      error: 'Request failed, timed out, or reached a blocked destination',
    });
  }
};
