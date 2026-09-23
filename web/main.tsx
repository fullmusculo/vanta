import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Player, PlayerRef } from "@remotion/player";
import { EditorComposition } from "../src/agentic/Composition";
import {
  EditPlan,
  validatePlan,
  duration,
  timeline,
  remapCaptions,
} from "../src/agentic/contract";
import "./style.css";
const api = async (url: string, options?: RequestInit) => {
  const r = await fetch("/api" + url, options);
  const body = await r.json();
  if (!r.ok) throw Error(body.error || "Request failed");
  return body;
};
const json = (method: string, body: unknown) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const seconds = (f: number) => (f / 30).toFixed(1) + "s";
function App() {
  const [projects, setProjects] = useState<any[]>([]),
    [p, setP] = useState<any>(null),
    [plan, setPlan] = useState<EditPlan | null>(null),
    [config, setConfig] = useState<any>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [selection, setSelection] = useState(""),
    [instruction, setInstruction] = useState(
      "Edita este vídeo con un ritmo claro y natural. Elimina repeticiones, destaca las ideas principales y conserva el sentido del contenido.",
    ),
    [provider, setProvider] = useState("openai"),
    [chatgptDecision, setChatgptDecision] = useState(""),
    [past, setPast] = useState<EditPlan[]>([]),
    [future, setFuture] = useState<EditPlan[]>([]),
    [tab, setTab] = useState("director");
  const player = useRef<PlayerRef>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const busy = !!p?.jobs?.some((j: any) =>
      ["queued", "running"].includes(j.status),
    ),
    dirty = !!plan && JSON.stringify(plan) !== JSON.stringify(p?.plan);
  const locked = loading || busy;
  const attempt = async (fn: () => Promise<void>) => {
    setError("");
    setLoading(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const refreshList = async () => setProjects(await api("/projects"));
  useEffect(() => {
    Promise.all([api("/projects"), api("/config")])
      .then(([list, c]) => {
        setProjects(list);
        setConfig(c);
      })
      .catch((e) => setError(e.message));
  }, []);
  const open = async (id: string) => {
    const next = await api("/projects/" + id);
    setP(next);
    setPlan(next.plan);
    setPast([]);
    setFuture([]);
    setSelection("");
  };
  useEffect(() => {
    if (!p?.id || !busy) return;
    let live = true;
    const id = setInterval(
      () =>
        api("/projects/" + p.id)
          .then((next) => {
            if (live) {
              setP(next);
              if (next.revision !== p.revision) {
                setPlan(next.plan);
                setPast([]);
                setFuture([]);
              }
            }
          })
          .catch((e) => {
            if (live) setError(e.message);
          }),
      1200,
    );
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [p?.id, p?.revision, busy]);
  const change = (next: EditPlan) => {
    try {
      const valid = validatePlan(next, plan?.sources);
      if (plan) setPast([...past.slice(-49), plan]);
      setFuture([]);
      setPlan(valid);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const save = async () => {
    if (!p || !plan) return;
    const next = await api(
      `/projects/${p.id}/plan`,
      json("PUT", { plan, revision: p.revision }),
    );
    setP({ ...next, jobs: p.jobs });
  };
  const job = async (type: string, extra = {}) => {
    if (dirty) await save();
    await api(`/projects/${p.id}/jobs`, json("POST", { type, ...extra }));
    const next = await api("/projects/" + p.id);
    setP(next);
  };
  const exportChatGPTContext = () => {
    if (!p || !plan) return;
    const payload = {
      projectId: p.id,
      revision: p.revision,
      instruction,
      analysis: {
        duration: p.analysis.duration,
        transcriptStatus: p.analysis.transcriptStatus,
        words: p.analysis.words,
        silences: p.analysis.silences,
        sceneChanges: p.analysis.sceneChanges,
      },
      plan,
      assets: p.assets.map((a: any) => ({
        id: a.id,
        kind: a.kind,
        name: a.name,
        duration: a.duration,
      })),
      responseContract:
        "Return only {summary:string,operations:array} following docs/director-decision.schema.json. Never infer spoken words from silence data. Use only existing IDs and ranges within the plan.",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `chatgpt-context-${p.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const upload = async (file: File) =>
    attempt(async () => {
      const data = new FormData();
      data.set("file", file);
      const created = await api("/projects", { method: "POST", body: data });
      await refreshList();
      await open(created.id);
    });
  const selected = plan?.clips.find((c) => c.id === selection);
  const total = plan ? duration(plan) : 0;
  const media = p
    ? Object.fromEntries(
        p.assets.map((a: any) => [
          a.id,
          a.id === p.primary && p.analysis
            ? `/api/projects/${p.id}/proxy`
            : `/api/projects/${p.id}/assets/${a.id}`,
        ]),
      )
    : {};
  const mutateClip = (key: string, value: unknown) => {
    if (!plan || !selected) return;
    const next = structuredClone(plan);
    (next.clips.find((c) => c.id === selection) as any)[key] = value;
    next.captions = remapCaptions(next, p.analysis.words, p.primary);
    change(next);
  };
  const addAudio = async (file: File) => {
    const form = new FormData();
    form.set("file", file);
    const next = await api(`/projects/${p.id}/assets`, {
      method: "POST",
      body: form,
    });
    setP({ ...next, jobs: p.jobs });
    setPlan(next.plan);
    setPast([]);
    setFuture([]);
  };
  return (
    <div className="app">
      <header>
        <a className="brand" href="/">
          vanta<span>DIRECTOR</span>
        </a>
        <div className="header-center">
          <span className="status-dot" /> WORKSPACE LOCAL{" "}
          <span className="divider">/</span> {p?.name || "Nuevo proyecto"}
        </div>
        <button
          className="primary"
          disabled={!plan || locked}
          onClick={() => attempt(() => job("render"))}
        >
          ↗ Exportar MP4
        </button>
      </header>
      <aside className="sidebar">
        <div className="section-label">PROYECTOS</div>
        <button
          className="new-project"
          onClick={() => fileInput.current?.click()}
        >
          ＋ Importar vídeo
        </button>
        <input
          hidden
          ref={fileInput}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          onChange={(e) => {
            if (e.target.files?.[0]) void upload(e.target.files[0]);
            e.target.value = "";
          }}
        />
        {projects.map((item) => (
          <button
            className={"project " + (p?.id === item.id ? "active" : "")}
            key={item.id}
            disabled={locked}
            onClick={() => {
              if (dirty && !confirm("Hay cambios sin guardar. ¿Descartarlos?"))
                return;
              void attempt(() => open(item.id));
            }}
          >
            <span className="project-icon">▷</span>
            <span>
              {item.name}
              <small>Proyecto de vídeo</small>
            </span>
          </button>
        ))}
        <div className="sidebar-footer">
          <b>De bruto a historia.</b>
          <p>Percepción, decisiones y edición en una misma timeline.</p>
          <small>Basado en Vanta · FullMúsculo</small>
        </div>
      </aside>
      <main>
        {error ? (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setError("")}>×</button>
          </div>
        ) : null}
        {!p ? (
          <section className="welcome">
            <div className="eyebrow">TU SALA DE EDICIÓN</div>
            <h1>
              La historia empieza
              <br />
              con tu material.
            </h1>
            <p>
              Importa un vídeo. Revisa sus silencios y transcripción.
              <br />
              Dale una dirección y afina cada decisión.
            </p>
            <button
              className="primary big"
              onClick={() => fileInput.current?.click()}
            >
              ＋ Importar material bruto
            </button>
            <div className="format-pills">
              <span>16:9 · YouTube</span>
              <span>9:16 · Reels & Shorts</span>
              <span>MP4 · Hasta 500 MB</span>
            </div>
            <div className="flow-cards">
              {[
                "01 / Analizar",
                "02 / Dirigir",
                "03 / Afinar",
                "04 / Exportar",
              ].map((x) => (
                <div key={x}>{x}</div>
              ))}
            </div>
          </section>
        ) : (
          <>
            <div className="toolbar">
              <div>
                <span className="eyebrow">PROYECTO</span>
                <h2>{p.name}</h2>
              </div>
              <div className="row">
                <span className="badge">
                  {busy
                    ? "Procesando…"
                    : dirty
                      ? "Cambios sin guardar"
                      : "Guardado"}
                </span>
                {plan ? (
                  <select
                    aria-label="Formato"
                    value={plan.aspect}
                    disabled={locked}
                    onChange={(e) =>
                      change({ ...plan, aspect: e.target.value as any })
                    }
                  >
                    <option>16:9</option>
                    <option>9:16</option>
                  </select>
                ) : null}
              </div>
            </div>
            <div className="edit-grid">
              <section className="viewer-panel">
                <div className="panel-title">
                  <span>PREVIEW</span>
                  <span>
                    {plan ? `${plan.aspect} / 30 FPS` : "MATERIAL ORIGINAL"}
                  </span>
                </div>
                <div
                  className={
                    "viewer " + (plan?.aspect === "9:16" ? "vertical" : "")
                  }
                >
                  {plan ? (
                    <Player
                      ref={player}
                      component={EditorComposition}
                      inputProps={{ plan, media }}
                      durationInFrames={total}
                      compositionWidth={plan.aspect === "16:9" ? 1920 : 1080}
                      compositionHeight={plan.aspect === "16:9" ? 1080 : 1920}
                      fps={30}
                      controls
                      style={{ width: "100%", height: "100%" }}
                    />
                  ) : (
                    <video src={media[p.primary]} controls />
                  )}
                </div>
                <div className="viewer-footer">
                  <span>
                    {plan
                      ? `${seconds(total)} editados · ${plan.clips.length} clips`
                      : "Revisa el vídeo antes de analizar"}
                  </span>
                  <span>
                    {p.analysis
                      ? `${p.analysis.silences.length} silencios detectados`
                      : ""}
                  </span>
                </div>
              </section>
              <section className="right-panel">
                <nav className="tabs">
                  <button
                    className={tab === "director" ? "selected" : ""}
                    onClick={() => setTab("director")}
                  >
                    ✦ AI Director
                  </button>
                  <button
                    className={tab === "properties" ? "selected" : ""}
                    onClick={() => setTab("properties")}
                  >
                    Propiedades
                  </button>
                </nav>
                {tab === "director" ? (
                  <div className="panel-body">
                    <div className="director-intro">
                      <div className="director-icon">✦</div>
                      <h3>¿Qué historia quieres contar?</h3>
                      <p>
                        Las instrucciones modifican el proyecto actual. Cada
                        decisión queda registrada.
                      </p>
                    </div>
                    {!plan ? (
                      <>
                        <label>
                          Instrucción editorial
                          <textarea
                            value={instruction}
                            onChange={(e) => setInstruction(e.target.value)}
                            rows={4}
                          />
                        </label>
                        <label>
                          Proveedor
                          <select
                            value={provider}
                            onChange={(e) => setProvider(e.target.value)}
                          >
                            <option value="openai">OpenAI</option>
                            <option value="anthropic">Anthropic</option>
                          </select>
                        </label>
                        <button
                          className="primary full"
                          disabled={
                            locked ||
                            !config?.providers[provider] ||
                            !config?.transcription
                          }
                          onClick={() =>
                            attempt(() =>
                              job("autoedit", {
                                provider,
                                instruction,
                                aspect: "16:9",
                              }),
                            )
                          }
                        >
                          ✦ Editar y renderizar automáticamente
                        </button>
                        {!config?.providers[provider] ||
                        !config?.transcription ? (
                          <p className="muted">
                            Configura las credenciales del servidor para activar
                            edición automática y transcripción.
                          </p>
                        ) : null}
                        <p className="notice">
                          Primero crea un corte técnico. Elimina pausas largas
                          con márgenes de respiración.
                        </p>
                        <button
                          disabled={locked}
                          className="primary full"
                          onClick={() =>
                            attempt(() =>
                              job("analyze", {
                                aspect: "16:9",
                                transcribe: config?.transcription || false,
                              }),
                            )
                          }
                        >
                          Analizar material
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="metrics">
                          <div>
                            <strong>{p.analysis.words.length}</strong>
                            <span>palabras</span>
                          </div>
                          <div>
                            <strong>{plan.removed.length}</strong>
                            <span>descartes</span>
                          </div>
                          <div>
                            <strong>{plan.captions.length}</strong>
                            <span>captions</span>
                          </div>
                        </div>
                        {!p.analysis.words.length ? (
                          <div className="notice">
                            Falta transcripción.{" "}
                            {config?.transcription ? (
                              <button
                                disabled={locked}
                                onClick={() => attempt(() => job("transcribe"))}
                              >
                                Transcribir audio
                              </button>
                            ) : (
                              <span>
                                Configura OpenAI en el servidor o importa
                                palabras con timestamps.
                              </span>
                            )}
                            <label className="file-label">
                              Importar transcripción JSON
                              <input
                                type="file"
                                accept=".json"
                                disabled={locked || dirty}
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f)
                                    void attempt(async () => {
                                      const words = JSON.parse(await f.text());
                                      await api(
                                        `/projects/${p.id}/transcript`,
                                        json("PUT", {
                                          words,
                                          revision: p.revision,
                                        }),
                                      );
                                      await open(p.id);
                                    });
                                }}
                              />
                            </label>
                          </div>
                        ) : null}
                        <label>
                          Proveedor
                          <select
                            value={provider}
                            onChange={(e) => setProvider(e.target.value)}
                          >
                            <option value="openai">
                              OpenAI{" "}
                              {config?.providers.openai
                                ? ""
                                : "· sin configurar"}
                            </option>
                            <option value="anthropic">
                              Anthropic{" "}
                              {config?.providers.anthropic
                                ? ""
                                : "· sin configurar"}
                            </option>
                          </select>
                        </label>
                        <textarea
                          aria-label="Instrucción editorial"
                          value={instruction}
                          onChange={(e) => setInstruction(e.target.value)}
                          rows={5}
                        />
                        <button
                          className="primary full"
                          disabled={
                            locked ||
                            !p.analysis.words.length ||
                            !config?.providers[provider]
                          }
                          onClick={() =>
                            attempt(() =>
                              job("director", { provider, instruction }),
                            )
                          }
                        >
                          ✦ Aplicar dirección
                        </button>
                        <div className="suggestions">
                          <button
                            onClick={() =>
                              setInstruction(
                                "Haz el primer minuto más dinámico y reduce las transiciones. Conserva el resto de la edición.",
                              )
                            }
                          >
                            Primer minuto más dinámico
                          </button>
                          <button
                            onClick={() =>
                              setInstruction(
                                "Reduce los cortes y usa un estilo más sobrio. Mantén los textos actuales.",
                              )
                            }
                          >
                            Edición más sobria
                          </button>
                        </div>
                        <small className="muted">
                          {!config?.providers[provider]
                            ? "AI Director pendiente de credenciales y modelo del servidor."
                            : "El Director recibe transcripción y seis fotogramas del material."}
                        </small>
                        <div className="notice">
                          <b>Dirección asistida en ChatGPT</b>
                          <p>
                            Exporta el contexto, pide una decisión estructurada
                            en ChatGPT y pega aquí el JSON. El editor valida
                            cada operación, conserva el proyecto e indica qué
                            cambió.
                            {p.analysis.words.length === 0
                              ? " Sin transcripción, evita decisiones sobre el contenido hablado."
                              : ""}
                          </p>
                          <button
                            disabled={locked || dirty}
                            onClick={exportChatGPTContext}
                          >
                            Descargar contexto para ChatGPT
                          </button>
                          <label>
                            Decisión JSON de ChatGPT
                            <textarea
                              value={chatgptDecision}
                              onChange={(e) =>
                                setChatgptDecision(e.target.value)
                              }
                              rows={4}
                              placeholder='{"summary":"...","operations":[]}'
                            />
                          </label>
                          <button
                            disabled={
                              locked || dirty || !chatgptDecision.trim()
                            }
                            onClick={() =>
                              attempt(async () => {
                                await api(
                                  `/projects/${p.id}/decisions`,
                                  json("POST", {
                                    revision: p.revision,
                                    instruction,
                                    decision: JSON.parse(chatgptDecision),
                                  }),
                                );
                                setChatgptDecision("");
                                await open(p.id);
                              })
                            }
                          >
                            Validar y aplicar al proyecto
                          </button>
                        </div>
                      </>
                    )}
                    <div className="history">
                      <div className="section-label">HISTORIAL</div>
                      {p.history.length ? (
                        p.history.map((h: any, i: number) => (
                          <article key={i}>
                            <b>{h.instruction}</b>
                            <p>{h.text}</p>
                          </article>
                        ))
                      ) : (
                        <p className="muted">
                          Las decisiones de IA aparecerán aquí.
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="panel-body">
                    {selected ? (
                      <>
                        <div className="section-label">CLIP SELECCIONADO</div>
                        <h3>{selected.id}</h3>
                        <p className="notice">{selected.reason}</p>
                        <div className="field-grid">
                          {[
                            ["inFrame", "Entrada (frames)", 0, 1],
                            ["outFrame", "Salida (frames)", 1, 1],
                            ["zoom", "Zoom", 1, 0.05],
                            ["speed", "Velocidad", 0.5, 0.1],
                            ["x", "Encuadre X", 0, 0.05],
                            ["y", "Encuadre Y", 0, 0.05],
                            ["volume", "Volumen voz", 0, 0.1],
                            ["brightness", "Brillo", 0.5, 0.05],
                            ["contrast", "Contraste", 0.5, 0.05],
                            ["saturation", "Saturación", 0, 0.05],
                          ].map(([key, label, min, step]) => (
                            <label key={key as string}>
                              {label}
                              <input
                                type="number"
                                disabled={locked}
                                value={(selected as any)[key]}
                                min={min as number}
                                step={step as number}
                                onChange={(e) =>
                                  mutateClip(
                                    key as string,
                                    Number(e.target.value),
                                  )
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <label>
                          Transición
                          <select
                            value={selected.transition}
                            disabled={locked}
                            onChange={(e) => {
                              if (!plan) return;
                              const next = structuredClone(plan);
                              const c = next.clips.find(
                                (c) => c.id === selection,
                              )!;
                              c.transition = e.target.value as any;
                              c.transitionFrames =
                                c.transition === "cut"
                                  ? 0
                                  : Math.min(
                                      8,
                                      Math.floor(
                                        (c.outFrame - c.inFrame) / c.speed / 3,
                                      ),
                                    );
                              change(next);
                            }}
                          >
                            <option value="cut">Corte directo</option>
                            <option value="fade-black">Fundido a negro</option>
                          </select>
                        </label>
                        <button
                          disabled={locked}
                          onClick={() => {
                            if (!plan) return;
                            const next = structuredClone(plan),
                              i = next.clips.findIndex(
                                (c) => c.id === selection,
                              ),
                              c = next.clips[i],
                              mid = Math.floor((c.inFrame + c.outFrame) / 2);
                            next.clips.splice(
                              i,
                              1,
                              { ...c, outFrame: mid, transitionFrames: 0 },
                              {
                                ...c,
                                id:
                                  "split_" +
                                  crypto.randomUUID().replaceAll("-", ""),
                                inFrame: mid,
                                transitionFrames: 0,
                              },
                            );
                            next.captions = remapCaptions(
                              next,
                              p.analysis.words,
                              p.primary,
                            );
                            change(next);
                          }}
                        >
                          Dividir clip por la mitad
                        </button>
                      </>
                    ) : (
                      <p className="notice">
                        Selecciona un clip en la timeline para ajustar su
                        encuadre, tiempo y audio.
                      </p>
                    )}
                    {plan ? (
                      <>
                        <hr />
                        <div className="section-label">PERFIL EDITORIAL</div>
                        <p className="muted">
                          {plan.profile.label}. Apariencia neutral hasta
                          verificar la marca.
                        </p>
                        <label>
                          Color de captions
                          <input
                            type="color"
                            value={plan.profile.captionColor}
                            disabled={locked}
                            onChange={(e) =>
                              change({
                                ...plan,
                                profile: {
                                  ...plan.profile,
                                  captionColor: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Área segura
                          <input
                            type="range"
                            min="0.08"
                            max="0.25"
                            step="0.01"
                            value={plan.profile.safeArea}
                            onChange={(e) =>
                              change({
                                ...plan,
                                profile: {
                                  ...plan.profile,
                                  safeArea: +e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Calidad de exportación
                          <select
                            value={plan.render.quality}
                            onChange={(e) =>
                              change({
                                ...plan,
                                render: {
                                  ...plan.render,
                                  quality: e.target.value as any,
                                },
                              })
                            }
                          >
                            <option value="draft">
                              Borrador · media resolución
                            </option>
                            <option value="final">Final · 1080p</option>
                          </select>
                        </label>
                      </>
                    ) : null}
                  </div>
                )}
              </section>
            </div>
            {plan ? (
              <section className="timeline-panel">
                <div className="timeline-tools">
                  <div className="row">
                    <b>TIMELINE</b>
                    <button
                      title="Deshacer"
                      disabled={!past.length || locked}
                      onClick={() => {
                        setFuture([plan, ...future]);
                        setPlan(past.at(-1)!);
                        setPast(past.slice(0, -1));
                      }}
                    >
                      ↶
                    </button>
                    <button
                      title="Rehacer"
                      disabled={!future.length || locked}
                      onClick={() => {
                        setPast([...past, plan]);
                        setPlan(future[0]);
                        setFuture(future.slice(1));
                      }}
                    >
                      ↷
                    </button>
                    <button
                      disabled={!dirty || locked}
                      onClick={() => attempt(save)}
                    >
                      Guardar cambios
                    </button>
                  </div>
                  <span className="muted">
                    Revisión {p.revision} · {seconds(total)}
                  </span>
                </div>
                <div className="ruler">
                  <span>00:00</span>
                  <input
                    aria-label="Posición de reproducción"
                    type="range"
                    min={0}
                    max={total - 1}
                    defaultValue={0}
                    onChange={(e) => player.current?.seekTo(+e.target.value)}
                  />
                  <span>{seconds(total)}</span>
                </div>
                <div className="track">
                  <div className="track-label">▣ Vídeo</div>
                  <div className="track-content">
                    {timeline(plan).map((c, i) => (
                      <button
                        key={c.id}
                        title={c.reason}
                        className={
                          "clip " + (selection === c.id ? "chosen" : "")
                        }
                        style={{
                          left: `${(c.start / total) * 100}%`,
                          width: `${((c.end - c.start) / total) * 100}%`,
                        }}
                        onClick={() => {
                          setSelection(c.id);
                          setTab("properties");
                          player.current?.seekTo(c.start);
                        }}
                      >
                        <b>{String(i + 1).padStart(2, "0")}</b>
                        <span>
                          {c.zoom > 1 ? `${c.zoom}×` : "Toma"} ·{" "}
                          {seconds(c.end - c.start)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="track">
                  <div className="track-label">T Captions</div>
                  <div className="track-content">
                    {plan.captions.map((c) => (
                      <button
                        key={c.id}
                        className="caption clip"
                        style={{
                          left: `${(c.start / total) * 100}%`,
                          width: `${((c.end - c.start) / total) * 100}%`,
                        }}
                        title={c.words.map((w) => w.word).join(" ")}
                        onClick={() => player.current?.seekTo(c.start)}
                      >
                        {c.words.map((w) => w.word).join(" ")}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="track">
                  <div className="track-label">♫ Audio</div>
                  <div className="track-content">
                    {plan.audio.map((a) => (
                      <button
                        key={a.id}
                        className="audio clip"
                        style={{
                          left: `${(a.start / total) * 100}%`,
                          width: `${((a.end - a.start) / total) * 100}%`,
                        }}
                        onClick={() => player.current?.seekTo(a.start)}
                      >
                        {a.role} · {Math.round(a.volume * 100)}%{" "}
                        {a.ducking ? "· ducking" : ""}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="track">
                  <div className="track-label">◇ Gráficos</div>
                  <div className="track-content">
                    {plan.overlays.map((o) => (
                      <button
                        key={o.id}
                        className="graphic clip"
                        style={{
                          left: `${(o.start / total) * 100}%`,
                          width: `${((o.end - o.start) / total) * 100}%`,
                        }}
                        onClick={() => player.current?.seekTo(o.start)}
                      >
                        {o.text || o.type}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="asset-tools">
                  <label className="file-label">
                    ＋ Importar recurso
                    <input
                      type="file"
                      accept="audio/*,image/png,image/jpeg,video/mp4,video/webm"
                      disabled={locked || dirty}
                      onChange={(e) => {
                        if (e.target.files?.[0])
                          void attempt(() => addAudio(e.target.files![0]));
                      }}
                    />
                  </label>
                  {p.assets
                    .filter(
                      (a: any) =>
                        a.kind === "image" ||
                        (a.kind === "video" && a.id !== p.primary),
                    )
                    .map((a: any) => (
                      <button
                        key={a.id}
                        disabled={locked}
                        onClick={() =>
                          change({
                            ...plan,
                            overlays: [
                              ...plan.overlays,
                              {
                                id:
                                  "asset_" +
                                  crypto.randomUUID().replaceAll("-", ""),
                                start: 0,
                                end: Math.min(
                                  total,
                                  90,
                                  Math.floor(a.duration * 30),
                                ),
                                type: a.kind === "image" ? "image" : "broll",
                                text: "",
                                sourceId: a.id,
                                x: 0.5,
                                y: 0.12,
                                scale: 0.65,
                                confidence: 1,
                                reason: "Recurso seleccionado por el editor",
                              },
                            ],
                          })
                        }
                      >
                        ◇ Añadir {a.name}
                      </button>
                    ))}
                  {p.assets
                    .filter((a: any) => a.kind === "audio")
                    .map((a: any) => (
                      <button
                        disabled={locked}
                        key={a.id}
                        onClick={() =>
                          change({
                            ...plan,
                            audio: [
                              ...plan.audio,
                              {
                                id:
                                  "music_" +
                                  crypto.randomUUID().replaceAll("-", ""),
                                sourceId: a.id,
                                start: 0,
                                end: total,
                                volume: plan.profile.musicVolume,
                                ducking: true,
                                role: "music",
                                confidence: 1,
                                reason: "Música seleccionada por el editor",
                              },
                            ],
                          })
                        }
                      >
                        ♫ Añadir {a.name}
                      </button>
                    ))}
                  <button
                    disabled={locked}
                    onClick={() => {
                      const text = prompt("Texto del gráfico");
                      if (text)
                        change({
                          ...plan,
                          overlays: [
                            ...plan.overlays,
                            {
                              id:
                                "title_" +
                                crypto.randomUUID().replaceAll("-", ""),
                              start: 0,
                              end: Math.min(total, 90),
                              type: "lower-third",
                              text,
                              sourceId: null,
                              x: 0.5,
                              y: 0.15,
                              scale: 0.7,
                              confidence: 1,
                              reason: "Gráfico añadido por el editor",
                            },
                          ],
                        });
                    }}
                  >
                    ＋ Motion graphic
                  </button>
                </div>
                <details>
                  <summary>
                    Editar captions, pistas y decisiones · EditPlan JSON
                  </summary>
                  <p className="muted">
                    Todos los cambios se validan antes de aplicarse. Puedes
                    ajustar captions, eliminar elementos, reordenar clips y
                    cambiar los rangos.
                  </p>
                  <textarea
                    aria-label="EditPlan JSON"
                    key={JSON.stringify(plan)}
                    defaultValue={JSON.stringify(plan, null, 2)}
                    rows={12}
                    id="plan-json"
                  />
                  <button
                    disabled={locked}
                    onClick={() => {
                      try {
                        change(
                          JSON.parse(
                            (
                              document.getElementById(
                                "plan-json",
                              ) as HTMLTextAreaElement
                            ).value,
                          ),
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Validar y aplicar
                  </button>
                </details>
              </section>
            ) : null}
            <section className="jobs">
              {p.jobs?.slice(0, 5).map((j: any) => (
                <div className={"job " + j.status} key={j.id}>
                  <b>{j.type}</b>
                  <span>{j.status}</span>
                  <progress value={j.progress} max={1} />
                  {j.error ? <small>{j.error}</small> : null}
                  {j.status === "failed" ? (
                    <button
                      disabled={locked}
                      onClick={() =>
                        attempt(async () => {
                          await api(`/projects/${p.id}/jobs/${j.id}/retry`, {
                            method: "POST",
                          });
                          setP(await api("/projects/" + p.id));
                        })
                      }
                    >
                      Reintentar
                    </button>
                  ) : null}
                </div>
              ))}
              {p.renders.map((r: any) => (
                <a
                  className="download"
                  key={r.id}
                  href={`/api/projects/${p.id}/renders/${r.id}`}
                >
                  ↓ MP4 · revisión {r.revision}
                </a>
              ))}
            </section>
          </>
        )}
      </main>
      <footer>
        <span>VANTA / AGENTIC VIDEO EDITOR</span>
        <span>Decisiones visibles. Edición bajo tu control.</span>
      </footer>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
