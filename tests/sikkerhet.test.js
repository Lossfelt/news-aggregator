import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isPrivateAddress, assertPublicHttpUrl, safeFetch } = require('../functions/_lib/net-guard.js');
const { decodeEntities, stripTags } = require('../functions/_lib/text.js');

test('isPrivateAddress: private og lokale adresser', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'ff02::1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test('isPrivateAddress: offentlige adresser', () => {
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('assertPublicHttpUrl: nekter farlige adresser', async () => {
  for (const u of ['ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'http://localhost/', 'http://foo.localhost/',
    'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'http://192.168.0.1/',
    'http://2130706433/', 'http://0x7f.1/', 'http://user:pass@93.184.216.34/', 'http://host.internal/', 'ikke en url']) {
    await assert.rejects(() => assertPublicHttpUrl(u), (e) => e.code === 'BLOCKED_URL', u);
  }
});

test('assertPublicHttpUrl: godtar offentlig IP-adresse', async () => {
  const url = await assertPublicHttpUrl('https://93.184.216.34/feed.xml');
  assert.equal(url.hostname, '93.184.216.34');
});

test('safeFetch: kontrollerer omdirigering til privat adresse', async () => {
  const original = globalThis.fetch;
  const kall = [];
  globalThis.fetch = async (url) => {
    kall.push(url);
    return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
  };
  try {
    await assert.rejects(() => safeFetch('http://93.184.216.34/'), (e) => e.code === 'BLOCKED_URL');
    assert.deepEqual(kall, ['http://93.184.216.34/'], 'bare første hopp skal hentes');
  } finally {
    globalThis.fetch = original;
  }
});

test('safeFetch: følger gyldig omdirigering', async () => {
  const original = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => (n++ === 0
    ? new Response(null, { status: 301, headers: { location: '/ny' } })
    : new Response('ok', { status: 200 }));
  try {
    const r = await safeFetch('http://93.184.216.34/gammel');
    assert.equal(await r.text(), 'ok');
  } finally {
    globalThis.fetch = original;
  }
});

test('safeFetch: gir opp etter for mange omdirigeringer', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: '/igjen' } });
  try {
    await assert.rejects(() => safeFetch('http://93.184.216.34/'), /For mange omdirigeringer/);
  } finally {
    globalThis.fetch = original;
  }
});

test('decodeEntities: dekoder ikke dobbelt', () => {
  assert.equal(decodeEntities('&amp;lt;'), '&lt;');
  assert.equal(decodeEntities('&amp;amp;'), '&amp;');
  assert.equal(decodeEntities('Tom &amp; Jerry &lt;3 &quot;hei&quot; &#39;du&#39;'), `Tom & Jerry <3 "hei" 'du'`);
});

test('stripTags: gjenstår ingen tagger etter nøstede mønstre', () => {
  assert.equal(stripTags('<b>fet</b> tekst'), 'fet tekst');
  assert.ok(!stripTags('<<b>script>alert(1)').includes('<script'));
  assert.ok(!/<[a-z]/i.test(stripTags('<<a>img src=x onerror=alert(1)>')));
});
