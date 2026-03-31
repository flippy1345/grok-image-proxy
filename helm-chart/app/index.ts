const PORT = parseInt(process.env.PORT || "8080");
const GROK_BASE_URL = process.env.GROK_BASE_URL || "https://api.x.ai/v1";
const CHAT_BASE_URL = process.env.CHAT_BASE_URL || "";

const BASE64_DATA_URL = /data:[^;]+;base64,[A-Za-z0-9+/=]{20,}/g;
const RAW_BASE64 = /^[A-Za-z0-9+/=]{100,}$/;
const BASE64_KEYS = new Set(["b64_json", "b64"]);
const PLACEHOLDER = "<base64_data>";

function redact(obj: unknown, key?: string): unknown {
  if (typeof obj === "string") {
    if (key && BASE64_KEYS.has(key)) return PLACEHOLDER;
    if (RAW_BASE64.test(obj)) return PLACEHOLDER;
    return obj.replace(BASE64_DATA_URL, PLACEHOLDER);
  }
  if (Array.isArray(obj)) return obj.map((v) => redact(v));
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = redact(v, k);
    return out;
  }
  return obj;
}

function log(label: string, data: unknown) {
  console.log(`[${new Date().toISOString()}] ${label}`, JSON.stringify(redact(data), null, 2));
}

function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  return mimeTypes[ext || ""] || "image/png";
}

async function fileToBase64DataUrl(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const mime = getMimeType(file.name);
  return `data:${mime};base64,${base64}`;
}

async function handleGenerations(req: Request): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return Response.json({ error: "Missing Authorization header" }, { status: 401 });
  }

  const body = await req.json();
  log("📥 incoming /images/generations", body);

  const grokBody = {
    model: body.model || "grok-2-image",
    prompt: body.prompt,
    ...(body.n && { n: body.n }),
    ...(body.response_format && { response_format: body.response_format }),
  };

  log("🚀 outgoing -> grok /images/generations", grokBody);

  const grokRes = await fetch(`${GROK_BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify(grokBody),
  });

  const grokData = await grokRes.json();
  log(`✅ response <- grok (${grokRes.status})`, grokData);
  return Response.json(grokData, { status: grokRes.status });
}

async function collectFormImages(formData: FormData): Promise<File[]> {
  const files: File[] = [];

  const single = formData.get("image");
  if (single instanceof File) files.push(single);

  for (const entry of formData.getAll("image[]")) {
    if (entry instanceof File) files.push(entry);
  }

  return files;
}

async function handleEdits(req: Request): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return Response.json({ error: "Missing Authorization header" }, { status: 401 });
  }

  const contentType = req.headers.get("Content-Type") || "";

  let model: string;
  let prompt: string;
  let imageDataUrls: string[] = [];
  let responseFormat: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    model = (formData.get("model") as string) || "grok-2-image";
    prompt = (formData.get("prompt") as string) || "";
    responseFormat = (formData.get("response_format") as string) || undefined;

    const imageFiles = await collectFormImages(formData);
    log("📥 incoming /images/edits (multipart)", {
      model,
      prompt,
      responseFormat,
      images: imageFiles.map((f) => ({ name: f.name, size: f.size, type: f.type })),
    });

    if (imageFiles.length === 0) {
      return Response.json(
        { error: "Missing 'image' or 'image[]' field in form data" },
        { status: 400 },
      );
    }
    imageDataUrls = await Promise.all(imageFiles.map(fileToBase64DataUrl));
  } else {
    const body = await req.json();
    log("📥 incoming /images/edits (json)", body);

    model = body.model || "grok-2-image";
    prompt = body.prompt || "";
    responseFormat = body.response_format;

    if (body.images && Array.isArray(body.images)) {
      imageDataUrls = body.images.map((img: any) => img.url || img);
    } else if (body.image) {
      imageDataUrls = [body.image.url || body.image];
    } else {
      return Response.json({ error: "Missing 'image' or 'images' in request body" }, { status: 400 });
    }
  }

  const grokBody: Record<string, unknown> = { model, prompt };

  if (imageDataUrls.length === 1) {
    grokBody.image = { url: imageDataUrls[0], type: "image_url" };
  } else {
    grokBody.images = imageDataUrls.map((url) => ({ url, type: "image_url" }));
  }

  if (responseFormat) {
    grokBody.response_format = responseFormat;
  }

  log("🚀 outgoing -> grok /images/edits", grokBody);

  const grokRes = await fetch(`${GROK_BASE_URL}/images/edits`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify(grokBody),
  });

  const grokData = await grokRes.json();
  log(`✅ response <- grok (${grokRes.status})`, grokData);
  return Response.json(grokData, { status: grokRes.status });
}

function stripImageUrlContent(messages: any[]): any[] {
  return messages.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;

    const filtered = msg.content.filter(
      (part: any) => part.type !== "image_url",
    );

    if (filtered.length === 0) {
      return { ...msg, content: "[image]" };
    }

    if (filtered.length === 1 && filtered[0].type === "text") {
      return { ...msg, content: filtered[0].text };
    }

    return { ...msg, content: filtered };
  });
}

async function handleChatCompletions(req: Request): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return Response.json({ error: "Missing Authorization header" }, { status: 401 });
  }

  if (!CHAT_BASE_URL) {
    return Response.json(
      { error: "CHAT_BASE_URL not configured" },
      { status: 500 },
    );
  }

  const body = await req.json();
  const hadImageContent = body.messages?.some(
    (m: any) => Array.isArray(m.content) && m.content.some((p: any) => p.type === "image_url"),
  );

  if (hadImageContent) {
    body.messages = stripImageUrlContent(body.messages);
    log("🧹 stripped image_url from /chat/completions", { messageCount: body.messages.length });
  }

  log("📥 outgoing -> chat /chat/completions", { model: body.model, messageCount: body.messages?.length, stream: body.stream });

  const chatRes = await fetch(`${CHAT_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify(body),
  });

  if (body.stream) {
    return new Response(chatRes.body, {
      status: chatRes.status,
      headers: chatRes.headers,
    });
  }

  const chatData = await chatRes.json();
  log(`✅ response <- chat (${chatRes.status})`, { model: chatData.model, usage: chatData.usage });
  return Response.json(chatData, { status: chatRes.status });
}

async function handleModelsPassthrough(req: Request): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return Response.json({ error: "Missing Authorization header" }, { status: 401 });
  }

  if (!CHAT_BASE_URL) {
    return Response.json(
      { error: "CHAT_BASE_URL not configured" },
      { status: 500 },
    );
  }

  const res2 = await fetch(`${CHAT_BASE_URL}/models`, {
    headers: { Authorization: authHeader },
  });
  const data = await res2.json();
  return Response.json(data, { status: res2.status });
}

function addCorsHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return new Response(res.body, { status: res.status, headers });
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      return addCorsHeaders(new Response(null, { status: 204 }));
    }

    const normalized = path
      .replace(/^\/openai/, "")
      .replace(/^\/v1/, "")
      .replace(/\/$/, "");

    let response: Response;

    try {
      if (req.method === "POST" && normalized === "/images/generations") {
        response = await handleGenerations(req);
      } else if (req.method === "POST" && normalized === "/images/edits") {
        response = await handleEdits(req);
      } else if (req.method === "POST" && normalized === "/chat/completions") {
        response = await handleChatCompletions(req);
      } else if (req.method === "GET" && normalized === "/models") {
        response = await handleModelsPassthrough(req);
      } else if (req.method === "GET" && (normalized === "/health" || normalized === "")) {
        response = Response.json({ status: "ok" });
      } else {
        response = Response.json({ error: "Not found" }, { status: 404 });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal server error";
      console.error("💥 Proxy error:", err);
      response = Response.json({ error: message }, { status: 500 });
    }

    return addCorsHeaders(response);
  },
});

console.log(`🟢 ai-image-proxy listening on http://localhost:${server.port}`);
console.log(`🔗 Image API: ${GROK_BASE_URL}`);
console.log(`🔗 Chat API:  ${CHAT_BASE_URL || "(not configured)"}`);

