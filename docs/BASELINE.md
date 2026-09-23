# Baseline — 2026-09-23

Origin: https://github.com/fullmusculo/vanta.git
Upstream: https://github.com/itsjwill/vanta.git (push disabled locally)
Default branch: main
Work branch: feature/agentic-video-editor-mvp
Baseline: 350b053ee18fb856a87516cfbfd1ad2295c26a73

Verified before implementation: npm ci --ignore-scripts, tsc --noEmit, Remotion bundle, 30-frame VantaShowcase H.264 render at quarter resolution. The managed runtime required Chromium from @sparticuz/chromium and an external runtime-only fallback for unsupported os.networkInterfaces(). Neither changed upstream source. npm test: no test script. npm audit: 17 affected package entries (12 high / 3 moderate / 2 low), including transitive propagation.

Actual code: editor is a data initializer, not UI. Timeline operations exist but sequence conversion drops trims. Caption helpers and linear shape interpolation are reusable. ASR/voice/avatar/music/video wrappers assume external HTTP services without implementation or response/host validation. Background removal throws. Avatar wrapper still mentions retired integrations despite README claims. No ingestion, jobs, Director or EditPlan exists.

Reuse: Remotion registration/render, caption style/active word helpers, linear shape animation. Replace: unsafe wrappers, incomplete timeline-to-render conversion, conceptual editor. Original modules retained for provenance but excluded from the product entrypoints.

License: Vanta MIT attribution retained. Remotion has separate commercial terms (https://www.remotion.dev/docs/license/pricing); company eligibility not established. Suggested IMG.LY removal is AGPLv3 and is not installed or used. No model weights or media licenses are implied by Vanta MIT. Resolve commercial deployment eligibility before launch.
