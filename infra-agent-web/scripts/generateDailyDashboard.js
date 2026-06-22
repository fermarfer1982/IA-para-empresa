#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const DEFAULT_ENDPOINT = "http://127.0.0.1:3010/api/dashboard/run-daily-report";
const ENV_FILE = path.join(process.cwd(), ".env.local");
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /(OPENAI_API_KEY=)[^\s]+/gi,
  /(OPENAI_WORKFLOW_ID=)[^\s]+/gi,
  /(client_secret["']?\s*[:=]\s*["']?)[^"'\s]+/gi,
  /(Authorization:\s*Bearer\s+)[^\s]+/gi
];

function redact(value) {
  return SECRET_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, "$1[redacted]"),
    String(value || "")
  );
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

function postJson(url, timeoutMs = 900000) {
  const target = new URL(url);
  const client = target.protocol === "https:" ? https : http;
  const body = "{}";

  return new Promise((resolve, reject) => {
    const request = client.request(
      {
        method: "POST",
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: timeoutMs,
        rejectUnauthorized: process.env.DAILY_DASHBOARD_VERIFY_TLS !== "false"
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let payload = {};
          try {
            payload = text ? JSON.parse(text) : {};
          } catch (error) {
            reject(
              new Error(
                `Respuesta JSON inválida desde endpoint diario: HTTP ${response.statusCode}`
              )
            );
            return;
          }

          resolve({
            statusCode: response.statusCode,
            payload
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Timeout generando dashboard diario."));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function printSummary(payload) {
  const reports = payload.reports || [];
  console.log(`Daily dashboard OK: ${payload.updated_at || new Date().toISOString()}`);
  console.log(`Reports generated: ${reports.length}`);
  for (const report of reports) {
    const warning = report.warning ? ` warning=${redact(report.warning)}` : "";
    console.log(
      `- ${report.kind}: report_id=${report.report_id || "n/a"} source=${
        report.source || "unknown"
      }${warning}`
    );
  }
  console.log(`Dashboard status: ${payload.dashboard?.overall_status || "unknown"}`);
}

async function main() {
  loadEnvFile(ENV_FILE);
  const endpoint = process.env.DAILY_DASHBOARD_URL || DEFAULT_ENDPOINT;

  try {
    const result = await postJson(endpoint);
    if (result.statusCode < 200 || result.statusCode >= 300 || result.payload.ok === false) {
      throw new Error(
        `Endpoint diario falló: HTTP ${result.statusCode} ${redact(
          result.payload?.error || "sin detalle"
        )}`
      );
    }

    printSummary(result.payload);
  } catch (error) {
    console.error(redact(error?.message || "No se pudo generar el dashboard diario."));
    process.exitCode = 1;
  }
}

void main();
