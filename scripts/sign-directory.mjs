#!/usr/bin/env node
// Signs the Web Bot Auth key directory response (RFC 9421 HTTP Message
// Signatures, as Cloudflare verifies it for
// draft-meunier-http-message-signatures-directory-03).
//
// Usage: WEB_BOT_AUTH_PRIVATE_KEY="$(cat key.pem)" \
//          node scripts/sign-directory.mjs [authority] [ttl-days] [directory-file]
//
// Prints JSON {"signature_input": "...", "signature": "...", "keyid": "..."}
// whose values go into the Signature-Input and Signature response headers.
// GitHub Pages cannot set headers, so the deploy job puts them on the
// response with a Cloudflare response header transform rule.
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

const authority = process.argv[2] || "bcv.today";
const ttlDays = Number(process.argv[3] || 7);
const directoryFile = process.argv[4] || ".well-known/http-message-signatures-directory";

const pem = process.env.WEB_BOT_AUTH_PRIVATE_KEY;
if (!pem) {
  console.error("WEB_BOT_AUTH_PRIVATE_KEY is not set");
  process.exit(2);
}

const privateKey = createPrivateKey(pem);
if (privateKey.asymmetricKeyType !== "ed25519") {
  console.error(`Expected an Ed25519 key, got ${privateKey.asymmetricKeyType}`);
  process.exit(2);
}

// RFC 7638 / RFC 8037 thumbprint: SHA-256 over the required members in
// lexicographic order, base64url without padding.
const jwk = createPublicKey(privateKey).export({ format: "jwk" });
const keyid = createHash("sha256")
  .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x }))
  .digest("base64url");

// Refuse to sign for a key that the published directory does not list.
const directory = JSON.parse(readFileSync(directoryFile, "utf8"));
if (!directory.keys?.some((k) => k.kty === "OKP" && k.crv === "Ed25519" && k.x === jwk.x)) {
  console.error(`The key in WEB_BOT_AUTH_PRIVATE_KEY (keyid ${keyid}) is not in ${directoryFile}`);
  process.exit(1);
}

const created = Math.floor(Date.now() / 1000);
const expires = created + Math.round(ttlDays * 86400);
const params =
  `("@authority";req);created=${created};expires=${expires}` +
  `;keyid="${keyid}";alg="ed25519";tag="http-message-signatures-directory"`;
const base = `"@authority";req: ${authority}\n"@signature-params": ${params}`;
const signature = sign(null, Buffer.from(base, "ascii"), privateKey).toString("base64");

console.log(JSON.stringify({
  signature_input: `sig1=${params}`,
  signature: `sig1=:${signature}:`,
  keyid,
}));
