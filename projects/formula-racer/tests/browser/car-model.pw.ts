import { expect, test } from "@playwright/test";

test("@smoke an LFS pointer instead of the car model says how to fix it", async ({ page }) => {
  await page.route("**/assets/cars/fr26.glb", (route) =>
    route.fulfill({ body: "version https://git-lfs.github.com/spec/v1\noid sha256:79e4\nsize 1753024\n" }),
  );
  await page.goto("./");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Could not load the car model");
  await expect(alert).toContainText("fr26.glb is a Git LFS pointer, not the model; run git lfs pull");
});
