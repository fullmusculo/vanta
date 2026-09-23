import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import { EditPlan, timeline } from "./contract";
import {
  getActiveWordIndex,
  getCaptionStyleCSS,
} from "../integrations/animated-captions";
import { animateShape } from "../integrations/motion-graphics";
export type EditorProps = { plan: EditPlan; media: Record<string, string> };
function Shot({
  clip,
  src,
}: {
  clip: ReturnType<typeof timeline>[number];
  src: string;
}) {
  const f = useCurrentFrame(),
    d = clip.end - clip.start,
    n = clip.transitionFrames;
  const opacity =
    clip.transition === "fade-black" && n > 0
      ? interpolate(f, [0, n, d - n, d], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;
  return (
    <AbsoluteFill style={{ overflow: "hidden", opacity }}>
      <OffthreadVideo
        src={src}
        startFrom={clip.inFrame}
        playbackRate={clip.speed}
        volume={clip.volume}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: `${clip.x * 100}% ${clip.y * 100}%`,
          transform: `scale(${clip.zoom})`,
          transformOrigin: `${clip.x * 100}% ${clip.y * 100}%`,
          filter: `brightness(${clip.brightness}) contrast(${clip.contrast}) saturate(${clip.saturation})`,
        }}
      />
    </AbsoluteFill>
  );
}
function Graphic({
  overlay,
  media,
  plan,
}: {
  overlay: EditPlan["overlays"][number];
  media: Record<string, string>;
  plan: EditPlan;
}) {
  const f = useCurrentFrame();
  const props = animateShape("rect", {
    from: { opacity: 0, y: 24 },
    to: { opacity: 1, y: 0 },
    duration: 8,
  }).getPropsAtFrame(f);
  const style: React.CSSProperties = {
    position: "absolute",
    left: `${overlay.x * 100}%`,
    top: `${overlay.y * 100}%`,
    width: `${overlay.scale * 100}%`,
    transform: `translate(-50%, ${props.y}px)`,
    opacity: props.opacity,
    fontFamily: plan.profile.fontFamily,
  };
  if (overlay.type === "image")
    return <Img src={media[overlay.sourceId!]} style={style} />;
  if (overlay.type === "broll")
    return (
      <OffthreadVideo muted src={media[overlay.sourceId!]} style={style} />
    );
  return (
    <div
      style={{
        ...style,
        background: "rgba(0,0,0,.8)",
        borderLeft: `8px solid ${plan.profile.accentColor}`,
        padding: 24,
        color: plan.profile.captionColor,
        fontSize: overlay.type === "stat" ? 86 : 44,
        fontWeight: 700,
        borderRadius: 12,
      }}
    >
      {overlay.text}
    </div>
  );
}
export function EditorComposition({ plan, media }: EditorProps) {
  const frame = useCurrentFrame(),
    { height } = useVideoConfig(),
    captions = plan.captions.filter((c) => frame >= c.start && frame < c.end);
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {timeline(plan).map((c) => (
        <Sequence key={c.id} from={c.start} durationInFrames={c.end - c.start}>
          <Shot clip={c} src={media[c.sourceId]} />
        </Sequence>
      ))}
      {plan.overlays.map((o) => (
        <Sequence key={o.id} from={o.start} durationInFrames={o.end - o.start}>
          <Graphic overlay={o} media={media} plan={plan} />
        </Sequence>
      ))}
      {captions.map((c) => {
        const active = getActiveWordIndex(c.words, frame / 30);
        return (
          <div
            key={c.id}
            style={{
              position: "absolute",
              bottom: `${plan.profile.safeArea * 100}%`,
              left: "8%",
              width: "84%",
              textAlign: "center",
              fontFamily: plan.profile.fontFamily,
            }}
          >
            {c.words.map((w, i) => (
              <span
                key={i}
                style={{
                  ...getCaptionStyleCSS(
                    {
                      style: "highlight",
                      fontFamily: plan.profile.fontFamily,
                      fontSize: Math.round(height * 0.039),
                      color: plan.profile.captionColor,
                      activeColor: plan.profile.accentColor,
                    },
                    i === active,
                  ),
                  padding: "5px 9px",
                  backgroundColor:
                    i === active ? "rgba(0,0,0,.9)" : "rgba(0,0,0,.6)",
                  color: plan.profile.captionColor,
                }}
              >
                {w.word}{" "}
              </span>
            ))}
          </div>
        );
      })}
      {plan.profile.logoAssetId ? (
        <Img
          src={media[plan.profile.logoAssetId]}
          style={{ position: "absolute", top: "8%", right: "8%", width: "12%" }}
        />
      ) : null}
      {plan.audio.map((a) => (
        <Sequence key={a.id} from={a.start} durationInFrames={a.end - a.start}>
          <Audio
            src={media[a.sourceId]}
            loop={a.role === "music"}
            volume={(f) => {
              const global = f + a.start,
                fade = Math.min(1, f / 15, (a.end - global) / 15);
              let speech = 0;
              for (const c of plan.captions) {
                if (global >= c.start - 6 && global <= c.end + 6)
                  speech = Math.max(
                    speech,
                    Math.min(
                      1,
                      (global - c.start + 6) / 6,
                      (c.end + 6 - global) / 6,
                    ),
                  );
              }
              return (
                a.volume *
                Math.max(0, fade) *
                (a.ducking ? 1 - 0.75 * speech : 1)
              );
            }}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
