import { expect, it } from "vitest";
import { lpReferrer, SITE_ORIGIN } from "./lp-config";

it("参照元からパス・クエリ・フラグメントを除き、内部ページは送らない", () => {
  expect(lpReferrer("https://example.org/path?email=test%40example.org#private")).toBe("https://example.org/");
  expect(lpReferrer(`${SITE_ORIGIN}/join?code=123456`)).toBe("");
  for (const value of ["", "invalid", "file:///private", "javascript:alert(1)"]) expect(lpReferrer(value)).toBe("");
});
