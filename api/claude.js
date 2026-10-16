// Função serverless (Vercel): recebe o pedido do app e chama a API do Claude.
// A chave fica só aqui no servidor, na variável ANTHROPIC_API_KEY.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const MAX_IMAGES = 2;
const MAX_CHARS = 60000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

let client;
const getClient = () => (client ??= new Anthropic());

function bad(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

function validate(body) {
  if (!body || typeof body !== "object") return "Corpo inválido.";
  const { system, messages, images } = body;
  if (system != null && typeof system !== "string") return "system deve ser texto.";
  if (!Array.isArray(messages) || !messages.length || messages.length > 60) return "messages inválido.";
  let chars = (system || "").length;
  for (const m of messages) {
    if (!m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string" || !m.content.trim()) return "Mensagem inválida.";
    chars += m.content.length;
  }
  if (messages[0].role !== "user" || messages.at(-1).role !== "user") return "A conversa deve começar e terminar com o usuário.";
  if (chars > MAX_CHARS) return "Texto longo demais.";
  if (images != null) {
    if (!Array.isArray(images) || images.length > MAX_IMAGES) return "Fotos demais.";
    for (const img of images) {
      if (!img || !IMAGE_TYPES.has(img.media_type) || typeof img.data !== "string") return "Foto inválida.";
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return bad(res, 405, "method", "Use POST.");

  const code = process.env.APP_CODE;
  if (code && req.headers["x-app-code"] !== code) return bad(res, 401, "not_granted", "Código de acesso incorreto.");
  if (!process.env.ANTHROPIC_API_KEY) return bad(res, 503, "no_key", "O servidor está sem a chave da API do Claude.");

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
  const problem = validate(body);
  if (problem) return bad(res, 400, "invalid", problem);

  const { system, messages, images, quick } = body;
  // As fotos vão junto da primeira mensagem do usuário, antes do texto.
  const apiMessages = messages.map((m, i) => {
    if (i !== 0 || !images?.length) return { role: m.role, content: m.content };
    return {
      role: "user",
      content: [
        ...images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } })),
        { type: "text", text: m.content },
      ],
    };
  });

  try {
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: quick ? "low" : "medium" },
      ...(system ? { system } : {}),
      messages: apiMessages,
    });
    if (response.stop_reason === "refusal") return bad(res, 422, "refused", "O Claude não respondeu a esse pedido.");
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (!text) return bad(res, 502, "empty_completion", "Resposta vazia.");
    res.status(200).json({ text });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return bad(res, 429, "rate_limited", "Muitas consultas seguidas.");
    if (error instanceof Anthropic.AuthenticationError) return bad(res, 503, "no_key", "A chave da API do Claude é inválida.");
    if (error instanceof Anthropic.BadRequestError) return bad(res, 400, "image_rejected", error.message);
    if (error instanceof Anthropic.APIError) return bad(res, 502, "upstream", `Erro ${error.status} na API do Claude.`);
    console.error(error);
    bad(res, 500, "server", "Falha no servidor.");
  }
}
