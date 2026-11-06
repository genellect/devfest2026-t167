import { describe, expect, it } from "vitest";
import { normalizeJoinCode, typedJoinCode } from "./join-code";
import { parseDiscussionQr } from "./discussion-qr";

describe("参加コード", () => {
  it("手入力は数字だけを6桁まで残し、全角の数字も半角にそろえる", () => {
    expect(typedJoinCode("12-3 ４５６a")).toBe("123456");
    expect(typedJoinCode("1234567")).toBe("123456");
    expect(typedJoinCode("abc")).toBe("");
  });
  it("QRやURLのコードは、以前の英数字6文字も受け付ける", () => {
    expect(normalizeJoinCode("ab-12cd")).toBe("AB12CD");
    expect(normalizeJoinCode("004213")).toBe("004213");
  });
  it("参加用のQRは同じサイトの /join?code= か6文字のコードだけで、ほかのリンクは使わない", () => {
    const origin = "https://example.test";
    expect(parseDiscussionQr(`${origin}/join?code=004213`, origin)).toBe("004213");
    expect(parseDiscussionQr("004213", origin)).toBe("004213");
    expect(parseDiscussionQr("https://evil.test/join?code=004213", origin)).toBeNull();
    expect(parseDiscussionQr(`${origin}/join?code=004213&code=111111`, origin)).toBeNull();
    expect(parseDiscussionQr(`${origin}/other?code=004213`, origin)).toBeNull();
  });
});
