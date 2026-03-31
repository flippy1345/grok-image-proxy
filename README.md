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

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Port the proxy listens on |
| `GROK_BASE_URL` | `https://api.x.ai/v1` | Grok API base URL |

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
