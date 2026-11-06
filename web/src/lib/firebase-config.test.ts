import { expect, it } from "vitest";
import { publicFirebaseConfig } from "./firebase-config";
it("App Hostingの自動設定、明示したWeb設定、設定漏れを区別する", () => {
  expect(publicFirebaseConfig({})).toBeUndefined();
  expect(publicFirebaseConfig({ projectId: "demo-t167" })).toBeUndefined();
  expect(publicFirebaseConfig({ apiKey: "public-web-key", authDomain: "example.firebaseapp.com", projectId: "example", appId: "app" })).toMatchObject({ projectId: "example" });
  expect(() => publicFirebaseConfig({ apiKey: "public-web-key" })).toThrow("authDomain・projectId・appId");
});
