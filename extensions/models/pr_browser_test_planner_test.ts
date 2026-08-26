import {
  assertEquals,
  assertMatch,
  assertThrows,
} from "jsr:@std/assert@1.0.14";
import {
  extractTestSection,
  extractTicketIds,
  model,
  resetCommandRunnerForTests,
  setCommandRunnerForTests,
  truncateUtf8,
  validateSteps,
} from "./pr_browser_test_planner.ts";

const globals = {
  cliAgentModel: "agent",
  repoSlug: "acme/web",
  repoPath: "/tmp/repo",
  targetHost: "https://smoke.example.test",
  uiPathRules: ["\\.tsx$"],
  blockedPaths: ["/admin"],
  plannerGuidance: "Avoid mutations.",
  targetLabels: ["desktop", "mobile"],
  ticketRegex: "TKT-\\d+",
  maxSteps: 20,
  maxDiffBytes: 40000,
  plannerProvider: "mock",
  plannerModel: "mock",
  plannerTimeoutMs: 1000,
};

function mockContext(writes: Record<string, unknown>[]) {
  return {
    globalArgs: globals,
    logger: { info() {}, warning() {} },
    writeResource(
      _spec: string,
      _name: string,
      data: Record<string, unknown>,
    ) {
      writes.push(data);
      return Promise.resolve({ id: "handle" });
    },
  };
}

function outputAt(writes: Record<string, unknown>[]): {
  ticketIds: string[];
  targetLabels: string[];
  steps: string[][];
  source: { hasExplicitTestPlan: boolean; backendOnly: boolean };
  invocation: { provider: string; error: string | null };
} {
  return writes[0] as ReturnType<typeof outputAt>;
}

Deno.test("extracts explicit testing section and configurable tickets", () => {
  assertEquals(
    extractTestSection("# Intro\nA\n## Testing\nDo this\n## Notes\nNo").section,
    "## Testing\nDo this",
  );
  assertEquals(extractTicketIds("TKT-2 XX-1 TKT-2", "TKT-\\d+"), ["TKT-2"]);
});

Deno.test("strictly rejects unsafe hosts, paths, verbs, and screenshot paths", () => {
  const result = validateSteps(
    [
      ["open", "https://smoke.example.test/projects"],
      ["open", "https://smoke.example.test.evil/x"],
      ["open", "https://smoke.example.test/admin/users"],
      ["open", "https://smoke.example.test/admin%2Fusers"],
      ["click", "Delete account"],
      ["exec", "rm"],
      ["screenshot", "/tmp/x.png"],
      ["screenshot", "{{screenshotDir}}/ok.png"],
    ],
    globals.targetHost,
    20,
    globals.blockedPaths,
  );
  assertEquals(result.steps.length, 2);
  assertEquals(result.rejected.length, 6);
  assertThrows(() => validateSteps([], "http://unsafe.test", 1, []));
  assertThrows(() => validateSteps([], globals.targetHost, 1, ["../admin"]));
});

Deno.test("UTF-8 truncation respects byte caps and character boundaries", () => {
  assertEquals(truncateUtf8("a🙂b", 5), {
    text: "a🙂",
    byteLength: 6,
    truncated: true,
  });
});

Deno.test("handles paginated files, explicit plan, labels, and stable output", async () => {
  const writes: Record<string, unknown>[] = [];
  let calls = 0;
  setCommandRunnerForTests((args) => {
    calls++;
    if (args[0] === "gh" && args[1] === "pr") {
      return Promise.resolve({
        success: true,
        code: 0,
        stderr: "",
        stdout: JSON.stringify({
          title: "TKT-7 UI",
          body: "## Test plan\nOpen projects",
          baseRefName: "main",
          headRefName: "TKT-7-ui",
        }),
      });
    }
    if (args[0] === "gh") {
      return Promise.resolve({
        success: true,
        code: 0,
        stderr: "",
        stdout:
          '[{"filename":"src/a.tsx","status":"modified","additions":1,"deletions":0,"patch":"+[x]"}][{"filename":"src/b.tsx","status":"added","additions":1,"deletions":0,"patch":"+b"}]',
      });
    }
    return Promise.resolve({
      success: true,
      code: 0,
      stderr: "",
      stdout: JSON.stringify({
        dataArtifacts: [{
          attributes: {
            parsedResponse: {
              reasoning: "cover UI",
              targetLabels: ["mobile", "unknown"],
              steps: [["open", "https://smoke.example.test/projects"]],
            },
            durationMs: 4,
            costUsd: 0.01,
          },
        }],
      }),
    });
  });
  try {
    await model.methods.planForPr.execute(
      { prNumber: 7, blockedPaths: [] },
      mockContext(writes),
    );
  } finally {
    resetCommandRunnerForTests();
  }
  assertEquals(calls, 3);
  const output = outputAt(writes);
  assertEquals(output.ticketIds, ["TKT-7"]);
  assertEquals(output.targetLabels, ["mobile"]);
  assertEquals(output.source.hasExplicitTestPlan, true);
  assertEquals(output.steps.length, 1);
  assertEquals(
    Object.keys(output).sort(),
    [
      "baseRef",
      "deploySha",
      "generatedAt",
      "headRef",
      "invocation",
      "prNumber",
      "prTitle",
      "reasoning",
      "rejectedSteps",
      "source",
      "status",
      "steps",
      "targetLabels",
      "ticketIds",
    ].sort(),
  );
});

Deno.test("backend-only PR skips dispatch", async () => {
  const writes: Record<string, unknown>[] = [];
  let calls = 0;
  setCommandRunnerForTests((args) => {
    calls++;
    return Promise.resolve(
      args[1] === "pr"
        ? {
          success: true,
          code: 0,
          stderr: "",
          stdout: JSON.stringify({
            title: "API",
            body: "",
            baseRefName: "main",
            headRefName: "api",
          }),
        }
        : {
          success: true,
          code: 0,
          stderr: "",
          stdout: JSON.stringify([{
            filename: "server.rb",
            status: "modified",
            additions: 1,
            deletions: 0,
          }]),
        },
    );
  });
  try {
    await model.methods.planForPr.execute(
      { prNumber: 8, blockedPaths: [] },
      mockContext(writes),
    );
  } finally {
    resetCommandRunnerForTests();
  }
  assertEquals(calls, 2);
  assertEquals(outputAt(writes).source.backendOnly, true);
  assertEquals(outputAt(writes).invocation.provider, "skipped");
});

for (const scenario of ["malformed", "dispatch"] as const) {
  Deno.test(`${scenario} agent failure preserves output contract`, async () => {
    const writes: Record<string, unknown>[] = [];
    setCommandRunnerForTests((args) => {
      if (args[0] === "gh" && args[1] === "pr") {
        return Promise.resolve({
          success: true,
          code: 0,
          stderr: "",
          stdout: JSON.stringify({
            title: "UI",
            body: "",
            baseRefName: "main",
            headRefName: "ui",
          }),
        });
      }
      if (args[0] === "gh") {
        return Promise.resolve({
          success: true,
          code: 0,
          stderr: "",
          stdout: JSON.stringify([{
            filename: "ui.tsx",
            status: "modified",
            additions: 1,
            deletions: 0,
          }]),
        });
      }
      return Promise.resolve(
        scenario === "dispatch"
          ? { success: false, code: 9, stderr: "denied", stdout: "" }
          : { success: true, code: 0, stderr: "", stdout: "not-json" },
      );
    });
    try {
      await model.methods.planForPr.execute(
        { prNumber: 9, blockedPaths: [] },
        mockContext(writes),
      );
    } finally {
      resetCommandRunnerForTests();
    }
    assertEquals(outputAt(writes).steps, []);
    assertMatch(
      outputAt(writes).invocation.error ?? "",
      scenario === "dispatch" ? /dispatch failed/ : /malformed/,
    );
  });
}
