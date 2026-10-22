// @ts-check
/**
 * @file scripts/verify-groq-live.js
 * Controlled local-only live integration check for Gemini -> Groq fallback.
 *
 * Simulates a transient Gemini HTTP 503 locally, allowing outbound Groq
 * requests to reach the real Groq API using the local GROQ_API_KEY.
 *
 * Privacy & Security:
 * - Never prints or exposes API keys, request headers, prompts, or raw response bodies.
 * - Fails safely if credentials or outbound access are unavailable.
 *
 * Usage:
 *   node scripts/verify-groq-live.js
 *   or:
 *   GROQ_API_KEY=gsk_... node scripts/verify-groq-live.js
 */

import { parseBrief, DEFAULT_GROQ_MODEL } from "../server/ai/gateway.js";

// Load environment from .env if present
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch {
    // Optional .env
  }
}

async function runLiveCheck() {
  const groqApiKey = process.env.GROQ_API_KEY;
  const groqModel = process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;

  console.log("===============================================================");
  console.log("   ACM STUDIO - CONTROLLED LOCAL LIVE GROQ FALLBACK CHECK");
  console.log("===============================================================\n");

  if (!groqApiKey || groqApiKey.trim() === "") {
    console.log("[STATUS]: SKIPPED / UNAVAILABLE");
    console.log("Reason: GROQ_API_KEY is not configured in the local environment or .env file.");
    console.log("Instructions: Set GROQ_API_KEY in your local .env or pass it as an environment variable:");
    console.log("  $env:GROQ_API_KEY=\"gsk_...\"\n  node scripts/verify-groq-live.js\n");
    console.log("Live check concluded without calling external APIs (credentials unavailable).");
    return {
      status: "SKIPPED_CREDENTIALS_UNAVAILABLE",
      reason: "GROQ_API_KEY is missing or empty",
    };
  }

  console.log("Configuration:");
  console.log(`- Groq Model:     ${groqModel}`);
  console.log(`- Simulated Error: Gemini HTTP 503 (Service Unavailable)`);
  console.log(`- Groq Key Status: Configured (length: ${groqApiKey.length} chars)\n`);

  // Brief containing explicitly supported event name, venue, date, and roles
  const sampleBrief =
    "We need ID cards for the ACM DevFest at SVNIT Surat on 2026-10-25 with 150 participants.";

  console.log("Executing parseBrief() with simulated Gemini 503 and live Groq endpoint...");

  // Intercept Gemini only; allow real fetch to reach api.groq.com
  let geminiIntercepted = false;
  let groqIntercepted = false;

  const liveInterceptedFetch = async (url, options) => {
    if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
      geminiIntercepted = true;
      return {
        ok: false,
        status: 503,
        text: async () => "Simulated Gemini 503: Service Unavailable (Overloaded)",
      };
    }
    if (typeof url === "string" && url.includes("api.groq.com")) {
      groqIntercepted = true;
      return globalThis.fetch(url, options);
    }
    return globalThis.fetch(url, options);
  };

  try {
    const result = await parseBrief(sampleBrief, {
      today: "2026-10-20",
      apiKey: process.env.GEMINI_API_KEY || "local-test-gemini-key",
      groqApiKey,
      groqModel,
      fetchFn: liveInterceptedFetch,
    });

    console.log("\n[EXECUTION RESULTS]");
    console.log(`- Gemini simulated 503 triggered: ${geminiIntercepted}`);
    console.log(`- Real Groq API dispatched:        ${groqIntercepted}`);
    console.log(`- Parse status:                    ${result.ok ? "SUCCESS" : "FAILED"}`);

    if (result.ok) {
      console.log(`- Active Provider:                 ${result.meta.provider}`);
      console.log(`- Fallback Source:                 ${result.meta.fallbackFrom ?? "none"}`);
      console.log(`- Model:                           ${result.meta.model}`);
      console.log(`- Attempts count:                  ${result.meta.attempts}`);
      console.log(`- Elapsed time:                    ${result.meta.elapsedMs} ms`);

      // Verify EventSpec contract and provenance
      console.log("\n[EVENT SPEC VERIFICATION]");
      console.log(`- Design Type:   ${result.designType}`);
      console.log(
        `- Event Name:    "${result.spec.event.name?.value}" (status: ${result.spec.event.name?.status}, source: ${result.spec.event.name?.source}, confirmed: ${result.spec.event.name?.confirmed})`
      );
      console.log(
        `- Venue:         "${result.spec.event.venue?.value}" (status: ${result.spec.event.venue?.status}, source: ${result.spec.event.venue?.source}, confirmed: ${result.spec.event.venue?.confirmed})`
      );
      console.log(
        `- Dates:         [${result.spec.event.dates?.value?.join(", ")}] (status: ${result.spec.event.dates?.status}, source: ${result.spec.event.dates?.source}, confirmed: ${result.spec.event.dates?.confirmed})`
      );

      if (Array.isArray(result.spec.roles) && result.spec.roles.length > 0) {
        console.log(`- Roles (${result.spec.roles.length}):`);
        for (const role of result.spec.roles) {
          console.log(
            `  • "${role.label}" (id: ${role.id}, count: ${role.expectedCount}, color: ${role.color?.value}, color.status: ${role.color?.status}, color.confirmed: ${role.color?.confirmed})`
          );
        }
      } else {
        console.log(
          `- Roles:         [] (none extracted from brief; will be collected in intake questionnaire)`
        );
      }

      // Canonical EventSpec contract validation checks
      const checks = [
        {
          name: "Provider is Groq",
          pass: result.meta.provider === "groq",
          actual: result.meta.provider,
        },
        {
          name: "Fallback source is Gemini",
          pass: result.meta.fallbackFrom === "gemini",
          actual: result.meta.fallbackFrom,
        },
        {
          name: "Model matches configuration",
          pass: result.meta.model === groqModel,
          actual: result.meta.model,
        },
        {
          name: "Design type is id-card",
          pass: result.designType === "id-card",
          actual: result.designType,
        },
        {
          name: "Schema version is 1",
          pass: result.spec?.schemaVersion === 1,
          actual: result.spec?.schemaVersion,
        },
        {
          name: "Event name is 'ACM DevFest'",
          pass: result.spec?.event?.name?.value === "ACM DevFest",
          actual: result.spec?.event?.name?.value,
        },
        {
          name: "Event name provenance is provided/brief/unconfirmed",
          pass:
            result.spec?.event?.name?.status === "provided" &&
            result.spec?.event?.name?.source === "brief" &&
            result.spec?.event?.name?.confirmed === false,
          actual: `${result.spec?.event?.name?.status}/${result.spec?.event?.name?.source}/confirmed:${result.spec?.event?.name?.confirmed}`,
        },
        {
          name: "Venue is 'SVNIT Surat'",
          pass: result.spec?.event?.venue?.value === "SVNIT Surat",
          actual: result.spec?.event?.venue?.value,
        },
        {
          name: "Venue provenance is provided/brief/unconfirmed",
          pass:
            result.spec?.event?.venue?.status === "provided" &&
            result.spec?.event?.venue?.source === "brief" &&
            result.spec?.event?.venue?.confirmed === false,
          actual: `${result.spec?.event?.venue?.status}/${result.spec?.event?.venue?.source}/confirmed:${result.spec?.event?.venue?.confirmed}`,
        },
        {
          name: "Event date includes '2026-10-25'",
          pass:
            Array.isArray(result.spec?.event?.dates?.value) &&
            result.spec?.event?.dates?.value?.includes("2026-10-25"),
          actual: JSON.stringify(result.spec?.event?.dates?.value),
        },
        {
          name: "Event date provenance is provided/brief/unconfirmed",
          pass:
            result.spec?.event?.dates?.status === "provided" &&
            result.spec?.event?.dates?.source === "brief" &&
            result.spec?.event?.dates?.confirmed === false,
          actual: `${result.spec?.event?.dates?.status}/${result.spec?.event?.dates?.source}/confirmed:${result.spec?.event?.dates?.confirmed}`,
        },
        {
          name: "Roles array conforms to EventSpec contract",
          pass:
            Array.isArray(result.spec?.roles) &&
            result.spec.roles.every(
              (r) =>
                typeof r.id === "string" &&
                r.id.length > 0 &&
                typeof r.label === "string" &&
                r.label.length > 0 &&
                typeof r.expectedCount === "number" &&
                r.expectedCount >= 0 &&
                r.color?.status === "defaulted" &&
                r.color?.source === "default" &&
                r.color?.confirmed === false &&
                typeof r.color?.value === "string" &&
                /^#[0-9A-Fa-f]{6}$/.test(r.color.value)
            ),
          actual: `count: ${result.spec?.roles?.length}`,
        },
      ];

      const failedChecks = checks.filter((c) => !c.pass);
      const isValid = failedChecks.length === 0;

      if (isValid) {
        console.log("\n>>> LIVE INTEGRATION VERIFICATION: PASSED <<<");
        return { status: "PASSED", result };
      } else {
        console.log("\n>>> LIVE INTEGRATION VERIFICATION: FAILED (Contract mismatch) <<<");
        for (const failure of failedChecks) {
          console.log(`  ❌ Failed check: "${failure.name}" (got: ${failure.actual})`);
        }
        return { status: "FAILED_CONTRACT_MISMATCH", result, failedChecks };
      }
    } else {
      console.log(`\n[ERROR]: ${result.error?.message}`);
      console.log(">>> LIVE INTEGRATION VERIFICATION: FAILED <<<");
      return { status: "FAILED", error: result.error };
    }
  } catch (err) {
    console.log(`\n[NETWORK / SYSTEM ERROR]: ${err?.message || "Unknown error"}`);
    console.log(">>> LIVE INTEGRATION VERIFICATION: FAILED (Outbound error) <<<");
    return { status: "FAILED_NETWORK", error: err };
  }
}

runLiveCheck().then((res) => {
  if (res?.status === "FAILED" || res?.status === "FAILED_CONTRACT_MISMATCH" || res?.status === "FAILED_NETWORK") {
    process.exitCode = 1;
  }
});
