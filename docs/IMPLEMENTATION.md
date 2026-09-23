# Vanta Director — implementation and verification

## Status

Working local technical prototype on `feature/agentic-video-editor-mvp`, forked from `itsjwill/vanta` at `350b053ee18fb856a87516cfbfd1ad2295c26a73`. The full AI MVP acceptance gate is NOT complete: no API credentials or real raw footage were supplied. Live ASR/Director calls and subjective editorial quality remain unverified. This is not a deployed SaaS.

## Architecture implemented

`Browser → local Express API → SQLite project/job/event store → single worker → FFmpeg perception → provider decision → EditPlan validation → shared Remotion composition → preview / MP4`

- `src/agentic/contract.ts`: strict Zod EditPlan v1.0 plus semantic validation, source bounds, global IDs and timeline compiler. Schema rejects unknown fields and arbitrary URLs.
- `src/agentic/planner.ts`: explicitly non-AI silence-based rough cut, preserving breathing margins and known words. This never impersonates an AI Director.
- `server/media.ts`: upload inspection, container signatures, limits, FFprobe metadata, FFmpeg proxy/audio/silence/scene detection, six sampled frames, cached ASR adapter.
- `server/director.ts`: OpenAI Responses and Anthropic Messages adapters, JSON-schema structured operations, multimodal input (sampled images plus transcription), atomic incremental application. Model IDs are environment configuration, not architectural dependencies.
- `src/agentic/Composition.tsx`: one composition for preview/export, source trims/speed, crop via object-fit/object-position, zoom, basic color, captions, black fades, text/image/video overlays, graphics, music/SFX, caption-timed ducking. Uses Vanta's caption CSS/active-word helpers and linear `animateShape`.
- `server/db.ts`, `worker.ts`: persistent SQLite queue/events/revisions; one active job per project; independent interactive API and worker; retry UI, analysis/transcript caches, automatic-edit checkpoint before rendering.
- `web/`: React workspace with projects, upload/playback, Player, visible tracks, clip inspector, split, undo/redo (current browser session), profile controls, captions and plan JSON editing, AI chat/history, processing status, export/download. Complex timeline edits use validated JSON; no drag/resize interface is claimed.

## EditPlan v1.0

Sources contain ONLY asset IDs, kind and duration; renderer resolves IDs against project-owned assets. AI cannot specify an asset URL. All frame fields use the composition's 30-fps time base, even when input frame rate differs. Source ranges are half-open `[inFrame,outFrame)`. Clip order determines sequential output position; duration is `round((outFrame-inFrame)/speed)`. Captions and overlay/audio ranges are output frames. Word times are seconds in output time after remapping. Source timestamps originate in perception.

`clips[]`: ID, source, source in/out (trims/cuts), speed, zoom, normalized x/y reframing, voice volume, transition, transition frames, brightness, contrast, saturation, confidence, reason.

`removed[]`: source in/out, reason and confidence; cannot overlap kept footage.

`captions[]`: timed words, output range, confidence and reason. Manual caption corrections are possible through EditPlan JSON. A later timing-changing AI instruction remaps from the source transcript, so source transcript edits are needed for lasting corrections.

`overlays[]`: title, lower-third, stat, image or broll; output range, scale, position, existing source reference when needed. Motion graphics use a deterministic eight-frame entrance.

`audio[]`: music or SFX, range, existing source, level, optional ducking. Music loops; SFX is source-duration bounded. Ducking follows caption speech windows with a short envelope; loudness mastering/true-peak limiting is not implemented.

`profile`: configurable editorial preferences, font enum, colors, safe area, caption word count, transition preference, silence threshold, B-roll policy and optional logo asset. The FullMúsculo profile is a neutral, explicitly unverified draft: no official branding was invented. Some preferences guide the Director; changing them does not automatically re-run perception or restyle existing text.

`aspect`: 16:9 or 9:16. `render`: H.264, draft (half resolution) or final (1080p). No arbitrary shaders, JavaScript, CSS or shell commands accepted.

Exported schemas: `docs/edit-plan.schema.json`, `docs/director-decision.schema.json`.

## Providers and current limits

- OpenAI Whisper `whisper-1`: documented word timestamps via `verbose_json`; 24 MB extracted WAV limit in this prototype. No chunking yet. API does not supply per-word confidence here; the stored 0.8 is an internal estimate, not a calibrated model score.
- OpenAI Director: Responses endpoint, JSON schema, six JPG samples and transcript. `OPENAI_DIRECTOR_MODEL` must identify an accessible model supporting those features.
- Anthropic Director: Messages endpoint, `output_config.format` JSON schema, same image/transcript context. `ANTHROPIC_DIRECTOR_MODEL` must identify a compatible model.
- No Astra, Sol or Opus API ID is guessed. Missing configuration produces an explicit disabled state/error. HTTP errors/refusals/incomplete or invalid output cannot mutate the timeline.
- No raw-video native model input, diarization, face tracking, local ASR weights, generative assets, automatic B-roll sourcing, multi-camera or automatic Shorts extraction yet. Images/B-roll/audio can be uploaded manually.

Provider documentation consulted 2026-09-23:
https://developers.openai.com/api/docs/guides/structured-outputs
https://developers.openai.com/api/docs/guides/images-vision
https://developers.openai.com/api/docs/guides/speech-to-text
https://platform.claude.com/docs/en/build-with-claude/structured-outputs

## Verification evidence

- Upstream typecheck and bundle passed; baseline 30-frame MP4 rendered before implementation.
- Editor typecheck and Vite production build passed. Non-blocking warnings: Remotion's `use client` directive and approximately 524 KB JS chunk.
- Fourteen contract tests passed: silence margins, speech protection, caption mapping and speed, unknown fields/URLs, invalid numeric/source ranges, duplicate IDs, removed/kept overlap, audio/overlay bounds, atomic invalid decisions, incremental preservation, split duration, transitions, all-silence reviewability.
- API/worker smoke passed with an eight-second synthetic test pattern, known two-second silence, imported synthetic word timestamps and generated test tones. Upload → proxy/analysis → silence cuts → captions → manual punch-in/fade/graphic/music → revision/invalid-plan rejection → MP4 in both formats.
- Both outputs have exactly 188 video frames, 30 fps, H.264 + AAC. Draft output dimensions: 960×540 and 540×960. Video duration: 6.266667 s. AAC/container tail: 6.314667 s; expected encoder padding, not additional video frames.
- A rendered vertical frame was visually inspected: graphic/captions present and within frame.
- `npm audit`: zero vulnerabilities after aligning all Remotion packages to 4.0.527. This is a dependency snapshot, not a full security certification.
- Browser GUI inspection was blocked because the session browser could not open the local server. Interactive GUI behavior remains to be verified in the intended runtime; API tests are not a substitute for that gate.
- Additional API smoke passed: uploaded PNG overlay, rejected a playlist disguised as MP4, rejected foreign Origin, and asserted exact video frame counts / H.264 / AAC in both exports.
- Automatic edit + render + incremental follow-up passed with an explicitly MOCKED OpenAI HTTP transport and real FFmpeg/Remotion processing. This verifies orchestration and request/response handling, not live provider capability or editorial quality. Run `npm run test:auto-fixture`. Product startup never loads this fixture.
- Live AI transcription/directing, one-instruction autoedit against a real provider and real-video quality review remain pending. Do not label these passed based on the presence of adapters.

## Persistence, feedback and recovery

Projects, assets, renders and events stay under DATA_DIR. Perception and ASR caches are keyed by media SHA256 and pipeline version. Manual saves store before/after EditPlans; AI proposals store before/after plans, operations, instruction and provider. `/api/projects/:id/events` exposes the audit trail. No fine-tuning or learned style is claimed.

The worker uses an exclusive lock file and recovers running jobs to queued on restart. After an unclean crash, verify that no worker is alive before removing the stale `DATA_DIR/worker.lock`, then restart. Render retries reuse an automatic-edit checkpoint only if the project revision matches; changed projects require a new instruction. Jobs are explicitly reattemptable; automatic retry loops and distributed worker leases are future work.

## Security and production boundaries

Local, single-user only: binds loopback and checks Host/Origin; no multiuser authentication. Do not expose behind a public reverse proxy without implementing authentication, ownership checks and rate limits. Provider keys exist only in environment. Original unsafe wrappers remain in the upstream tree for provenance but are never imported by product entrypoints.

Media limits: 500 MB, 60 minutes, maximum dimension 7680; still-image upload limit 20 MB. Format signature checked before FFprobe; playlists rejected, external FFmpeg protocols disabled, subprocesses have time/output bounds. Native media decoding still needs container/resource isolation for a hosted product. Local storage quotas/retention and antivirus scanning are not implemented. Heavy image input and long render resource limits need further tuning. Originals remain private local files; no upload to an asset-generation service occurs.

Render media is served on a temporary loopback server using an unguessable per-render token and a project manifest. The AI cannot change provider hosts or asset paths. No generated code runs.

Licenses: retain Vanta MIT attribution; Remotion terms apply separately and need company eligibility/licensing confirmation before commercial deployment. System FFmpeg in this environment includes libx264; distribution of FFmpeg binaries needs its own build/license review. No model-weight or music licenses are assumed. Test tones and test patterns are generated, not music licensed for publication.

## Immediate acceptance gates and roadmap

1. Run in the intended local/server environment with a compatible Chromium, configure a real provider and supply representative raw footage plus licensed music.
2. Verify upload/player/inspector/undo/redo and both exports in a real browser. Run one-instruction autoedit, then “Haz el primer minuto más dinámico y reduce las transiciones”; inspect incremental decisions and meaning preservation.
3. Validate FullMúsculo branding/style and save a profile using real edited references/feedback.
4. Add source-aligned caption correction preservation, ASR chunking, finer visual sampling/face tracks, audio loudness normalization and smoother transitions.
5. Add a fully graphical drag/trim timeline, multiuser auth/ownership, isolated workers, resource quotas, managed object storage, cancellation, progress heartbeats, retention and backups.
6. Add allowlisted generative asset providers, rights metadata, automatic B-roll/Shorts and learned preference evaluation only after the core gate passes.

### First real-media ingestion check — 2026-09-23

A user-supplied phone recording passed upload, hashing, proxy generation and
technical perception. This exposed two metadata defects: display rotation was
not reflected in the reported dimensions, and a measured 0 dBFS peak was being
converted to `null`. Both are fixed with regression tests (16 tests total).
Perception cache version is now v2 so previous incorrect peak values are not
reused. Build and type checking pass.

The actual footage and project data remain private and are not committed.
Speech transcription and semantic editing of this recording are still blocked:
no API credentials are configured, and an experimental local ASR run was stopped
by automatic security review because of unrelated telemetry. This does not
constitute a successful live AI end-to-end test.
