import { describe, expect, it } from "vitest";
import { closeDecision, type CloseAction, type CloseState } from "../src/space/closeDecision";
import type { CloseVia } from "../src/space/state";

const VIAS: CloseVia[] = ["done", "escape", "backdrop", "pull", "nav"];

const existing = (over: Partial<CloseState> = {}): CloseState => ({ isNew: false, dirty: false, valid: true, titled: true, ...over });
const fresh = (over: Partial<CloseState> = {}): CloseState => ({ isNew: true, dirty: false, valid: true, titled: false, ...over });

/** every via gives the same answer, or the table names it per via */
function table(state: CloseState, expected: CloseAction | Record<CloseVia, CloseAction>) {
  for (const via of VIAS) {
    const want = typeof expected === "string" ? expected : expected[via];
    expect(closeDecision(state, via), `${JSON.stringify(state)} via ${via}`).toBe(want);
  }
}

describe("closeDecision (D6)", () => {
  it("existing and clean: closes by every path", () => {
    table(existing(), "close");
  });

  it("existing and dirty: saves by every path", () => {
    table(existing({ dirty: true }), "save");
  });

  it("existing, dirty and invalid (e.g. title cleared): stays and shows the error", () => {
    table(existing({ dirty: true, valid: false }), "stay");
    table(existing({ dirty: true, valid: false, titled: false }), "stay");
  });

  it("existing but invalid without changes (odd coach data): just closes", () => {
    table(existing({ valid: false }), "close");
  });

  it("new and empty: never saved, closes by every path", () => {
    table(fresh(), "close");
    // even with other fields touched: an empty title is never saved
    table(fresh({ dirty: true }), "close");
    table(fresh({ dirty: true, valid: false }), "close");
  });

  it("new with a title: ✓ saves, every other path asks", () => {
    table(fresh({ titled: true, dirty: true }), { done: "save", escape: "ask", backdrop: "ask", pull: "ask", nav: "ask" });
  });

  it("new with a title but invalid (e.g. end before start): ✓ stays with the error, others ask", () => {
    table(fresh({ titled: true, dirty: true, valid: false }), { done: "stay", escape: "ask", backdrop: "ask", pull: "ask", nav: "ask" });
  });
});
