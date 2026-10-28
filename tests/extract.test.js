import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

const require = createRequire(import.meta.url);
const fixture = readFileSync(new URL('./fixtures/article.html', import.meta.url), 'utf8');
// A numeric public address exercises safeFetch without DNS; fetch is always mocked.
const articleUrl = 'https://93.184.216.34/offline-fixture';

test('offline article extraction through both application entry points', async (t) => {
  const { handler } = require('../functions/extract.js');
  let route;
  const originalCreateServer = http.createServer;
  // Capture the actual dev route without opening a listening socket.
  http.createServer = (listener) => {
    route = listener;
    return { listen() {} };
  };
  try {
    await import('../dev-proxy.js');
  } finally {
    http.createServer = originalCreateServer;
  }
  assert.equal(typeof route, 'function');

  const entryPoints = {
    functions: (body) => handler({ httpMethod: 'POST', body: JSON.stringify(body) }),
    devProxy: async (body) => {
      const req = Readable.from([JSON.stringify(body)]);
      req.method = 'POST';
      req.url = '/extract';
      req.headers = { host: 'localhost' };
      const result = { statusCode: 200 };
      const res = {
        setHeader() {},
        writeHead(status) { result.statusCode = status; },
        end(body) { result.body = body; },
      };
      await route(req, res);
      return result;
    },
  };

  for (const [name, invoke] of Object.entries(entryPoints)) {
    await t.test(`${name}: JSDOM and Readability extract the fixture`, async () => {
      const originalFetch = globalThis.fetch;
      const calls = [];
      globalThis.fetch = async (url, options) => {
        calls.push(url);
        assert.equal(url, articleUrl);
        assert.equal(options.redirect, 'manual');
        return new Response(fixture, { headers: { 'Content-Type': 'text/html' } });
      };
      try {
        const response = await invoke({ url: articleUrl, title: 'Feed title', feedDescription: 'Feed fallback' });
        assert.equal(response.statusCode, 200);
        const result = JSON.parse(response.body);
        assert.equal(result.success, true);
        assert.equal(result.type, 'article');
        assert.equal(result.title, 'Offline extraction fixture');
        assert.match(result.text, /observatory team recorded a clear signal/);
        assert.match(result.text, /Signals & measurements matter\./);
        assert.doesNotMatch(result.text, /Navigation-only|Footer-only|fixtureScriptExecuted|<p>|\s{2}/);
        assert.equal(globalThis.fixtureScriptExecuted, undefined);
        assert.deepEqual(calls, [articleUrl]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    await t.test(`${name}: an empty document uses the feed fallback`, async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        assert.equal(url, articleUrl);
        return new Response('<html><head><title>Empty</title></head><body></body></html>');
      };
      try {
        const response = await invoke({ url: articleUrl, title: 'Feed title', feedDescription: 'Feed fallback' });
        assert.equal(response.statusCode, 200);
        assert.deepEqual(JSON.parse(response.body), {
          success: true, type: 'article', text: 'Feed fallback', title: 'Feed title',
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});
