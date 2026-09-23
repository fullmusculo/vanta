# Vanta Director

A local agentic video-editing prototype built **as a fork of [itsjwill/vanta](https://github.com/itsjwill/vanta)**. Vanta's original MIT attribution and source components are preserved. This branch adds a validated editorial contract, persistent perception/render jobs, provider adapters and an inspectable React editor.

**Status:** the deterministic media pipeline is tested. The complete AI MVP is pending live provider credentials, real-footage evaluation and interactive browser verification. Not a production SaaS.

## Run

Requirements: Linux/macOS environment with **Node >=22.13**, npm, **ffmpeg + ffprobe**, and a compatible Chrome/Chromium for Remotion. Dependencies include native renderer binaries; architecture must be supported by Remotion.

```sh
git clone https://github.com/fullmusculo/vanta.git
cd vanta
git switch feature/agentic-video-editor-mvp
npm ci
cp .env.example .env
npm run editor:build
npm run editor:api
```

In a second terminal in the same directory:

```sh
npm run editor:worker
```

Open **http://127.0.0.1:4317**. Keep API and worker running on the same host/data directory. Set `CHROME_PATH` to a compatible installed Chromium if automatic browser download is unavailable. `.env` and `.data` are ignored by Git.

For AI: configure `OPENAI_API_KEY` (word transcription) and an accessible `OPENAI_DIRECTOR_MODEL`, or `ANTHROPIC_API_KEY` plus `ANTHROPIC_DIRECTOR_MODEL` for directing. The Anthropic route still uses OpenAI transcription unless a timed transcript is imported. Keys stay on the server. No model name or successful API connection is assumed.

**ChatGPT subscription workflow:** You can use ChatGPT to propose edits interactively without configuring an API key. After analyzing a project, open the Director panel and download its context JSON. Attach that JSON to your ChatGPT conversation with the instruction and ask for a JSON object matching [`docs/director-decision.schema.json`](docs/director-decision.schema.json). For visual editing, also attach the footage or relevant stills; the JSON only contains technical measurements and any available transcript. Paste the object into **Decisión JSON de ChatGPT** and choose **Validar y aplicar al proyecto**. The backend validates every operation, records the prior plan and proposed change, checks the revision and updates the existing timeline; invalid output is rejected. You may also ask a ChatGPT Work/Codex agent with access to the local project to perform this step. Captions still require a timed transcript. This is an interactive workflow in ChatGPT and does not turn a ChatGPT subscription into API credentials or enable unattended autoediting from the web UI.

1. Import MP4/MOV/WebM. The primary source must have a video stream.
2. Use **Editar y renderizar automáticamente** with your instruction when providers are configured, or **Analizar material** to inspect a technical silence cut.
3. Review/edit clips, captions, graphics and audio. Import music/images/B-roll as needed. Unknown brand styles remain neutral.
4. Save edits or send a follow-up instruction to modify the current plan.
5. Select 16:9 or 9:16 and export draft or final MP4.

Without credentials you can use the technical rough cut and import a transcript JSON array:

```json
[{ "word": "Hola", "start": 0.2, "end": 0.6, "confidence": 1 }]
```

Times are source seconds. This is **not** presented as automatic transcription.

## Verify

```sh
npm run typecheck
npm test
npm run editor:build
npm audit
# Synthetic API/worker/render test; Linux/macOS, uses /tmp and port 4317:
npm run test:smoke
# Automatic orchestration with explicitly MOCKED provider transport:
npm run test:auto-fixture
```

`test:smoke` generates its own test pattern and tones, then verifies perception, caption import, manual editing, revision protection and both export formats. It does not call a real AI provider or replace a browser interaction test.

- [Implementation, architecture, schema and evidence](docs/IMPLEMENTATION.md)
- [Upstream baseline audit](docs/BASELINE.md)
- [EditPlan JSON schema](docs/edit-plan.schema.json)
- [Director operation schema](docs/director-decision.schema.json)

Core flow: **raw media → perception → Director operations → validated EditPlan → shared preview/render → editable revision → MP4**.

## Upstream relationship and licenses

Origin: `fullmusculo/vanta`. Upstream: `itsjwill/vanta`. Baseline: `350b053ee18fb856a87516cfbfd1ad2295c26a73`. Work lives on `feature/agentic-video-editor-mvp`; no changes are pushed to upstream or merged to main.

Product reuses Remotion, Vanta caption helpers and its linear shape animation helper. Conceptual editor/timeline conversion and unsafe external-service wrappers are replaced in the new entrypoints; original modules remain only for provenance/showcase. `npm start` is the original Vanta showcase, not the new editor.

Vanta MIT does **not** license every dependency or model weight. Remotion has [separate commercial licensing](https://www.remotion.dev/docs/license/pricing). Review company eligibility and FFmpeg build licensing before a commercial deployment. Use only media/music you are entitled to process.
