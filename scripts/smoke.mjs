import http from "node:http";
import https from "node:https";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import process from "node:process";

const baseArgument = process.argv[2];
const production = process.argv.includes("--production");
const resolveIp = process.env.SMOKE_RESOLVE_IP;

if (!baseArgument) {
  console.error("Usage: npm run smoke -- <base-url> [--production]");
  process.exit(2);
}

if (resolveIp && isIP(resolveIp) === 0) {
  console.error("SMOKE_RESOLVE_IP must be an IPv4 or IPv6 address");
  process.exit(2);
}

const baseUrl = new URL(baseArgument);
if (!baseUrl.pathname.endsWith("/")) {
  baseUrl.pathname = `${baseUrl.pathname}/`;
}

let passed = 0;
let failed = 0;

function record(ok, description, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`PASS ${description}`);
    return;
  }

  failed += 1;
  console.error(`FAIL ${description}${detail ? ` — ${detail}` : ""}`);
}

async function fetchManual(pathOrUrl, options = {}) {
  const url = new URL(pathOrUrl, baseUrl);
  if (resolveIp) {
    return fetchAtIp(url, options);
  }

  return fetch(url, { redirect: "manual", ...options });
}

async function fetchAtIp(url, options) {
  const transport = url.protocol === "http:" ? http : https;

  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: options.method ?? "GET",
        lookup(_hostname, lookupOptions, callback) {
          const address = { address: resolveIp, family: isIP(resolveIp) };
          if (lookupOptions?.all) {
            callback(null, [address]);
            return;
          }
          callback(null, address.address, address.family);
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const headers = new Headers();
          for (let index = 0; index < response.rawHeaders.length; index += 2) {
            headers.append(
              response.rawHeaders[index],
              response.rawHeaders[index + 1],
            );
          }

          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode,
              statusText: response.statusMessage,
              headers,
            }),
          );
        });
      },
    );

    request.setTimeout(15_000, () => {
      request.destroy(new Error(`Request timed out: ${url.href}`));
    });
    request.on("error", reject);
    request.end();
  });
}

async function expectHtml(path, status, marker) {
  const response = await fetchManual(path);
  const body = await response.text();
  record(
    response.status === status,
    `${path} returns ${status}`,
    `received ${response.status}`,
  );
  record(
    response.headers.get("content-type")?.includes("text/html") ?? false,
    `${path} is HTML`,
    `received ${response.headers.get("content-type")}`,
  );
  record(body.includes(marker), `${path} contains ${JSON.stringify(marker)}`);

  if (status === 404) {
    const fallback = await readFile(
      new URL("../index.html", import.meta.url),
      "utf8",
    );
    record(body === fallback, `${path} matches index.html`);
  }
}

async function expectRedirect(pathOrUrl, expectedLocation) {
  const response = await fetchManual(pathOrUrl);
  const location = response.headers.get("location");
  record(
    response.status === 301,
    `${pathOrUrl} returns 301`,
    `received ${response.status}`,
  );
  record(
    location === expectedLocation,
    `${pathOrUrl} redirects to ${expectedLocation}`,
    `received ${location}`,
  );
}

async function expectFile(path, filename, contentType) {
  const [response, expected] = await Promise.all([
    fetchManual(path),
    readFile(new URL(`../${filename}`, import.meta.url)),
  ]);
  const body = Buffer.from(await response.arrayBuffer());

  record(
    response.status === 200,
    `${path} returns 200`,
    `received ${response.status}`,
  );
  record(
    response.headers.get("content-type")?.includes(contentType) ?? false,
    `${path} has ${contentType} content`,
    `received ${response.headers.get("content-type")}`,
  );
  record(body.equals(expected), `${path} matches ${filename}`);
}

await expectHtml("/", 200, "<title>tokenary</title>");
await expectFile("/index.html", "index.html", "text/html");
await expectFile("/README.md", "README.md", "text/markdown");
await expectFile("/LICENSE.txt", "LICENSE.txt", "text/plain");
await expectFile("/favicon.png", "favicon.png", "image/png");
await expectFile("/icon.png", "icon.png", "image/png");

for (const path of [
  "/package.json",
  "/package-lock.json",
  "/wrangler.jsonc",
  "/src/worker.js",
  "/scripts/smoke.mjs",
  "/node_modules/wrangler/package.json",
  "/.DS_Store",
  "/.gitignore",
  "/.assetsignore",
]) {
  await expectHtml(path, 404, "<title>tokenary</title>");
}

await expectRedirect(
  "/.git/config",
  new URL("/.git/config/", baseUrl).href,
);
await expectHtml("/.git/config/", 404, "<title>tokenary</title>");

for (const path of [
  "/apple-app-site-association",
  "/.well-known/apple-app-site-association",
]) {
  const response = await fetchManual(path);
  const association = await response.json();
  record(
    response.status === 200,
    `${path} returns 200`,
    `received ${response.status}`,
  );
  record(
    response.headers.get("content-type")?.includes("application/json") ?? false,
    `${path} is JSON`,
    `received ${response.headers.get("content-type")}`,
  );
  record(
    association.applinks?.details?.[0]?.appID ===
      "XWNXDSM6BU.mac.tokenary.io",
    `${path} contains the expected app association`,
  );
}

for (const path of ["/t-app-configuration.json", "/t-app-configuration"]) {
  const response = await fetchManual(path);
  const configuration = await response.json();
  record(
    response.status === 200,
    `${path} returns 200`,
    `received ${response.status}`,
  );
  record(
    response.headers.get("content-type")?.includes("application/json") ?? false,
    `${path} is JSON`,
    `received ${response.headers.get("content-type")}`,
  );
  record(
    configuration.shouldUpdateApp === true,
    `${path} contains shouldUpdateApp=true`,
  );
}

await expectFile("/privacy_policy.pdf", "privacy_policy.pdf", "application/pdf");
await expectFile("/privacy", "privacy_policy.pdf", "application/pdf");

for (const path of ["/blank", "/blank/", "/blank/example", "/blank/example/"]) {
  await expectFile(path, "blank.html", "text/html");
}

for (const path of [
  "/extension",
  "/extension/",
  "/extension/example",
  "/extension/example/",
]) {
  await expectFile(path, "extension.html", "text/html");
}

const externalRedirects = [
  ["/support?probe=1", "https://x.com/lildotorg?probe=1"],
  ["/support/example?probe=1", "https://x.com/lildotorg?probe=1"],
  ["/twitter?probe=1", "https://x.com/lildotorg?probe=1"],
  ["/twitter/example?probe=1", "https://x.com/lildotorg?probe=1"],
  [
    "/macos?probe=1",
    "https://apps.apple.com/app/id6478607925?probe=1",
  ],
  [
    "/macos/example?probe=1",
    "https://apps.apple.com/app/id6478607925?probe=1",
  ],
  ["/get?probe=1", "https://apps.apple.com/app/id6478607925?probe=1"],
  [
    "/get/example?probe=1",
    "https://apps.apple.com/app/id6478607925?probe=1",
  ],
  [
    "/github?probe=1",
    "https://github.com/lil-org/big-wallet?probe=1",
  ],
  [
    "/github/example?probe=1",
    "https://github.com/lil-org/big-wallet?probe=1",
  ],
  [
    "/guide-ios?probe=1",
    "https://support.apple.com/guide/iphone/get-extensions-iphab0432bf6/ios?probe=1",
  ],
  [
    "/guide-ios/example?probe=1",
    "https://support.apple.com/guide/iphone/get-extensions-iphab0432bf6/ios?probe=1",
  ],
  ["/x?probe=1", "https://x.com/lildotorg?probe=1"],
];

for (const [path, destination] of externalRedirects) {
  await expectRedirect(path, destination);
}

for (const path of ["/x/example?probe=1", "/missing?probe=1"]) {
  const expected = new URL(path.replace("?probe=1", "/?probe=1"), baseUrl).href;
  await expectRedirect(path, expected);
}

await expectHtml("/x/example/?probe=1", 404, "<title>tokenary</title>");
await expectHtml("/missing/?probe=1", 404, "<title>tokenary</title>");
await expectHtml("/missing.txt", 404, "<title>tokenary</title>");

const headResponse = await fetchManual("/extension", { method: "HEAD" });
record(
  headResponse.status === 200,
  "HEAD /extension returns 200",
  `received ${headResponse.status}`,
);
record((await headResponse.text()) === "", "HEAD /extension has no body");

if (production) {
  await expectRedirect(
    "http://tokenary.io/path?x=1",
    "https://tokenary.io/path?x=1",
  );
  await expectRedirect(
    "https://www.tokenary.io/path?x=1",
    "https://tokenary.io/path?x=1",
  );
  await expectRedirect(
    "http://www.tokenary.io/path?x=1",
    "https://tokenary.io/path?x=1",
  );

  const productionResponse = await fetchManual("https://tokenary.io/");
  const cloudFrontHeaders = [
    "via",
    "x-amz-cf-id",
    "x-amz-cf-pop",
  ].filter((header) => productionResponse.headers.has(header));
  record(
    cloudFrontHeaders.length === 0,
    "production response has no CloudFront headers",
    `found ${cloudFrontHeaders.join(", ")}`,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
