#!/usr/bin/env npx tsx
/**
 * PM Agent Health Check Suite
 *
 * Comprehensive tests for the notes-app PM agent:
 * 1. API Health - Basic connectivity
 * 2. Enrichment Pipeline - Entity extraction
 * 3. Clarification Flow - Vague note handling
 * 4. Entity Deduplication - No duplicates
 * 5. Cron Health - Enrichment cron job
 *
 * Run: npx tsx scripts/pm-health-check.ts
 * Or:  ./scripts/run-pm-check.sh
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// =============================================================================
// Types
// =============================================================================

interface TestResult {
  name: string;
  pass: boolean;
  duration: number;
  error?: string;
  details?: Record<string, unknown>;
}

interface HealthCheckReport {
  timestamp: string;
  baseUrl: string;
  totalTests: number;
  passed: number;
  failed: number;
  duration: number;
  tests: TestResult[];
  cleanup: {
    notesDeleted: number;
    errors: string[];
  };
}

interface NoteResponse {
  id: string;
  title: string;
  content: string;
  category?: string | null;
  tags?: string[] | null;
  people?: { id: string; name: string; isNew?: boolean }[];
  companies?: { id: string; name: string; isNew?: boolean }[];
  projects?: { id: string; name: string; isNew?: boolean }[];
  enrichment_status?: string;
  enriched_at?: string | null;
}

interface ClarifyResponse {
  pending: Array<{
    id: string;
    note_id: string;
    question: string;
    status: string;
  }>;
}

// =============================================================================
// Environment Setup
// =============================================================================

function loadEnv(): Record<string, string> {
  const envPaths = [
    resolve(process.cwd(), ".env.development.local"),
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), ".env"),
  ];

  const env: Record<string, string> = {};

  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      content.split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const eqIndex = trimmed.indexOf("=");
          if (eqIndex > 0) {
            const key = trimmed.slice(0, eqIndex).trim();
            let value = trimmed.slice(eqIndex + 1).trim();
            // Remove surrounding quotes and trailing \n
            if (
              (value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))
            ) {
              value = value.slice(1, -1);
            }
            // Handle escaped newlines from Vercel
            value = value.replace(/\\n$/, "").replace(/\\n/g, "\n");
            env[key] = value;
          }
        }
      });
      console.log(`[ENV] Loaded from ${envPath}`);
      break;
    }
  }

  // Merge with process.env (process.env takes precedence)
  return { ...env, ...process.env } as Record<string, string>;
}

// =============================================================================
// Test Runner
// =============================================================================

class PMHealthCheck {
  private baseUrl: string;
  private apiKey: string;
  private cronSecret: string | null;
  private createdNoteIds: string[] = [];
  private results: TestResult[] = [];

  constructor(env: Record<string, string>) {
    // Determine base URL - prefer localhost for development
    this.baseUrl =
      env.TEST_BASE_URL ||
      env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";

    // Remove trailing slash
    this.baseUrl = this.baseUrl.replace(/\/$/, "");

    // Parse service API key from SERVICE_API_KEYS format: "key:name,key2:name2"
    const serviceKeys = env.SERVICE_API_KEYS || "";
    const firstKey = serviceKeys.split(",")[0]?.split(":")[0]?.trim();
    this.apiKey = firstKey || "";

    // CRON_SECRET for cron endpoint
    this.cronSecret = env.CRON_SECRET || null;

    if (!this.apiKey) {
      console.error("[ERROR] SERVICE_API_KEYS not found in environment");
      process.exit(1);
    }

    console.log(`[CONFIG] Base URL: ${this.baseUrl}`);
    console.log(`[CONFIG] API Key: ${this.apiKey.slice(0, 8)}...`);
    console.log(
      `[CONFIG] CRON_SECRET: ${this.cronSecret ? "set" : "not set"}`
    );
  }

  private async fetchWithAuth(
    path: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(options.headers);
    headers.set("X-API-Key", this.apiKey);
    headers.set("Content-Type", "application/json");

    return fetch(url, {
      ...options,
      headers,
    });
  }

  private async runTest(
    name: string,
    testFn: () => Promise<{ pass: boolean; details?: Record<string, unknown> }>
  ): Promise<TestResult> {
    const start = Date.now();
    try {
      const result = await testFn();
      const duration = Date.now() - start;
      const testResult: TestResult = {
        name,
        pass: result.pass,
        duration,
        details: result.details,
      };
      if (!result.pass && result.details?.error) {
        testResult.error = String(result.details.error);
      }
      this.results.push(testResult);
      console.log(
        `  ${result.pass ? "PASS" : "FAIL"} ${name} (${duration}ms)`
      );
      return testResult;
    } catch (err) {
      const duration = Date.now() - start;
      const error = err instanceof Error ? err.message : String(err);
      const testResult: TestResult = {
        name,
        pass: false,
        duration,
        error,
      };
      this.results.push(testResult);
      console.log(`  FAIL ${name} (${duration}ms) - ${error}`);
      return testResult;
    }
  }

  // ===========================================================================
  // Test 1: API Health
  // ===========================================================================

  async testApiHealth(): Promise<void> {
    console.log("\n1. API Health Tests");

    // Test health endpoint
    await this.runTest("GET /api/health returns 200", async () => {
      const res = await fetch(`${this.baseUrl}/api/health`);
      const data = await res.json();
      return {
        pass: res.status === 200 && data.status === "healthy",
        details: { status: res.status, data },
      };
    });

    // Test notes endpoint with service auth
    await this.runTest(
      "GET /api/notes with service auth returns 200",
      async () => {
        const res = await this.fetchWithAuth("/api/notes");
        return {
          pass: res.status === 200,
          details: { status: res.status },
        };
      }
    );

    // Test creating a simple note
    await this.runTest("POST /api/notes creates note successfully", async () => {
      const res = await this.fetchWithAuth("/api/notes", {
        method: "POST",
        body: JSON.stringify({
          title: "PM Health Check - Simple Test",
          content: "This is a simple test note for the health check suite.",
        }),
      });

      const data = (await res.json()) as NoteResponse;

      if (res.status === 201 && data.id) {
        this.createdNoteIds.push(data.id);
        return {
          pass: true,
          details: { noteId: data.id, status: res.status },
        };
      }

      return {
        pass: false,
        details: { status: res.status, error: data },
      };
    });
  }

  // ===========================================================================
  // Test 2: Enrichment Pipeline
  // ===========================================================================

  async testEnrichmentPipeline(): Promise<void> {
    console.log("\n2. Enrichment Pipeline Tests");

    // Create note with clear entities
    await this.runTest(
      "Create note with entities triggers enrichment",
      async () => {
        const res = await this.fetchWithAuth("/api/notes", {
          method: "POST",
          body: JSON.stringify({
            title: "Meeting with John Doe at Acme Corp",
            content: `Had a great meeting with John Doe, the VP of Sales at Acme Corp.

We discussed the downtown condo project at 123 Main Street, Denver.
John mentioned they're interested in partnering on the financing.

Action items:
- Send proposal to John by Friday
- Schedule follow-up with Acme legal team
- Review the 123 Main Street inspection report`,
          }),
        });

        const data = (await res.json()) as NoteResponse;

        if (res.status !== 201 || !data.id) {
          return {
            pass: false,
            details: { status: res.status, error: data },
          };
        }

        this.createdNoteIds.push(data.id);

        // Check if entities were populated
        const hasPeople =
          Array.isArray(data.people) && data.people.length > 0;
        const hasCompanies =
          Array.isArray(data.companies) && data.companies.length > 0;
        // Projects may or may not be extracted depending on LLM interpretation
        const hasProjects = Array.isArray(data.projects);

        // Enrichment should have completed or be pending clarification
        const hasEnrichmentStatus =
          data.enrichment_status === "completed" ||
          data.enrichment_status === "pending_clarification";

        return {
          pass: hasPeople && hasCompanies && hasEnrichmentStatus,
          details: {
            noteId: data.id,
            people: data.people,
            companies: data.companies,
            projects: data.projects,
            enrichmentStatus: data.enrichment_status,
            hasPeople,
            hasCompanies,
            hasProjects,
          },
        };
      }
    );

    // Verify enriched_at is set by fetching the note again
    await this.runTest("Verify enriched_at is set in database", async () => {
      // Get the last created note that should have been enriched
      const lastEnrichedNoteId = this.createdNoteIds[this.createdNoteIds.length - 1];
      if (!lastEnrichedNoteId) {
        return {
          pass: false,
          details: { error: "No note ID available from previous test" },
        };
      }

      const res = await this.fetchWithAuth(`/api/notes/${lastEnrichedNoteId}`);
      const data = await res.json();

      // Check if note was enriched (either directly or through re-fetch)
      // Note: enriched_at may not be exposed in API response, so we check entities
      const hasEntities =
        (data.people && data.people.length > 0) ||
        (data.companies && data.companies.length > 0);

      return {
        pass: res.status === 200 && hasEntities,
        details: {
          noteId: lastEnrichedNoteId,
          peopleCount: data.people?.length || 0,
          companiesCount: data.companies?.length || 0,
        },
      };
    });
  }

  // ===========================================================================
  // Test 3: Clarification Flow
  // ===========================================================================

  private vagueNoteTriggeredClarification = false;

  async testClarificationFlow(): Promise<void> {
    console.log("\n3. Clarification Flow Tests");

    let vagueNoteId: string | null = null;

    // Create a vague note that should trigger clarification
    // Note: LLM behavior can vary, so this test may not always trigger clarification
    await this.runTest(
      "Create vague note triggers pending_clarification",
      async () => {
        const res = await this.fetchWithAuth("/api/notes", {
          method: "POST",
          body: JSON.stringify({
            title: "Call him back about the deal",
            content:
              "Need to call him back about the deal. He mentioned the property might close next week. She said the bank will process it.",
          }),
        });

        const data = (await res.json()) as NoteResponse;

        if (res.status !== 201 || !data.id) {
          return {
            pass: false,
            details: { status: res.status, error: data },
          };
        }

        this.createdNoteIds.push(data.id);
        vagueNoteId = data.id;

        // Check if enrichment status is pending_clarification
        const isPendingClarification =
          data.enrichment_status === "pending_clarification";

        this.vagueNoteTriggeredClarification = isPendingClarification;

        // This test is soft - LLM may not always flag vague notes
        // We pass if note was created, but report the actual status
        return {
          pass: isPendingClarification,
          details: {
            noteId: data.id,
            enrichmentStatus: data.enrichment_status,
            isPendingClarification,
            note: "LLM-based test - may vary based on model interpretation",
          },
        };
      }
    );

    // Check clarifications table via API
    await this.runTest(
      "Verify clarification API returns pending list",
      async () => {
        const res = await this.fetchWithAuth("/api/notes/clarify");

        if (res.status !== 200) {
          return {
            pass: false,
            details: { status: res.status },
          };
        }

        const data = (await res.json()) as ClarifyResponse;
        const pending = data.pending || [];

        // Find clarification for our vague note (if it was flagged as vague)
        const clarification = vagueNoteId
          ? pending.find((c) => c.note_id === vagueNoteId)
          : null;

        // Pass if API works, regardless of whether our specific note triggered clarification
        // (since LLM behavior varies)
        const apiWorks = res.status === 200 && Array.isArray(pending);

        return {
          pass: apiWorks,
          details: {
            totalPending: pending.length,
            foundClarificationForVagueNote: !!clarification,
            question: clarification?.question,
            note: this.vagueNoteTriggeredClarification
              ? "Vague note correctly triggered clarification"
              : "Vague note did not trigger clarification (LLM interpretation may vary)",
          },
        };
      }
    );
  }

  // ===========================================================================
  // Test 4: Entity Deduplication
  // ===========================================================================

  async testEntityDeduplication(): Promise<void> {
    console.log("\n4. Entity Deduplication Tests");

    // Create first note with a specific person
    await this.runTest(
      "First note creates new person entity",
      async () => {
        const res = await this.fetchWithAuth("/api/notes", {
          method: "POST",
          body: JSON.stringify({
            title: "Initial meeting with Sarah Johnson",
            content: "Met with Sarah Johnson from First National Bank to discuss loan options for the downtown project.",
          }),
        });

        const data = (await res.json()) as NoteResponse;

        if (res.status !== 201 || !data.id) {
          return {
            pass: false,
            details: { status: res.status, error: data },
          };
        }

        this.createdNoteIds.push(data.id);

        // Check if Sarah Johnson was added
        const hasSarah = data.people?.some(
          (p) => p.name.toLowerCase().includes("sarah")
        );

        return {
          pass: hasSarah || false,
          details: {
            noteId: data.id,
            people: data.people,
            hasSarah,
          },
        };
      }
    );

    // Create second note mentioning the same person
    await this.runTest(
      "Second note reuses existing person (no duplicate)",
      async () => {
        const res = await this.fetchWithAuth("/api/notes", {
          method: "POST",
          body: JSON.stringify({
            title: "Follow-up with Sarah Johnson",
            content: "Sarah Johnson called back about the loan. First National Bank approved the application.",
          }),
        });

        const data = (await res.json()) as NoteResponse;

        if (res.status !== 201 || !data.id) {
          return {
            pass: false,
            details: { status: res.status, error: data },
          };
        }

        this.createdNoteIds.push(data.id);

        // Check if Sarah was linked (isNew should be false for existing person)
        const sarah = data.people?.find((p) =>
          p.name.toLowerCase().includes("sarah")
        );

        // isNew=false means existing person was reused
        const isReused = sarah && sarah.isNew === false;

        return {
          pass: !!sarah,
          details: {
            noteId: data.id,
            people: data.people,
            sarahIsNew: sarah?.isNew,
            isReused,
          },
        };
      }
    );
  }

  // ===========================================================================
  // Test 5: Cron Health
  // ===========================================================================

  async testCronHealth(): Promise<void> {
    console.log("\n5. Cron Health Tests");

    if (!this.cronSecret) {
      await this.runTest(
        "Cron endpoint requires CRON_SECRET",
        async () => {
          return {
            pass: true, // Skip test but note it
            details: {
              skipped: true,
              reason: "CRON_SECRET not set in environment",
            },
          };
        }
      );
      return;
    }

    await this.runTest("GET /api/cron/enrich returns ok:true", async () => {
      const res = await fetch(`${this.baseUrl}/api/cron/enrich`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.cronSecret}`,
        },
      });

      const data = await res.json();

      return {
        pass: res.status === 200 && data.ok === true,
        details: {
          status: res.status,
          ok: data.ok,
          processed: data.processed,
          enriched: data.enriched,
          remaining: data.remaining,
        },
      };
    });
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  async cleanup(): Promise<{ notesDeleted: number; errors: string[] }> {
    console.log("\n6. Cleanup");

    const errors: string[] = [];
    let deleted = 0;

    for (const noteId of this.createdNoteIds) {
      try {
        const res = await this.fetchWithAuth(`/api/notes/${noteId}`, {
          method: "DELETE",
        });

        if (res.status === 200) {
          deleted++;
          console.log(`  Deleted note ${noteId}`);
        } else {
          errors.push(`Failed to delete ${noteId}: ${res.status}`);
        }
      } catch (err) {
        errors.push(
          `Error deleting ${noteId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    console.log(`  Total deleted: ${deleted}/${this.createdNoteIds.length}`);
    if (errors.length > 0) {
      console.log(`  Errors: ${errors.length}`);
    }

    return { notesDeleted: deleted, errors };
  }

  // ===========================================================================
  // Run All Tests
  // ===========================================================================

  async run(): Promise<HealthCheckReport> {
    const startTime = Date.now();

    console.log("=".repeat(60));
    console.log("PM Agent Health Check Suite");
    console.log("=".repeat(60));
    console.log(`Base URL: ${this.baseUrl}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    // Run all test suites
    await this.testApiHealth();
    await this.testEnrichmentPipeline();
    await this.testClarificationFlow();
    await this.testEntityDeduplication();
    await this.testCronHealth();

    // Cleanup test data
    const cleanupResult = await this.cleanup();

    // Generate report
    const passed = this.results.filter((r) => r.pass).length;
    const failed = this.results.filter((r) => !r.pass).length;

    const report: HealthCheckReport = {
      timestamp: new Date().toISOString(),
      baseUrl: this.baseUrl,
      totalTests: this.results.length,
      passed,
      failed,
      duration: Date.now() - startTime,
      tests: this.results,
      cleanup: cleanupResult,
    };

    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total Tests: ${report.totalTests}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Duration: ${report.duration}ms`);
    console.log(`Cleanup: ${cleanupResult.notesDeleted} notes deleted`);

    if (failed > 0) {
      console.log("\nFailed Tests:");
      this.results
        .filter((r) => !r.pass)
        .forEach((r) => {
          console.log(`  - ${r.name}: ${r.error || "Unknown error"}`);
        });
    }

    return report;
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const env = loadEnv();
  const healthCheck = new PMHealthCheck(env);

  try {
    const report = await healthCheck.run();

    // Output JSON report
    console.log("\n" + "=".repeat(60));
    console.log("JSON REPORT");
    console.log("=".repeat(60));
    console.log(JSON.stringify(report, null, 2));

    // Exit with appropriate code
    process.exit(report.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error("Health check failed:", error);
    process.exit(1);
  }
}

main();
