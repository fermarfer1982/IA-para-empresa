function buildUuidFromGetRandomValues(cryptoObject) {
  return function randomUUIDFallback() {
    const bytes = new Uint8Array(16);
    cryptoObject.getRandomValues(bytes);

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10, 16).join("")
    ].join("-");
  };
}

function buildNonCryptoUuid() {
  return function nonCryptoRandomUUIDFallback() {
    // UI-only fallback for HTTP LAN demos. Do not use for security, tokens,
    // authentication, authorization, or server-side identifiers.
    const now = Date.now().toString(16);
    const random = Math.random().toString(16).slice(2).padEnd(24, "0");
    return `${now.slice(-8)}-${random.slice(0, 4)}-4${random.slice(4, 7)}-${random.slice(7, 11)}-${random.slice(11, 23)}`;
  };
}

function installRandomUUIDFallback() {
  if (typeof globalThis === "undefined") {
    return;
  }

  let cryptoObject = globalThis.crypto;

  if (!cryptoObject) {
    cryptoObject = {};
    try {
      Object.defineProperty(globalThis, "crypto", {
        value: cryptoObject,
        configurable: true
      });
    } catch {
      return;
    }
  }

  if (typeof cryptoObject.randomUUID === "function") {
    return;
  }

  const randomUUID =
    typeof cryptoObject.getRandomValues === "function"
      ? buildUuidFromGetRandomValues(cryptoObject)
      : buildNonCryptoUuid();

  try {
    Object.defineProperty(cryptoObject, "randomUUID", {
      value: randomUUID,
      configurable: true
    });
  } catch {
    try {
      cryptoObject.randomUUID = randomUUID;
    } catch {
      // If the browser prevents patching crypto, ChatKit may still require
      // HTTPS/localhost. The UI will surface that runtime error.
    }
  }
}

installRandomUUIDFallback();
