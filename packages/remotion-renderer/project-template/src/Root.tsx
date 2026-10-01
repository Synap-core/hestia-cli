/**
 * A minimal, WORKING Remotion project.
 *
 * The installer seeds this at `/opt/remotion` so a fresh `eve add remotion` has a
 * composition it can actually render on the first try — an install that can list
 * nothing is indistinguishable from a broken one.
 *
 * The operator replaces this directory (or points `REMOTION_PROJECT_PATH` at their
 * own project). Nothing here is load-bearing for the renderer service: the service
 * only ever calls `bundle()` + `getCompositions()` against whatever path it is given.
 */

import React from "react";
import { Composition } from "remotion";

/** 3 seconds at 30fps. */
const HELLO_DURATION = 90;

const Hello: React.FC<{ title?: string; subtitle?: string }> = ({ title, subtitle }) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "#111",
      color: "#fff",
      fontFamily: "system-ui, sans-serif",
    }}
  >
    <div style={{ fontSize: 96, fontWeight: 700 }}>{title ?? "Hello from Remotion"}</div>
    <div style={{ fontSize: 40, opacity: 0.7, marginTop: 24 }}>{subtitle ?? "rendered on your pod"}</div>
  </div>
);

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Hello"
      component={Hello}
      durationInFrames={HELLO_DURATION}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ title: "Hello from Remotion", subtitle: "rendered on your pod" }}
    />
  </>
);
