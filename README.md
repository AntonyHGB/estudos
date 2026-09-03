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

## Modos de estudo

Além de ler tema a tema, o site tem quatro telas que existem para atacar a falsa sensação de
domínio que estudar em ordem produz:

| Tela | Para que serve |
|---|---|
| 📝 **Simulado** | 20, 40 ou todas as questões, sorteadas de todos os temas e misturadas, sem gabarito até o fim. Estudar tema a tema entrega metade da resposta pelo contexto; misturar é o que se parece com a entrevista. Não altera o progresso dos temas. |
| 🔁 **Revisar erros** | Junta o que você errou no quiz e o que marcou como dúvida nas questões abertas, de todos os temas. Ao acertar, sai da lista. |
| 🔎 **Buscar** | Procura em resumos, questões abertas e quiz, ignorando acentos, e leva ao trecho com o termo destacado. |
| ⏰ **Revisão espaçada** | Guarda quando cada tema foi tocado e usa o desempenho para definir o intervalo: 90% ou mais pede revisão em 14 dias, 70% ou menos em 3. A home marca e ordena os temas devendo. |

A home funciona como painel de retomada: mostra progresso, acerto, pendências e recomenda uma
única próxima ação. Para dias corridos, **Sessão rápida** inicia um simulado de 10 questões
(aproximadamente 5 minutos); os simulados completos continuam disponíveis com 20, 40 ou todas.

Cards, abas e alternativas são controles nativos de teclado, e o layout se adapta a celular,
tablet e desktop sem perder as funções de progresso.

O acerto aparece sempre separado por nível (🟢 🟡 🔴), na home e dentro de cada tema — é o
número que diz se o domínio é real ou só no básico, que a média geral esconde.

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

**Ao escrever questão nova, cuide do desenho das alternativas** — é fácil entregar a resposta
sem perceber:

- todas as alternativas dentro de ~10% de diferença em caracteres. Se a correta ficar longa,
  corte-a: o que não cabe pertence ao campo `e`, que é onde o gabarito é comentado;
- distratora tem que ser erro plausível — o conceito vizinho, a definição correta de outro
  termo, a resposta que valeria em outro contexto. Distratora absurda transforma a questão
  em três opções;
- nada de "todas as anteriores", nem absolutos ("sempre", "nunca") só nas erradas;
- **nunca cite alternativa por letra** no campo `e` ("a opção B..."), porque as posições são
  embaralhadas. Cite o conteúdo. O balanceador aborta se encontrar citação por letra.

### Balancear as posições

```bash
node balancear-quiz.mjs engenharia-de-dados machine-learning
```

Escrevendo questão é natural deixar a correta sempre na mesma posição — e aí dá para gabaritar
marcando sempre a mesma letra. O script troca a correta de lugar seguindo um padrão fixo, o que
dá 25% por letra. É troca de pares: nenhum texto muda.

### Auditoria automática

Todo `node build-site.mjs` mede e imprime, por área:

```
auditoria do quiz (96 questões)
  ✔ correta é a mais longa: 36% (alvo ≤ 45%)
  ✔ distribuição da correta: A 25% · B 25% · C 25% · D 25% (alvo ≤ 35% por letra)
```

Com 4 alternativas, o acaso é 25% nas duas métricas. Passando dos alvos, o build reclama: o
quiz voltou a ser gabaritável sem saber o assunto, e aí ele não serve mais para autoavaliação.

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
