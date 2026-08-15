# 📚 Material de Estudos — Engenharia de Dados & Machine Learning

Material conceitual para entrevistas técnicas, com site estático gerado a partir dos markdowns.

| Área | Temas | Questões abertas | Quiz |
|---|---|---|---|
| [Engenharia de Dados](engenharia-de-dados/) | 12 | 172 | 96 |
| [Machine Learning](machine-learning/) | 12 | 121 | 96 |

## Como funciona

Os arquivos `.md` são a fonte de verdade do conteúdo, e cada `quiz.json` guarda as questões
de múltipla escolha. O script `build-site.mjs` (Node puro, sem dependências) lê tudo e gera,
para cada pasta:

- `index.html` — página completa e auto-contida, com três abas por tema: **Estudo**, **Quiz**
  (múltipla escolha com correção imediata) e **Questões abertas** (resposta oculta e
  autoavaliação). Funciona até aberta direto do disco, por `file://`.
- `manifest.webmanifest`, `sw.js` e ícones PNG — camada opcional que torna o site instalável
  na tela de início e legível offline. Só entra em ação sob `http(s)`.

Na raiz, um `index.html` serve de hub para as duas áreas.

## Regenerar o site

```bash
node build-site.mjs
```

Edite os `.md` ou os `quiz.json` e rode o comando. Nunca edite os `index.html` gerados: eles são
sobrescritos a cada build.

### Formato das questões de quiz

```json
{
  "01": [
    {
      "n": "🟡",
      "q": "Enunciado, aceita **negrito** e `código`.",
      "a": ["Alternativa A", "Alternativa B", "Alternativa C", "Alternativa D"],
      "c": 1,
      "e": "Explicação do gabarito, mostrada depois da resposta."
    }
  ]
}
```

`n` é o nível (🟢 básico, 🟡 intermediário, 🔴 avançado) e `c` é o índice da alternativa correta,
contando de zero. O build valida os índices e avisa no console se algum estiver fora da faixa.

## Progresso

As marcações e as respostas do quiz ficam no `localStorage` do navegador — ou seja, são por
aparelho. Para levar o progresso do computador para o celular (ou o contrário), use a tela
**📲 Levar progresso**: ela gera um link que carrega tudo no outro aparelho, e também permite
baixar um backup em JSON.

## Publicar

O site é estático, então qualquer hospedagem serve. Com GitHub Pages:

```bash
gh repo create estudos --public --source=. --remote=origin --push
gh api -X POST repos/:owner/estudos/pages -f 'source[branch]=main' -f 'source[path]=/'
```

As páginas trazem `<meta name="robots" content="noindex, nofollow">`, então não aparecem em
buscadores — o acesso é por link direto.

Depois de qualquer alteração:

```bash
node build-site.mjs && git add -A && git commit -m "atualiza material" && git push
```
