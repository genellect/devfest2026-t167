import { expect, test } from "@playwright/test";

test("ホーム画面に追加できるよう、マニフェストとアイコンを配信する", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/apple-touch-icon.png");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#ffffff");
  const res = await request.get(href!);
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: "Discuss", short_name: "Discuss", start_url: "/home", display: "standalone" });
  const purposes = manifest.icons.map((i: { purpose: string }) => i.purpose);
  expect(purposes).toContain("maskable");
  for (const icon of [...manifest.icons, { src: "/icons/apple-touch-icon.png" }, { src: "/favicon.ico" }]) {
    const r = await request.get(icon.src);
    expect(r.status(), icon.src).toBe(200);
  }
});
