# tokenary website

The static website for [tokenary.io](https://tokenary.io), hosted on Cloudflare
Workers Static Assets.

## Development

Install the pinned Wrangler version and start the local Worker:

```sh
npm ci
npm run dev
```

In another terminal, run the route smoke tests:

```sh
npm run smoke -- http://127.0.0.1:8787
```

`npm run check` validates the Worker bundle and static-asset manifest without
deploying. `npm run types` regenerates the Cloudflare binding declarations after
configuration changes, and `npm run startup` profiles Worker startup.

## Deployment

Wrangler reads authentication from `CLOUDFLARE_API_TOKEN`. Never print, commit,
or add the token to a Wrangler configuration file.

```sh
npm run check
npm run preview
npm run smoke -- https://migration-tokenary-dot-io.lil-org.workers.dev
npm run deploy
npm run smoke -- https://tokenary.io --production
```

During DNS propagation, `SMOKE_RESOLVE_IP` can target a known Cloudflare edge
address without changing the request host or TLS server name:

```sh
SMOKE_RESOLVE_IP="$(dig +short @1.1.1.1 tokenary.io A | head -n1)" \
  npm run smoke -- https://tokenary.io --production
```

The `migration` preview alias uploads a version without moving production
traffic. Production deploys attach the `tokenary.io` custom domain. Cloudflare
Workers Builds also deploys `main` with `npx wrangler deploy`; non-production
branch builds are intentionally disabled.

## Routing

Static files are served directly by Workers Static Assets. `src/worker.js`
preserves the former Amplify aliases and redirects:

- The Apple association path, `/t-app-configuration`, `/privacy`, `/blank/*`,
  and `/extension/*` serve their corresponding repository assets.
- `/support/*`, `/twitter/*`, `/macos/*`, `/get/*`, `/github/*`, and
  `/guide-ios/*` preserve the existing external redirects and query strings.
  `/x` remains an exact-only redirect.
- Unknown extensionless paths gain a trailing slash; remaining unknown paths
  return the homepage body with status `404`.

A zone-level Cloudflare redirect rule sends HTTP and `www` requests directly to
the canonical HTTPS apex. A configuration rule disables automatic Real User
Monitoring script injection for these hostnames so Cloudflare serves the tracked
HTML bytes unchanged.

## Rollback

Before removing the previous origin, remove the canonical redirect rule, detach
the Worker custom domain, and restore the captured apex and `www` CloudFront
records in Cloudflare. If DNS delegation itself must be rolled back, restore the
captured Porkbun nameservers first and restore the previous DS record only after
Porkbun is authoritative again.

After Amplify has been deleted, use Cloudflare deployment history:

```sh
npx wrangler versions list
npx wrangler rollback
```
