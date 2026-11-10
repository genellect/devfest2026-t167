import { expect, it } from "vitest";
import { READ_ALOUD } from "./read-aloud";

it("読み上げる文は、録音の9秒で読み切れる長さにする", () => {
  expect(READ_ALOUD.length).toBeGreaterThanOrEqual(2);
  for (const text of READ_ALOUD) expect([...text].length).toBeLessThanOrEqual(48);
});
