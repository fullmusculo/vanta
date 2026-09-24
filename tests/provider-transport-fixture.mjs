// Test-only fake transport. Never loaded by product startup. Does not test live AI quality.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) === "https://api.openai.com/v1/audio/transcriptions")
    return Response.json({
      words: [
        { word: "Fixture", start: 0.4, end: 0.8 },
        { word: "transcript", start: 4.5, end: 5.2 },
      ],
    });
  if (String(url) === "https://api.openai.com/v1/responses") {
    const body = JSON.parse(options.body),
      request = JSON.parse(body.input[0].content[0].text),
      plan = request.context.plan;
    if (
      !body.text.format.strict ||
      !body.input[0].content.some((c) => c.type === "input_image")
    )
      throw Error("Missing structured multimodal request");
    const reduce = request.instruction.includes("reduce");
    return Response.json({
      status: "completed",
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                summary:
                  "TEST FIXTURE: controlled operation; not a live AI decision",
                operations: [
                  {
                    type: "set-clip",
                    clip: {
                      ...plan.clips[0],
                      zoom: reduce ? 1.1 : 1.2,
                      transition: reduce ? "cut" : "fade-black",
                      transitionFrames: reduce ? 0 : 6,
                    },
                  },
                ],
              }),
            },
          ],
        },
      ],
    });
  }
  return originalFetch(url, options);
};
