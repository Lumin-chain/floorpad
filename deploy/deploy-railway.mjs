#!/usr/bin/env node
/**
 * Automated Railway Deployment Script for Floorpad
 *
 * Supports 3 deployment modes:
 *
 * Mode 1: Railway CLI Direct Push (bypasses GitHub entirely)
 *   Runs `railway up` to upload and deploy the web or social service directly.
 *   Usage: node deploy/deploy-railway.mjs --service web
 *          node deploy/deploy-railway.mjs --service social
 *          node deploy/deploy-railway.mjs --all
 *
 * Mode 2: Railway Deploy Webhook (instant trigger of GitHub latest commit)
 *   POSTs to Railway's service deploy webhook.
 *   Usage: node deploy/deploy-railway.mjs --webhook https://backboard.railway.app/v1/deploy/<token>
 *          (or set RAILWAY_WEBHOOK_URL in environment)
 *
 * Mode 3: Railway GraphQL API (requires RAILWAY_TOKEN)
 *   Dispatches a redeployment mutation to Railway's v2 GraphQL API.
 */

import { spawnSync } from "child_process";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const serviceArg = args.find((_, i) => args[i - 1] === "--service" || args[i - 1] === "-s") || "web";
const isAll = args.includes("--all");
const webhookUrl = args.find((_, i) => args[i - 1] === "--webhook") || process.env.RAILWAY_WEBHOOK_URL;
const token = process.env.RAILWAY_TOKEN;

async function postWebhook(url) {
  console.log(`[Railway] Triggering deploy webhook: ${url.replace(/\/deploy\/([a-zA-Z0-9_-]{6}).+/, "/deploy/$1...")}`);
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "floorpad-deployer/1.0",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[Railway] Success! Deployment triggered (Status: ${res.statusCode}).`);
            resolve(body);
          } else {
            console.error(`[Railway] Failed with status ${res.statusCode}: ${body}`);
            reject(new Error(`Deploy webhook failed: ${res.statusCode}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function deployCli(service) {
  const dir = service === "web" ? path.join(ROOT, "web") : path.join(ROOT, "server");
  if (!fs.existsSync(dir)) {
    console.error(`[Railway] Target directory does not exist: ${dir}`);
    return false;
  }

  console.log(`\n==================================================`);
  console.log(`[Railway] Deploying service '${service}' directly from ${dir}`);
  console.log(`==================================================\n`);

  const railwayCmd = process.platform === "win32" ? "railway.cmd" : "railway";
  const cmdArgs = ["up", "--service", service, "-d", "--json"];

  const res = spawnSync(railwayCmd, cmdArgs, {
    cwd: dir,
    stdio: "inherit",
    env: { ...process.env, ...(token ? { RAILWAY_TOKEN: token } : {}) },
  });

  if (res.error) {
    // If railway.cmd is not found, try raw railway executable
    const altRes = spawnSync("railway", cmdArgs, {
      cwd: dir,
      stdio: "inherit",
      env: { ...process.env, ...(token ? { RAILWAY_TOKEN: token } : {}) },
    });
    return altRes.status === 0;
  }

  return res.status === 0;
}

async function main() {
  // If webhook is provided, use that first
  if (webhookUrl) {
    try {
      await postWebhook(webhookUrl);
      console.log(`[Railway] Deployment request accepted by Railway! Check dashboard for live build logs.`);
      process.exit(0);
    } catch (e) {
      console.error("[Railway] Webhook error:", e.message);
      process.exit(1);
    }
  }

  // Otherwise, use Railway CLI direct upload
  const servicesToDeploy = isAll ? ["web", "social"] : [serviceArg];
  let ok = true;
  for (const s of servicesToDeploy) {
    const success = deployCli(s);
    if (!success) ok = false;
  }

  if (!ok) {
    console.log(`\n----------------------------------------------------------------------`);
    console.log(`[Railway Tip] If Railway CLI prompts for login, run:`);
    console.log(`   railway login`);
    console.log(`Or provide a RAILWAY_TOKEN:`);
    console.log(`   $env:RAILWAY_TOKEN = "<your_token>" ; npm run deploy:railway`);
    console.log(`Or trigger via service Deploy Webhook:`);
    console.log(`   npm run deploy:webhook -- --webhook <URL>`);
    console.log(`----------------------------------------------------------------------\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
