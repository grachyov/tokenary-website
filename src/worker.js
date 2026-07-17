const EXACT_ASSET_ALIASES = new Map([
  [
    "/.well-known/apple-app-site-association",
    {
      path: "/apple-app-site-association",
      contentType: "application/json",
    },
  ],
  [
    "/t-app-configuration",
    {
      path: "/t-app-configuration.json",
      contentType: "application/json",
    },
  ],
  ["/privacy", { path: "/privacy_policy.pdf" }],
]);

const PREFIX_ASSET_ALIASES = [
  { prefix: "/blank", path: "/blank.html" },
  { prefix: "/extension", path: "/extension.html" },
];

const PREFIX_REDIRECTS = [
  { prefix: "/support", destination: "https://x.com/lildotorg" },
  { prefix: "/twitter", destination: "https://x.com/lildotorg" },
  {
    prefix: "/macos",
    destination: "https://apps.apple.com/app/id6478607925",
  },
  {
    prefix: "/get",
    destination: "https://apps.apple.com/app/id6478607925",
  },
  {
    prefix: "/github",
    destination: "https://github.com/lil-org/big-wallet",
  },
  {
    prefix: "/guide-ios",
    destination:
      "https://support.apple.com/guide/iphone/get-extensions-iphab0432bf6/ios",
  },
];

function matchesPath(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function redirect(destination, requestUrl) {
  const target = new URL(destination);
  target.search = requestUrl.search;

  return new Response(null, {
    status: 301,
    headers: { Location: target.href },
  });
}

function redirectWithTrailingSlash(requestUrl) {
  const target = new URL(requestUrl);
  target.pathname = `${target.pathname}/`;

  return new Response(null, {
    status: 301,
    headers: { Location: target.href },
  });
}

async function serveAsset(request, env, assetPath, options = {}) {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = assetPath;
  assetUrl.search = "";

  const assetRequest = new Request(assetUrl, {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers: request.headers,
  });
  const assetResponse = await env.ASSETS.fetch(assetRequest);

  if (assetResponse.status === 404) {
    throw new Error(`Required static asset is missing: ${assetPath}`);
  }

  const headers = new Headers(assetResponse.headers);
  if (options.contentType) {
    headers.set("Content-Type", options.contentType);
  }

  const status = options.status ?? assetResponse.status;

  return new Response(request.method === "HEAD" ? null : assetResponse.body, {
    status,
    statusText: status === 404 ? "Not Found" : assetResponse.statusText,
    headers,
  });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const exactAsset = EXACT_ASSET_ALIASES.get(url.pathname);

  if (exactAsset) {
    return serveAsset(request, env, exactAsset.path, {
      contentType: exactAsset.contentType,
    });
  }

  for (const alias of PREFIX_ASSET_ALIASES) {
    if (matchesPath(url.pathname, alias.prefix)) {
      return serveAsset(request, env, alias.path);
    }
  }

  if (url.pathname === "/x") {
    return redirect("https://x.com/lildotorg", url);
  }

  for (const route of PREFIX_REDIRECTS) {
    if (matchesPath(url.pathname, route.prefix)) {
      return redirect(route.destination, url);
    }
  }

  const lastSegment = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
  const needsTrailingSlash =
    url.pathname !== "/" &&
    !url.pathname.endsWith("/") &&
    !lastSegment.includes(".");

  if (needsTrailingSlash) {
    return redirectWithTrailingSlash(url);
  }

  return serveAsset(request, env, "/index.html", { status: 404 });
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "request failed",
          path: new URL(request.url).pathname,
          error: error instanceof Error ? error.message : String(error),
        }),
      );

      return new Response("Internal Server Error", {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};
