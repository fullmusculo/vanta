import test from "node:test";
import assert from "node:assert/strict";
import { displayDimensions, volumeFromLog } from "../server/media-metadata";

test("full-scale peaks remain distinguishable from missing measurements", () => {
  const log = "mean_volume: -16.1 dB\nmax_volume: 0.0 dB\n";
  assert.equal(volumeFromLog(log, "mean"), -16.1);
  assert.equal(volumeFromLog(log, "max"), 0);
  assert.equal(volumeFromLog("", "max"), null);
});

test("phone display rotation determines presentation dimensions", () => {
  const stream = { width: 1920, height: 1080 };
  for (const rotation of [90, -90, 270]) {
    assert.deepEqual(
      displayDimensions({ ...stream, side_data_list: [{ rotation }] }),
      { width: 1080, height: 1920 },
    );
  }
  assert.deepEqual(displayDimensions({ ...stream, tags: { rotate: "90" } }), {
    width: 1080,
    height: 1920,
  });
  assert.deepEqual(
    displayDimensions({ ...stream, side_data_list: [{ rotation: 180 }] }),
    stream,
  );
  assert.deepEqual(displayDimensions(stream), stream);
});
