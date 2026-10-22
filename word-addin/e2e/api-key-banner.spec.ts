/** Capability setup banner: missing access, configured access, dismissal and errors. */
import { test, expect } from "./support/fixtures";

const STATUS_GLOB = "**/user/api-keys";
const BANNER_TEXT = "Capability access is not configured.";

const noneConfigured = { capability: false };
const capabilityConfigured = { capability: true };

test.describe("Capability setup banner", () => {
  test("shows the setup banner when capability access is unavailable", async ({
    addin,
    page,
  }) => {
    addin.seedToken("test-access-token");
    await addin.mockApiJson("GET", STATUS_GLOB, noneConfigured);
    await addin.gotoTaskpane();
    await addin.expectAuthedShell();

    await expect(page.getByText(BANNER_TEXT)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "View capability setup" })
    ).toBeVisible();
  });

  test("stays hidden when capability access is configured", async ({
    addin,
    page,
  }) => {
    addin.seedToken("test-access-token");
    await addin.mockApiJson("GET", STATUS_GLOB, capabilityConfigured);
    const statusFetched = page.waitForResponse(STATUS_GLOB);
    await addin.gotoTaskpane();
    await addin.expectAuthedShell();

    // Only assert after the status response has landed — before that the
    // banner is hidden regardless, and the test would pass vacuously.
    await statusFetched;
    await expect(page.getByText(BANNER_TEXT)).toBeHidden();
  });

  test("dismiss hides the banner", async ({ addin, page }) => {
    addin.seedToken("test-access-token");
    await addin.mockApiJson("GET", STATUS_GLOB, noneConfigured);
    await addin.gotoTaskpane();
    await expect(page.getByText(BANNER_TEXT)).toBeVisible();

    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByText(BANNER_TEXT)).toBeHidden();
  });

  test("stays hidden when the status endpoint errors", async ({
    addin,
    page,
  }) => {
    addin.seedToken("test-access-token");
    await addin.mockApiError("GET", STATUS_GLOB, 500, "boom");
    const statusFetched = page.waitForResponse(STATUS_GLOB);
    await addin.gotoTaskpane();
    await addin.expectAuthedShell();

    await statusFetched;
    await expect(page.getByText(BANNER_TEXT)).toBeHidden();
  });
});
