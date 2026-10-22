import { describe, expect, it } from "vitest";
import {
  getCachedCaseOpinionTexts,
  upsertCaseLawCases,
  type CaseLawTurnState,
} from "./caseLawTurnState";

describe("CaseLaw turn state", () => {
  it("uses the freshest non-empty opinion payload", () => {
    const state: CaseLawTurnState = { casesByClusterId: new Map() };
    upsertCaseLawCases(state, [
      {
        clusterId: 123,
        opinions: [{ opinionId: 1, text: "Partial text" }],
      },
    ]);
    upsertCaseLawCases(state, [
      {
        clusterId: 123,
        opinions: [{ opinionId: 1, text: "Complete opinion text" }],
      },
    ]);

    expect(getCachedCaseOpinionTexts(state, 123)).toMatchObject([
      { opinion_id: 1, text: "Complete opinion text" },
    ]);
  });

  it("normalizes HTML into text for citation verification", () => {
    const state: CaseLawTurnState = { casesByClusterId: new Map() };
    upsertCaseLawCases(state, [
      {
        clusterId: 456,
        opinions: [
          {
            opinionId: 2,
            html: "<p>The Court <strong>affirms</strong>.</p>",
          },
        ],
      },
    ]);

    expect(getCachedCaseOpinionTexts(state, 456)[0]?.text).toBe(
      "The Court affirms.",
    );
  });

  it("skips malformed script tags without double-decoding entities", () => {
    const state: CaseLawTurnState = { casesByClusterId: new Map() };
    upsertCaseLawCases(state, [
      {
        clusterId: 789,
        opinions: [
          {
            opinionId: 3,
            html: [
              "<script>alert('unsafe')</script >",
              "<p>Decision &amp; Costs</p>",
              "<p>&amp;lt;script&amp;gt;</p>",
            ].join(""),
          },
        ],
      },
    ]);

    const text = getCachedCaseOpinionTexts(state, 789)[0]?.text;
    expect(text).toBe("Decision & Costs &lt;script&gt;");
    expect(text).not.toContain("unsafe");
    expect(text).not.toContain("<script>");
  });
});
