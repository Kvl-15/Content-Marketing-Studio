// @ts-check
/**
 * @file scripts/intake-demo.js
 * CLI Demonstration of the Intake workflow + Gemini AI Gateway.
 * Works with `node --env-file=.env scripts/intake-demo.js`.
 *
 * Prints: model name, thinking level used, number of attempts, elapsed ms, outcome (ok / retry / failed).
 * Never prints brief text, API key, or raw response bodies (Requirement 6, D-10).
 */

import { parseBrief } from "../server/ai/gateway.js";
import { emptySpec } from "../server/intake/emptySpec.js";
import { findGaps } from "../server/intake/gaps.js";

async function run() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  console.log("==================================================");
  console.log("   ACM STUDIO - INTAKE & AI GATEWAY DEMO");
  console.log("==================================================\n");

  if (apiKey && apiKey.trim() !== "") {
    console.log("Mode: Gemini AI Gateway Active");
    console.log("Parsing brief via Gemini REST API...\n");

    const sampleBrief =
      "We need ID cards for the 24-hour Hackathon at SVNIT Surat on 2026-10-20. " +
      "We expect 200 participants and 15 mentors. Participant cards should display name, role, and organization.";

    const result = await parseBrief(sampleBrief, {
      today: "2026-10-20",
      model,
    });

    // Requirement 6: print model name, thinking level used, attempts, elapsed ms, outcome
    console.log("[EXECUTION SUMMARY]");
    console.log(`- Model name:          ${result.meta.model}`);
    console.log(`- Thinking level used: ${result.meta.thinkingLevel ?? "omitted"}`);
    console.log(`- Number of attempts:  ${result.meta.attempts}`);
    console.log(`- Elapsed ms:          ${result.meta.elapsedMs} ms`);
    console.log(`- Outcome:             ${result.meta.outcome}`);

    if (result.ok) {
      console.log("\n[SUCCESS] Brief Parsed into EventSpec scaffold:");
      console.log(`- Design Type: ${result.designType}`);
      console.log(`- Event Name:  ${result.spec.event.name?.value} (status: ${result.spec.event.name?.status}, confirmed: ${result.spec.event.name?.confirmed})`);
      console.log(`- Venue:       ${result.spec.event.venue?.value} (status: ${result.spec.event.venue?.status}, confirmed: ${result.spec.event.venue?.confirmed})`);
      console.log(`- Dates:       ${result.spec.event.dates?.value?.join(", ")} (status: ${result.spec.event.dates?.status})`);
      console.log(`- Tagline:     ${result.spec.event.tagline?.value ?? "None"} (status: ${result.spec.event.tagline?.status})`);
      console.log(`- Card Fields: ${result.spec.fields?.value?.join(", ")} (status: ${result.spec.fields?.status})`);

      console.log("\nRoles extracted:");
      result.spec.roles.forEach((r, idx) => {
        console.log(`  ${idx + 1}. [${r.id}] "${r.label}" (expected: ${r.expectedCount}, color: ${r.color.value})`);
      });

      const gaps = findGaps(result.spec);
      console.log("\nGap Analysis:");
      console.log(`- Has Required Gaps: ${gaps.hasRequiredGaps}`);
      if (gaps.required.length > 0) {
        console.log("  Required gaps remaining:");
        gaps.required.forEach((g) => console.log(`    * ${g.label} (${g.path}): ${g.reason}`));
      } else {
        console.log("  All required fields provided! Ready for confirmation and locking.");
      }
      console.log(`- Optional fields available to ask: ${gaps.optional.map((o) => o.label).join(", ")}`);
    } else {
      console.log(`\n[AI FAILED / RETRY EXHAUSTED]: ${result.error.message}`);
      console.log("Opening emptySpec manual form fallback (D-12)...");
      const gaps = findGaps(result.emptySpec);
      console.log(`Remaining gaps on empty spec: ${gaps.required.length} required gaps.`);
    }
  } else {
    console.log("Mode: Non-AI Manual Form Fallback (D-12)");
    console.log("Notice: GEMINI_API_KEY is not set or empty.\n");
    console.log("Generating empty scaffold via emptySpec('id-card')...");

    const spec = emptySpec("id-card");
    const gaps = findGaps(spec);

    console.log("\nEmpty EventSpec Initialised:");
    console.log(`- Design Type: ${spec.designType}`);
    console.log(`- Card Dimensions: ${spec.card.widthMm} x ${spec.card.heightMm} mm (CR80 portrait)`);
    console.log(`- Print Bleed: ${spec.card.bleedMm} mm | Margin: ${spec.card.safeMarginMm} mm`);
    console.log(`- QR Enabled: ${spec.qr.enabled} (D-39)`);

    console.log("\nOpen Required Gaps for Manual Intake Form:");
    gaps.required.forEach((g, idx) => {
      console.log(`  ${idx + 1}. ${g.label} (${g.path}) -> ${g.reason}`);
    });

    console.log("\nOptional Gaps:");
    gaps.optional.forEach((g, idx) => {
      console.log(`  ${idx + 1}. ${g.label} (${g.path}) -> ${g.reason}`);
    });
  }

  console.log("\n==================================================");
  console.log("   DEMO COMPLETE");
  console.log("==================================================");
}

run().catch((err) => {
  console.error("Intake demo failed:", err);
  process.exit(1);
});
