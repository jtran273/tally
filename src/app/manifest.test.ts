import assert from "node:assert/strict";
import test from "node:test";
import manifest from "./manifest";

test("manifest supports install without private notification payloads", () => {
  const value = manifest();

  assert.equal(value.short_name, "Tally");
  assert.equal(value.start_url, "/dashboard");
  assert.equal(value.display, "standalone");
  assert.equal(value.scope, "/");
  assert.deepEqual(
    value.icons?.map((icon) => ({ src: icon.src, sizes: icon.sizes, purpose: icon.purpose })),
    [
      { src: "/icons/tally-icon-192.png", sizes: "192x192", purpose: "maskable" },
      { src: "/icons/tally-icon-512.png", sizes: "512x512", purpose: "maskable" }
    ]
  );
});
