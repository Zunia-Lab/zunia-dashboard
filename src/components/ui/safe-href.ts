/**
 * Which hrefs the kit will turn into links. Pure, so node:test covers it and
 * server code can call it.
 *
 * Hrefs often come from chain data: a validator's `website`, a proposal's
 * links, a token list's URLs. Anyone can set those to `javascript:…`,
 * `data:…`, a protocol-relative "//evil.example" or a bare "example.com" that
 * would resolve against the dashboard's own origin. Rather than trust every
 * caller to check, ExternalLink and AddressText only link what passes here and
 * render anything else as plain text.
 */

/**
 * An absolute http(s) URL or a mailto: address, nothing else.
 *
 * A URL with credentials in it is refused too: "https://cosmos.network@evil.example/"
 * opens evil.example while the text a page shows for it (a validator's
 * permissionless `website`, its scheme stripped) reads as cosmos.network.
 * The markdown guard refuses the same phishing pattern. The check is on the
 * raw authority as well as the parsed URL, so even an empty user part
 * ("https://@host") is out: no real site needs one.
 */
export function isSafeExternalHref(href: string | null | undefined): href is string {
  if (typeof href !== "string") return false;
  const value = href.trim();
  if (value.length === 0 || value.length > 2048 || /\s/.test(value)) return false;
  if (/^mailto:[^@]+@[^@]+$/i.test(value)) return true;
  if (!/^https?:\/\//i.test(value)) return false;
  // Everything between "//" and the first "/", "?", "#" or "\\" (WHATWG reads a
  // backslash as a path separator in http(s) URLs).
  const authority = value.replace(/^https?:\/\//i, "").split(/[/?#\\]/, 1)[0] ?? "";
  if (authority.includes("@")) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** A path inside the dashboard ("/validators/…"), not "//host" or a scheme. */
export function isAppPath(href: string | null | undefined): href is string {
  return typeof href === "string" && /^\/(?![/\\])/.test(href) && !/\s/.test(href);
}
