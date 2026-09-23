import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { EditPlan } from "./contract";

type Graphic = EditPlan["overlays"][number];

/** Deterministic visual presets, shared by the Player and MP4 renderer. */
export function MotionGraphic({ overlay, profile }: {
  overlay: Graphic;
  profile: EditPlan["profile"];
}) {
  const f = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const m = overlay.motion!;
  const length = overlay.end - overlay.start;
  const entrance = spring({ fps, frame: Math.min(f, m.enterFrames), durationInFrames: m.enterFrames,
    config: { damping: 18, stiffness: 170, mass: 0.8 } });
  const exit = interpolate(f, [length - m.exitFrames, length], [1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const progress = Math.min(1, Math.max(0, entrance));
  const fontSize = Math.round(height * (m.preset === "stat-counter" ? 0.042 : 0.03));
  const anchor: React.CSSProperties = {
    position: "absolute", left: `${overlay.x * 100}%`, top: `${overlay.y * 100}%`,
    width: `${overlay.scale * 100}%`,
    transform: `translate(-50%, ${Math.round((1 - progress) * 35)}px) scale(${(0.94 + progress * 0.06).toFixed(3)})`,
    opacity: progress * exit,
    fontFamily: profile.fontFamily,
    color: profile.captionColor,
    pointerEvents: "none",
  };
  const bar: React.CSSProperties = {
    background: profile.accentColor,
    width: `${Math.round(progress * 100)}%`,
    height: Math.max(3, Math.round(height * 0.003)),
    borderRadius: 20,
    marginTop: 10,
  };
  if (m.preset === "kinetic-title") return (
    <div style={{ ...anchor, fontSize, fontWeight: 800, textAlign: "center", textShadow: "0 2px 12px #000" }}>
      <div style={{ padding: "14px 18px", borderRadius: 12, background: "rgba(0,0,0,.72)" }}>
        {overlay.text}
        <div style={bar} />
      </div>
    </div>
  );
  if (m.preset === "callout") return (
    <div style={{ ...anchor, fontSize, fontWeight: 700, padding: "16px 20px", borderLeft: `6px solid ${profile.accentColor}`,
      background: "rgba(0,0,0,.77)", borderRadius: 10, boxSizing: "border-box" }}>
      {overlay.text}
      <div style={bar} />
    </div>
  );
  const value = m.value ?? 0;
  const number = Math.round(value * progress).toLocaleString("es-ES");
  return (
    <div style={{ ...anchor, textAlign: "center", padding: "18px 20px", boxSizing: "border-box",
      background: "rgba(0,0,0,.78)", borderRadius: 14, border: `2px solid ${profile.accentColor}` }}>
      <strong style={{ display: "block", fontSize: fontSize * 1.8, lineHeight: 1.05 }}>{number}{m.suffix}</strong>
      <span style={{ fontSize: fontSize * 0.7 }}>{overlay.text}</span>
    </div>
  );
}
