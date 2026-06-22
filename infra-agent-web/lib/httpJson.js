import http from "http";
import https from "https";

export function requestJson(url, options = {}) {
  const parsedUrl = new URL(url);
  const transport = parsedUrl.protocol === "https:" ? https : http;
  const method = options.method || "GET";
  const payload = options.body == null ? null : JSON.stringify(options.body);

  return new Promise((resolve, reject) => {
    const request = transport.request(
      parsedUrl,
      {
        method,
        headers: {
          ...(options.headers || {}),
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload)
              }
            : {})
        },
        timeout: options.timeoutMs || 45000
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          let body = null;
          try {
            body = raw ? JSON.parse(raw) : null;
          } catch {
            body = { error: "Respuesta no JSON.", raw: raw.slice(0, 500) };
          }

          resolve({
            statusCode: response.statusCode || 500,
            headers: response.headers,
            body
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error(`Timeout llamando a ${parsedUrl.hostname}.`));
    });
    request.on("error", reject);

    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}
