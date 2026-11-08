import { expect, test } from "@playwright/test";

test("ホーム画面に追加できるよう、マニフェストとアイコンを配信する", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Topos");
  await expect(page.locator('meta[name="application-name"]')).toHaveAttribute("content", "Topos");
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Topos");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/apple-touch-icon.png");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f8fafd");
  const res = await request.get(href!);
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: "Topos", short_name: "Topos", start_url: "/home", display: "standalone", theme_color: "#f8fafd", background_color: "#f8fafd" });
  const purposes = manifest.icons.map((i: { purpose: string }) => i.purpose);
  expect(purposes).toContain("maskable");
  for (const icon of [...manifest.icons, { src: "/icons/apple-touch-icon.png" }, { src: "/favicon.ico" }]) {
    const r = await request.get(icon.src);
    expect(r.status(), icon.src).toBe(200);
  }
});
