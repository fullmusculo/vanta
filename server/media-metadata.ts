// Preserve a measured 0 dBFS peak; it is not a missing measurement.
export function volumeFromLog(
  log: string,
  kind: "mean" | "max",
): number | null {
  const value = log.match(
    new RegExp(`${kind}_volume: (-?\\d+(?:\\.\\d+)?) dB`),
  )?.[1];
  return value === undefined ? null : Number(value);
}

export function displayDimensions(video: any) {
  if (!video) return { width: undefined, height: undefined };
  const raw =
    video.side_data_list?.find((s: any) => Number.isFinite(s.rotation))
      ?.rotation ?? Number(video.tags?.rotate || 0);
  const rotation = ((raw % 360) + 360) % 360;
  const swap = rotation === 90 || rotation === 270;
  return {
    width: swap ? video.height : video.width,
    height: swap ? video.width : video.height,
  };
}
