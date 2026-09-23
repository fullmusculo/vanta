import React from "react";
import { Composition, registerRoot } from "remotion";
import { EditorComposition } from "./Composition";
import { duration, validatePlan, EditPlan } from "./contract";
registerRoot(() => (
  <Composition
    id="AgenticEditor"
    component={EditorComposition}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={30}
    defaultProps={{ plan: null as unknown as EditPlan, media: {} }}
    calculateMetadata={({ props }) => {
      const p = validatePlan(props.plan);
      return {
        durationInFrames: duration(p),
        fps: p.fps,
        width: p.aspect === "16:9" ? 1920 : 1080,
        height: p.aspect === "16:9" ? 1080 : 1920,
      };
    }}
  />
));
