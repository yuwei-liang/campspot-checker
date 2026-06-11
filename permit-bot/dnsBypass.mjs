import { Resolver } from 'node:dns/promises'
import https from 'node:https'
import http from 'node:http'

// User's local router DNS (192.168.68.99) intermittently fails to resolve
// recreation.gov. Bypass it by going straight to Cloudflare / Google public
// resolvers for any Node-side requests this bot makes.
const resolver = new Resolver()
resolver.setServers(['1.1.1.1', '8.8.8.8'])

const cache = new Map() // host -> { ip, expiresAt }
const TTL_MS = 60_000

async function resolveHost(hostname) {
    const cached = cache.get(hostname)
    if (cached && cached.expiresAt > Date.now()) return cached.ip
    const addrs = await resolver.resolve4(hostname)
    if (!addrs.length) throw new Error(`No A records for ${hostname}`)
    const ip = addrs[0]
    cache.set(hostname, { ip, expiresAt: Date.now() + TTL_MS })
    return ip
}

// Node-compatible lookup callback. Mirrors dns.lookup signature: opts may be
// the callback (older form), an object, or absent. opts.all=true demands an
// array of {address, family} records; otherwise return single address+family.
function bypassLookup(hostname, opts, cb) {
    if (typeof opts === 'function') {
        cb = opts
        opts = {}
    }
    const wantAll = !!(opts && opts.all)
    resolveHost(hostname)
        .then(ip => {
            if (wantAll) cb(null, [{ address: ip, family: 4 }])
            else cb(null, ip, 4)
        })
        .catch(err => cb(err))
}

export const httpsAgent = new https.Agent({ lookup: bypassLookup, keepAlive: true })
export const httpAgent = new http.Agent({ lookup: bypassLookup, keepAlive: true })

// Sync-style: resolves the host once at startup, returns an IP string suitable
// for passing to Chromium's --host-resolver-rules. Chromium still does TLS SNI
// against the original hostname so cert validation is unaffected.
export async function resolveForChromium(hostname) {
    return resolveHost(hostname)
}
