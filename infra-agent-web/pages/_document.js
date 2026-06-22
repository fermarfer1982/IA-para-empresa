import { Html, Head, Main, NextScript } from "next/document";

const randomUuidFallbackScript = `
(function () {
  function uuidFromGetRandomValues(cryptoObject) {
    return function randomUUIDFallback() {
      var bytes = new Uint8Array(16);
      cryptoObject.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      var hex = Array.prototype.map.call(bytes, function (byte) {
        return byte.toString(16).padStart(2, "0");
      });
      return [
        hex.slice(0, 4).join(""),
        hex.slice(4, 6).join(""),
        hex.slice(6, 8).join(""),
        hex.slice(8, 10).join(""),
        hex.slice(10, 16).join("")
      ].join("-");
    };
  }

  function uiOnlyFallback() {
    return function nonCryptoRandomUUIDFallback() {
      // UI-only fallback for HTTP LAN demos. Do not use for security, tokens,
      // authentication, authorization, or server-side identifiers.
      var now = Date.now().toString(16);
      var random = Math.random().toString(16).slice(2);
      while (random.length < 24) random += Math.random().toString(16).slice(2);
      return now.slice(-8) + "-" + random.slice(0, 4) + "-4" +
        random.slice(4, 7) + "-" + random.slice(7, 11) + "-" +
        random.slice(11, 23);
    };
  }

  var cryptoObject = window.crypto;
  if (!cryptoObject) {
    cryptoObject = {};
    try {
      Object.defineProperty(window, "crypto", {
        value: cryptoObject,
        configurable: true
      });
    } catch (error) {
      return;
    }
  }

  if (typeof cryptoObject.randomUUID === "function") {
    return;
  }

  var randomUUID = typeof cryptoObject.getRandomValues === "function"
    ? uuidFromGetRandomValues(cryptoObject)
    : uiOnlyFallback();

  try {
    Object.defineProperty(cryptoObject, "randomUUID", {
      value: randomUUID,
      configurable: true
    });
  } catch (error) {
    try {
      cryptoObject.randomUUID = randomUUID;
    } catch (ignored) {}
  }
})();`;

export default function Document() {
  return (
    <Html lang="es">
      <Head>
        <script
          id="randomuuid-http-lan-fallback"
          dangerouslySetInnerHTML={{ __html: randomUuidFallbackScript }}
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
