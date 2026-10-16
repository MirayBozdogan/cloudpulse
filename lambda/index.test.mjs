import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { validateUrl, checkWebsite, publicLookup, handler } from './index.mjs';

test('rejects private literals, alternate IP spelling, credentials and custom ports', () => {
  for (const value of ['http://127.1', 'http://2130706433', 'http://0x7f000001', 'http://[::1]', 'http://169.254.169.254/', 'http://localhost', 'http://host.internal', 'https://user:pass@example.com', 'https://example.com:444', 'file:///etc/passwd']) {
    assert.throws(() => validateUrl(value), value);
  }
  assert.equal(validateUrl('https://example.com/#fragment').href, 'https://example.com/');
});

test('connection-time DNS guard rejects loopback hostname', async () => {
  await new Promise((resolve) => publicLookup('localhost', {}, (error) => { assert(error); resolve(); }));
});

function fakeRequests(responses, calls) {
  return (url, options, callback) => {
    calls.push({ url: url.href, options });
    const req = new EventEmitter();
    req.end = () => { const next = responses.shift(); callback({statusCode: next.code, headers: {location: next.location}, destroy() {}}); };
    return req;
  };
}

test('follows relative redirects with guarded lookup on every request', async () => {
  const calls = [];
  const request = fakeRequests([{code:302,location:'/health'}, {code:204}], calls);
  assert.equal(await checkWebsite('https://example.com', {requestHttps:request}),204);
  assert.equal(calls[1].url,'https://example.com/health');
  assert(calls.every(({options})=>options.lookup===publicLookup && options.agent===false && options.method==='HEAD'));
});

test('blocks private redirects before connecting and bounds redirect loops', async () => {
  const calls=[];
  await assert.rejects(checkWebsite('https://example.com', {requestHttps:fakeRequests([{code:302,location:'http://127.0.0.1'}],calls)}));
  assert.equal(calls.length,1);
  const loops=[];
  await assert.rejects(checkWebsite('https://example.com', {requestHttps:fakeRequests(Array(4).fill({code:302,location:'/again'}),loops)}),/Too many redirects/);
  assert.equal(loops.length,4);
});

test('invalid URL returns JSON 400 without performing a request', async () => {
  const result=await handler({queryStringParameters:{url:'http://127.0.0.1'}});
  assert.equal(result.statusCode,400);
  assert(JSON.parse(result.body).error);
});
