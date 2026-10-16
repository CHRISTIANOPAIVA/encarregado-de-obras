# Encarregado de Obras

App web instalável no celular (PWA) que ajuda a consertar problemas em casa: você descreve o problema e tira uma foto, e o Claude faz o diagnóstico, monta a lista de compras, guia o conserto passo a passo, confere uma cotação e escreve a mensagem ao locador.

## Como funciona

- `public/`: o app (HTML, CSS e JavaScript puro, sem etapa de build).
  - 4 abas: **Diagnóstico** (com a lista de compras), **Conserto** (passo a passo, "Ficou certo?" e "Nunca mais"), **Cotação** e **Locador**.
  - Os casos e as fotos ficam guardados no próprio aparelho (IndexedDB). Dá para ter vários casos.
  - O `sw.js` guarda o app para abrir sem internet; as consultas ao Claude precisam de internet.
- `api/claude.js`: função de servidor que guarda a chave da API e chama o Claude. O app nunca vê a chave.

## Rodar no computador

```bash
npm install
cp .env.example .env   # e preencha ANTHROPIC_API_KEY
npm run dev            # abre em http://localhost:3000
```

## Publicar na Vercel (grátis)

1. Entre em vercel.com com sua conta do GitHub e importe este repositório (preset "Other", sem comando de build).
2. Em Settings → Environment Variables, crie `ANTHROPIC_API_KEY` com a sua chave. Recomendado: crie também `APP_CODE` com uma senha simples; o app pede essa senha uma vez em cada aparelho.
3. Abra o endereço no celular e use "Adicionar à tela inicial".

Cada consulta ao Claude é cobrada na sua conta da Anthropic. Por padrão o app usa o modelo `claude-opus-5-5`; para trocar, defina `CLAUDE_MODEL`.

Orientação geral, não substitui um profissional. Gás, quadro de energia e estrutura: chame um técnico.
