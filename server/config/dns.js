// Some Windows setups (and some VPNs/ISPs) hand out an IPv6-only DNS server
// that Node's built-in resolver (c-ares) can't query even though the OS's own
// resolver (nslookup, browsers, etc.) handles it fine. That makes the
// `mongodb+srv://` SRV lookup Mongoose needs fail with something like
// "querySrv ECONNREFUSED ..." even though your network is otherwise fine.
//
// Fix: point Node's resolver at a couple of well-known public DNS servers
// first, keeping whatever the OS already had configured as a fallback.
// Override with DNS_SERVERS="1.2.3.4,5.6.7.8" in .env if you'd rather use
// something else (e.g. your own network's resolver).
const dns = require('dns');

function applyDnsServers() {
  const override = (process.env.DNS_SERVERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const preferred = override.length ? override : ['8.8.8.8', '8.8.4.4', '1.1.1.1'];
  const existing = dns.getServers();
  const merged = [...new Set([...preferred, ...existing])];

  dns.setServers(merged);
}

module.exports = { applyDnsServers };
