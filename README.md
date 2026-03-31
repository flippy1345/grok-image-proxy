# ai-image-proxy

A lightweight Bun proxy that translates OpenAI-compatible image API calls into Grok (x.ai) API format.

Useful for tools like OpenWebUI that expect the OpenAI image API standard.

## What it does

- **`/images/generations`** — Forwards JSON generation requests to Grok as-is (the formats are nearly identical).
- **`/images/edits`** — Accepts multipart form uploads (OpenAI standard), converts the uploaded image to a base64 data URL, and sends it as JSON to Grok's edit endpoint.

Accepts paths: `/images/*`, `/v1/images/*`, `/openai/v1/images/*`.

## Setup

```bash
bun install
```

## Usage

```bash
# Start the proxy
bun run start

# Or with hot reload
bun run dev
```

### Environment Variables

| Variable | Default | Description | Optional |
| -------- | ------- | ----------- | -------- |
| `PORT` | `8080` | Port the proxy listens on | ✅ |
| `GROK_BASE_URL` | `https://api.x.ai/v1` | Grok API base URL | ✅ |
| `CHAT_BASE_URL` | `""` | Completion Model base URL | ✅ |

### Open WebUI Configuration

In Open WebUI, add a new image generation provider:

- **API URL**: `http://localhost:8080/v1`
- **API Key**: Your x.ai API key (passed through to Grok)

### Example Requests

**Generation:**

```bash
curl http://localhost:8080/v1/images/generations \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-2-image",
    "prompt": "A futuristic city skyline at sunset",
    "n": 1,
    "size": "1024x1024"
  }'
```

**Edit — single image (multipart form — OpenAI compatible):**

```bash
curl http://localhost:8080/v1/images/edits \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -F "model=grok-2-image" \
  -F "image=@original.png" \
  -F "prompt=Add a red hat to the person"
```

**Edit — multiple images (multipart form — OpenAI compatible):**

```bash
curl http://localhost:8080/v1/images/edits \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -F "model=grok-2-image" \
  -F "image[]=@lotion.png" \
  -F "image[]=@candle.png" \
  -F "image[]=@soap.png" \
  -F "prompt=Create a gift basket with these items"
```

### Handling with non *multimodal* Models (e.g.: Deepseek)

In case you want to use the image model inside a chat with a completion model like *Deepseek*, that does not support images.  
Set the completion model base url [variable](README.md#environment-variables) to for example `https://api.deepseek.com` if you want to use a Deepseek model

The proxy will now transform the response from the image generation model, to strip the image url context before it gets send to the completion model, to not cause errors while generating images and therefore ending chat sessions prematurely.

## Regarding the Helm-Chart

In essence it copies to index.ts to a configmap (reason why the application is *inside* the helm-chart)
and then mounts it as a `index.ts` inside the bun docker image and executes `bun run index.ts`.

I choose this approach to not also have the need to build a docker image and create a pipeline for it.  
In my personal use case I have a kubernetes cluster, which is why I created a helm-chart with mounted files instead of a docker-compose setup.

If you would like a dockerfile, pipeline and more simple docker setup, feel free to create a PR.

In the mean time you pretty much just need a way to run the index.ts file, which can also be done via vercel, lambda setups or running it with `bun run` on the same server where you host OpenWebUI at the end.
