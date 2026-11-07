import { expect, it } from "vitest";
import { googleLoginError } from "./hostAuth";

it("Cookieとポップアップの拒否を、対処できる日本語で案内する", () => {
  expect(googleLoginError({ code: "cookie_unavailable" })).toContain("Cookieを許可");
  expect(googleLoginError({ code: "auth/popup-blocked" })).toContain("ポップアップを許可");
  expect(googleLoginError({ code: "auth/popup-closed-by-user" })).toContain("完了しませんでした");
  expect(googleLoginError({ code: "auth/web-storage-unsupported" })).toContain("サイトデータ");
});
it("SDKエラーの本文やアカウント情報を画面の案内に含めない", () => {
  expect(googleLoginError(new Error("synthetic-private-data"))).not.toContain("synthetic-private-data");
});
