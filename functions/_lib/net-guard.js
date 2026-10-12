'use strict';
// Beskyttelse mot SSRF: nekter henting av adresser som peker på lokale eller
// private nett (localhost, 10.x, 169.254.x osv.), og følger omdirigeringer
// manuelt slik at hvert hopp kontrolleres.
//
// Begrensning: vertsnavnet slås opp her før fetch() slår det opp på nytt, så en
// angriper som styrer DNS kan i teorien bytte svar mellom de to oppslagene
// (DNS rebinding). Det er en kjent rest-risiko ved denne typen sjekk.

const dns = require('node:dns').promises;
const net = require('node:net');

class BlockedUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlockedUrlError';
    this.code = 'BLOCKED_URL';
  }
}

function isPrivateIPv4(ip) {
  const [a, b, c] = ip.split('.').map(Number);
  return (
    a === 0 || // "dette nettverket"
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, inkl. sky-metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmark
    a >= 224 // multicast og reservert
  );
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;

  const mappedDotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return isPrivateIPv4(mappedDotted[1]);
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }

  const first = parseInt(lower.split(':')[0] || '0', 16);
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xff00) === 0xff00 || // multicast
    lower.startsWith('64:ff9b:') // NAT64
  );
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // ukjent format: avvis
}

async function assertPublicHttpUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new BlockedUrlError('Ugyldig URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError('Kun http og https er tillatt');
  }
  if (url.username || url.password) {
    throw new BlockedUrlError('URL med brukernavn eller passord er ikke tillatt');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new BlockedUrlError('Adressen peker på et lokalt nettverk');
  }

  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new BlockedUrlError('Adressen peker på et privat nettverk');
    return url;
  }

  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch (e) {
    // Samme meldingsform som fetch() gir, slik at eksisterende retry-logikk fungerer.
    const err = new Error(`fetch failed: DNS-oppslag feilet (${e.code || e.message})`);
    err.cause = e;
    throw err;
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new BlockedUrlError('Adressen peker på et privat nettverk');
  }
  return url;
}

// Som fetch(), men nekter private adresser og kontrollerer hvert omdirigeringshopp.
async function safeFetch(input, options = {}, maxRedirects = 5) {
  let current = input;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicHttpUrl(current);
    const response = await fetch(url.href, { ...options, redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, url).href;
      try {
        await response.body?.cancel();
      } catch {
        // ignorer
      }
      continue;
    }
    return response;
  }
  throw new Error('For mange omdirigeringer');
}

module.exports = { BlockedUrlError, isPrivateAddress, assertPublicHttpUrl, safeFetch };
