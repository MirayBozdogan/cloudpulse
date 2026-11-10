import { randomUUID } from 'node:crypto';
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

// The SDK is supplied by the Lambda Node.js runtime. Load it only when saving.
let database;
export async function saveCheck(result) {
  const { DynamoDBClient, PutItemCommand } = await import('@aws-sdk/client-dynamodb');
  database ??= new DynamoDBClient({ maxAttempts: 1 });
  const checkId = `${result.checkedAt}#${randomUUID()}`;
  const Item = {
    url: { S: result.url },
    checkId: { S: checkId },
    checkedAt: { S: result.checkedAt },
    status: { S: result.status },
    responseTimeMs: { N: String(result.responseTimeMs) },
    statusCode: result.statusCode === null ? { NULL: true } : { N: String(result.statusCode) },
  };
  if (result.error) Item.error = { S: result.error };
  await database.send(new PutItemCommand({
    TableName: process.env.CHECKS_TABLE || 'cloudpulse-checks',
    Item,
    ConditionExpression: 'attribute_not_exists(checkId)',
  }), { abortSignal: AbortSignal.timeout(1500) });
  return checkId;
}

// Query one site's recent records; never scan the entire table.
export async function readHistory(url) {
  const { DynamoDBClient, QueryCommand } = await import('@aws-sdk/client-dynamodb');
  database ??= new DynamoDBClient({ maxAttempts: 1 });
  const response = await database.send(new QueryCommand({
    TableName: process.env.CHECKS_TABLE || 'cloudpulse-checks',
    KeyConditionExpression: '#url = :url',
    ExpressionAttributeNames: { '#url': 'url', '#status': 'status' },
    ExpressionAttributeValues: { ':url': { S: url } },
    ProjectionExpression: 'checkId, checkedAt, #status, statusCode, responseTimeMs',
    ScanIndexForward: false,
    Limit: 20,
  }), { abortSignal: AbortSignal.timeout(2000) });
  return (response.Items || []).map((item) => ({
    checkId: item.checkId.S,
    checkedAt: item.checkedAt.S,
    status: item.status.S,
    statusCode: item.statusCode?.N === undefined ? null : Number(item.statusCode.N),
    responseTimeMs: Number(item.responseTimeMs.N),
  }));
}

export function createHandler({ check = checkWebsite, save = saveCheck, history = readHistory } = {}) {
  return async (event = {}, context = {}) => {
    let url;
    try {
      url = validateUrl(event.queryStringParameters?.url ?? DEFAULT_URL).href;
    } catch {
      return jsonResponse(400, { error: 'Enter a public HTTP or HTTPS domain without credentials or a custom port.' });
    }
    const action = event.queryStringParameters?.action || 'check';
    if (action === 'history') {
      try {
        return jsonResponse(200, { url, items: await history(url) });
      } catch (error) {
        console.error('Could not read check history:', error.name);
        return jsonResponse(503, { error: 'History is temporarily unavailable. Please retry.' });
      }
    }
    if (action !== 'check') return jsonResponse(400, { error: 'Unknown action' });
    const startedAt = performance.now();
    const checkedAt = new Date().toISOString();
    // Reserve time for the database write and response as well as the HTTP check.
    const budget = Math.max(1, Math.min(5000, (context.getRemainingTimeInMillis?.() ?? 8000) - 2500));
    let result;
    try {
      const statusCode = await check(url, { signal: AbortSignal.timeout(budget) });
      result = {
        url, status: statusCode >= 200 && statusCode < 300 ? 'Operational' : 'HTTP error',
        statusCode, responseTimeMs: Math.round(performance.now() - startedAt), checkedAt,
      };
    } catch {
      result = {
        url, status: 'Unreachable', statusCode: null,
        responseTimeMs: Math.round(performance.now() - startedAt), checkedAt,
        error: 'Request failed, timed out, or reached a blocked destination',
      };
    }
    try {
      const checkId = await save(result);
      return jsonResponse(200, { ...result, checkId, historySaved: true });
    } catch (error) {
      // Storage failures must not be reported as a website outage or successful save.
      console.error('Could not save check history:', error.name);
      return jsonResponse(503, { ...result, historySaved: false, storageError: 'Could not save check history' });
    }
  };
}

export const handler = createHandler();
