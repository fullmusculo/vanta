import { writeFile } from "node:fs/promises";
import { zodToJsonSchema } from "zod-to-json-schema";
import { planSchema } from "../src/agentic/contract";
import { decisionSchema } from "../server/director";
await writeFile(
  "docs/edit-plan.schema.json",
  JSON.stringify(zodToJsonSchema(planSchema), null, 2) + "\n",
);
await writeFile(
  "docs/director-decision.schema.json",
  JSON.stringify(zodToJsonSchema(decisionSchema), null, 2) + "\n",
);
